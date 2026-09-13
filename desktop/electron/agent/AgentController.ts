/**
 * AgentController orchestrating the end-to-end FormPilot workflow.
 *
 * Implements:
 * - A bounded, single-flight agent loop with cooperative cancellation.
 * - Truthful execution events: a failed tool is never reported as a success.
 * - Human-in-the-loop interruption: pause(), resume(), takeOver(), stop().
 * - Enforcement of the REVIEW_READY terminal state (never auto-submits).
 * - Audit persistence so the execution timeline survives an application reload.
 */

import { StateMachine } from './StateMachine';
import { ToolContext, ToolExecutionError, ToolRegistry } from './ToolRegistry';
import { BrowserManager, OperationCancelledError } from '../browser/BrowserManager';
import { PolicyEngine, SubmissionControl } from '../policy/PolicyEngine';
import { BackendClient, coerceClarificationValue } from '../services/BackendClient';
import {
  AgentEventPayload,
  ClarificationPromptPayload,
  FieldMapping,
  FormFieldSnapshot,
  FormSnapshot,
  StartSessionOptions,
  VerificationRecord,
} from '../shared/types';

/** Maximum number of field operations before the loop abandons the session. */
const MAX_STEPS = 50;

/** How long the agent waits for a human clarification answer before giving up. */
const CLARIFICATION_TIMEOUT_MS = 10 * 60 * 1000;

export class AgentController {
  private stateMachine: StateMachine;
  private toolRegistry: ToolRegistry;
  private browserManager: BrowserManager;
  private policyEngine: PolicyEngine;
  private backendClient: BackendClient;

  private sessionId: string = '';
  private isPausedState: boolean = false;
  private isStoppedState: boolean = false;
  private isTakeoverState: boolean = false;
  private isRunning: boolean = false;

  /** Cooperative cancellation handle raced against every browser operation. */
  private abortController: AbortController | null = null;

  /** Serialized audit persistence chain so event writes never race each other. */
  private persistenceQueue: Promise<void> = Promise.resolve();

  /** Keyed clarification resolvers so concurrent prompts cannot orphan each other. */
  private pendingClarifications: Map<
    string,
    { resolve: (answer: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  > = new Map();

  private eventListeners: Array<(event: AgentEventPayload) => void> = [];
  private clarificationListeners: Array<(prompt: ClarificationPromptPayload) => void> = [];

  private settings = {
    headless: false,
    typingDelayMs: 25,
  };

  /**
   * Create the agent controller.
   *
   * @param backendClient Authenticated backend client for this installation.
   */
  constructor(backendClient: BackendClient) {
    this.backendClient = backendClient;
    this.stateMachine = new StateMachine('IDLE');
    this.toolRegistry = new ToolRegistry();
    this.browserManager = new BrowserManager();
    this.policyEngine = new PolicyEngine();
  }

  /**
   * Apply runtime settings from the settings UI.
   *
   * @param newSettings Partial settings to merge.
   */
  public updateSettings(newSettings: Record<string, unknown> | object): void {
    this.settings = { ...this.settings, ...(newSettings as Record<string, unknown>) } as {
      headless: boolean;
      typingDelayMs: number;
    };
  }

  /**
   * Read current runtime settings.
   *
   * @returns A copy of the active settings.
   */
  public getSettings(): typeof this.settings {
    return { ...this.settings };
  }

  /**
   * Access the workflow state machine.
   *
   * @returns The active state machine.
   */
  public getStateMachine(): StateMachine {
    return this.stateMachine;
  }

  /**
   * Access the authenticated backend client bound to this controller.
   *
   * @returns The backend client used for all provider and session calls.
   */
  public getBackendClient(): BackendClient {
    return this.backendClient;
  }

  /**
   * Report whether a session is currently executing.
   *
   * @returns True while the agent loop is running.
   */
  public isSessionRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Subscribe to agent execution events.
   *
   * @param listener Callback invoked for every emitted event.
   * @returns Unsubscribe function.
   */
  public onEvent(listener: (event: AgentEventPayload) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((entry) => entry !== listener);
    };
  }

  /**
   * Subscribe to clarification requests.
   *
   * @param listener Callback invoked with each clarification prompt.
   * @returns Unsubscribe function.
   */
  public onClarificationRequest(listener: (prompt: ClarificationPromptPayload) => void): () => void {
    this.clarificationListeners.push(listener);
    return () => {
      this.clarificationListeners = this.clarificationListeners.filter((entry) => entry !== listener);
    };
  }

  /**
   * Remove every registered listener.
   */
  public disposeListeners(): void {
    this.eventListeners = [];
    this.clarificationListeners = [];
  }

  /**
   * Emit and persist a structured execution event.
   *
   * Events are pushed to the session audit timeline so the timeline is durable.
   *
   * @param event Event payload to emit.
   */
  private emitEvent(event: AgentEventPayload): void {
    this.eventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error emitting event:', error);
      }
    });

    if (this.sessionId && event.type !== 'STATE_CHANGED') {
      // Fire-and-forget persistence; a logging failure must not break the workflow.
      // Queued locally so the backend always receives events in creation order
      // instead of racing multiple concurrent writes against each other.
      this.enqueuePersistence(event as unknown as Record<string, unknown>);
    }
  }

  /**
   * Append an event to the serialized persistence queue.
   *
   * @param event Structured event payload to persist.
   */
  private enqueuePersistence(event: Record<string, unknown>): void {
    const sessionId = this.sessionId;
    this.persistenceQueue = this.persistenceQueue
      .then(async () => {
        await this.backendClient.appendEventSafe(sessionId, event);
      })
      .catch((error) => {
        console.error('Could not persist agent event:', error);
      });
  }

  /**
   * Create a structured event payload with a unique identifier.
   *
   * @param type Event type.
   * @param description Human readable description.
   * @param extra Optional additional fields.
   * @returns The event payload.
   */
  private buildEvent(
    type: AgentEventPayload['type'],
    description: string,
    extra: Partial<AgentEventPayload> = {}
  ): AgentEventPayload {
    return {
      eventId: `evt_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      type,
      description,
      ...extra,
    };
  }

  /**
   * Block while the session is paused or under human takeover.
   *
   * @throws OperationCancelledError when the operator stops the workflow.
   */
  private async checkPauseOrStop(): Promise<void> {
    if (this.isStoppedState) {
      throw new OperationCancelledError();
    }

    while (this.isPausedState || this.isTakeoverState) {
      if (this.isStoppedState) {
        throw new OperationCancelledError();
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /**
   * Pause the agent loop between operations.
   */
  public pause(): void {
    this.isPausedState = true;
    this.stateMachine.transition('PAUSED');
    this.emitEvent(this.buildEvent('STATE_CHANGED', 'Agent paused by human operator.'));
  }

  /**
   * Resume a paused or taken-over session.
   */
  public resume(): void {
    this.isPausedState = false;
    this.isTakeoverState = false;
    this.stateMachine.transition('FILLING_FORM');
    this.emitEvent(this.buildEvent('STATE_CHANGED', 'Agent resumed by human operator.'));
  }

  /**
   * Hand direct browser control to the human operator.
   */
  public takeOver(): void {
    this.isTakeoverState = true;
    this.stateMachine.transition('USER_TAKEOVER');
    this.emitEvent(
      this.buildEvent(
        'STATE_CHANGED',
        'Human takeover active. Operator has direct control of the browser window.'
      )
    );
  }

  /**
   * Stop the workflow, cancelling in-flight operations and pending clarifications.
   */
  public stop(): void {
    this.isStoppedState = true;
    this.isPausedState = false;
    this.isTakeoverState = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    for (const [clarificationId, pending] of this.pendingClarifications.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new OperationCancelledError());
      this.pendingClarifications.delete(clarificationId);
    }

    this.stateMachine.transition('IDLE');
    this.emitEvent(this.buildEvent('STATE_CHANGED', 'Workflow stopped by user.'));
  }

  /**
   * Resolve a pending clarification prompt with the operator's answer.
   *
   * @param clarificationId Identifier of the clarification being answered.
   * @param answer Operator supplied value.
   * @returns True when the answer was delivered to a waiting prompt.
   */
  public answerClarification(clarificationId: string, answer: string): boolean {
    const pending = this.pendingClarifications.get(clarificationId);
    if (!pending) {
      console.warn(`No pending clarification found for id: ${clarificationId}`);
      return false;
    }

    clearTimeout(pending.timer);
    this.pendingClarifications.delete(clarificationId);
    pending.resolve(answer);

    this.emitEvent(
      this.buildEvent('TOOL_COMPLETED', `Human provided an answer for field "${clarificationId}".`, {
        tool: 'request_clarification',
        success: true,
      })
    );
    return true;
  }

  /**
   * Ask the operator a question and wait for the answer with a bounded timeout.
   *
   * @param prompt Clarification prompt to display.
   * @returns The operator's answer.
   * @throws OperationCancelledError when the session stops or the prompt times out.
   */
  private requestClarification(prompt: ClarificationPromptPayload): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingClarifications.delete(prompt.clarificationId);
        reject(new Error('CLARIFICATION_TIMEOUT'));
      }, CLARIFICATION_TIMEOUT_MS);

      this.pendingClarifications.set(prompt.clarificationId, { resolve, reject, timer });

      this.clarificationListeners.forEach((listener) => listener(prompt));
    });
  }

  /**
   * Build the execution context supplied to every tool invocation.
   *
   * @returns Tool execution context bound to the active session.
   */
  private createToolContext(): ToolContext {
    return {
      browserManager: this.browserManager,
      policyEngine: this.policyEngine,
      backendClient: this.backendClient,
      sessionId: this.sessionId,
      signal: this.abortController?.signal,
      emitEvent: (event: AgentEventPayload) => this.emitEvent(event),
      requestClarification: (prompt: ClarificationPromptPayload) =>
        this.requestClarification(prompt),
    };
  }

  /**
   * Detect submission-capable controls present on the active page.
   *
   * Real submit controls are detected separately from fillable fields.
   *
   * @returns Discovered submission candidate controls from the active DOM.
   */
  private async detectSubmissionControls(): Promise<SubmissionControl[]> {
    return await this.browserManager.scanSubmissionControls();
  }

  /**
   * Determine whether a fact value should check a checkbox.
   *
   * Consent-style checkboxes are driven by affirmative tokens, not by whether the
   * value text happens to equal 'true'.
   *
   * @param mapping Field mapping under evaluation.
   * @param field Target field snapshot.
   * @returns Desired checked state.
   */
  private resolveCheckboxState(mapping: FieldMapping, field: FormFieldSnapshot): boolean {
    const value = (mapping.fact_value || '').toString().trim().toLowerCase();
    const affirmative = new Set(['true', 'yes', 'y', '1', 'on', 'checked', 'agree', 'accepted']);
    const negative = new Set(['false', 'no', 'n', '0', 'off', 'unchecked', 'declined']);

    if (affirmative.has(value)) return true;
    if (negative.has(value)) return false;

    // Checkbox fields without an explicit boolean fact are treated as required
    // acknowledgements only when the form marks them required and a value is present.
    return Boolean(value) && field.required;
  }

  /**
   * Run the complete FormPilot automation loop for one session.
   *
   * @param options Session configuration supplied by the renderer.
   * @throws Error when a second session is started while one is already running.
   */
  public async startSession(options: StartSessionOptions): Promise<void> {
    if (this.isRunning) {
      throw new Error('SESSION_ALREADY_RUNNING');
    }

    this.isRunning = true;
    this.isStoppedState = false;
    this.isPausedState = false;
    this.isTakeoverState = false;
    this.abortController = new AbortController();

    const verifications: VerificationRecord[] = [];
    const failedFields: Array<{ field_ref: string; field_label: string; reason: string }> = [];
    let stepCount = 0;

    try {
      const session = await this.backendClient.createSession(
        options.documentName || 'admission_document.pdf',
        options.targetUrl
      );
      this.sessionId = session.id;

      // Step 1: Extract document facts.
      this.stateMachine.transition('EXTRACTING_DOC');
      await this.checkPauseOrStop();
      const facts = await this.runTool<any[]>(
        'extract_document_facts',
        {
          filePath: options.documentPath,
          rawText: options.documentText,
          documentName: options.documentName,
        },
        `Extracting facts from ${options.documentName || 'document'}...`,
        (result: any[]) => `Successfully extracted ${result.length} document facts.`
      );

      // Step 2: Launch the visible browser and scan the form.
      this.stateMachine.transition('SCANNING_FORM');
      await this.emitToolStarted('inspect_form', `Navigating to target form: ${options.targetUrl}...`);
      await this.browserManager.launch(this.settings.headless);
      await this.browserManager.navigateTo(options.targetUrl, this.abortController.signal);
      await this.checkPauseOrStop();

      const formSnapshot = await this.runTool<FormSnapshot>(
        'inspect_form',
        {},
        `Scanning the form at ${options.targetUrl}...`,
        (snapshot: FormSnapshot) => `Detected ${snapshot.fields.length} form fields.`
      );

      // Step 3: Synthesize semantic mappings.
      this.stateMachine.transition('MAPPING_FIELDS');
      const mapResult = await this.backendClient.mapForm(this.sessionId, formSnapshot, facts);
      const mappings: FieldMapping[] = mapResult.mappings || [];
      const clarifications = mapResult.clarifications_required || [];

      this.emitEvent(
        this.buildEvent(
          'STATE_CHANGED',
          `Mapped ${mappings.length} fields (${clarifications.length} clarifications needed).`,
          { metadata: { mappings, factCount: facts.length } }
        )
      );

      // Step 4: Resolve clarifications.
      if (clarifications.length > 0) {
        this.stateMachine.transition('CLARIFICATION_REQUIRED');
        for (const prompt of clarifications) {
          await this.checkPauseOrStop();
          await this.emitToolStarted(
            'request_clarification',
            `Awaiting human clarification for '${prompt.field_label}'...`
          );

          // The tool resolves to `{ fieldRef, selectedValue }`, which is not a string.
          // Normalize it before it reaches the API, whose contract requires a string
          // and otherwise rejects the whole session with a 422.
          const clarificationResult = await this.runTool<any>(
            'request_clarification',
            {
              clarificationId: prompt.clarification_id,
              fieldRef: prompt.field_ref,
              fieldLabel: prompt.field_label,
              question: prompt.question,
              options: prompt.options,
            },
            `Requesting clarification for '${prompt.field_label}'...`,
            () => `Human confirmed a value for '${prompt.field_label}'.`
          );

          const answer = coerceClarificationValue(clarificationResult);

          if (!answer) {
            throw new Error(
              `CLARIFICATION_UNANSWERED: no usable value was supplied for '${prompt.field_label}'.`
            );
          }

          await this.backendClient.answerClarification(
            this.sessionId,
            prompt.clarification_id,
            answer
          );

          const target = mappings.find((mapping) => mapping.field_ref === prompt.field_ref);
          if (target) {
            target.fact_value = answer;
            target.status = 'RESOLVED';
          }
        }
      }

      // Step 5: Fill mapped fields, reporting the true outcome of every operation.
      this.stateMachine.transition('FILLING_FORM');
      for (const mapping of mappings) {
        await this.checkPauseOrStop();
        stepCount += 1;
        if (stepCount > MAX_STEPS) {
          this.emitEvent(
            this.buildEvent('TOOL_FAILED', `Step limit of ${MAX_STEPS} reached; stopping safely.`, {
              success: false,
            })
          );
          break;
        }
        if (!mapping.fact_value) {
          continue;
        }

        const field = formSnapshot.fields.find((candidate) => candidate.ref === mapping.field_ref);
        if (!field) {
          continue;
        }
        if (field.disabled) {
          this.emitEvent(
            this.buildEvent('TOOL_FAILED', `Skipped disabled field '${field.label}'.`, {
              success: false,
              metadata: { fieldRef: field.ref },
            })
          );
          continue;
        }

        // A single unusable field must not abort the whole session. Record it, keep
        // going, and surface it for human review at the end.
        try {
          await this.fillField(mapping, field);
        } catch (fieldError: any) {
          if (fieldError?.name === 'OperationCancelledError') {
            throw fieldError;
          }
          failedFields.push({
            field_ref: mapping.field_ref,
            field_label: field.label,
            reason: fieldError?.message || 'Field could not be populated.',
          });
          this.emitEvent(
            this.buildEvent(
              'TOOL_FAILED',
              `Skipped '${field.label}': ${fieldError?.message || 'could not be populated'}`,
              { success: false, metadata: { fieldRef: mapping.field_ref } }
            )
          );
        }
      }

      // Step 6: Verify every populated field.
      this.stateMachine.transition('VERIFYING');
      let verifiedCount = 0;
      for (const mapping of mappings) {
        if (!mapping.fact_value) continue;
        const result = await this.runTool<{ verified: boolean; actualValue: string; expectedValue: string }>(
          'verify_field',
          { fieldRef: mapping.field_ref, expectedValue: mapping.fact_value },
          `Verifying '${mapping.field_label}'...`,
          (outcome) =>
            outcome.verified
              ? `Verified '${mapping.field_label}'.`
              : `Mismatch on '${mapping.field_label}': expected '${outcome.expectedValue}', found '${outcome.actualValue}'.`,
          true
        );
        if (result.verified) {
          verifiedCount += 1;
        }
        verifications.push({
          field_ref: mapping.field_ref,
          field_label: mapping.field_label,
          expected_value: result.expectedValue,
          actual_value: result.actualValue,
          verified: result.verified,
        });
      }

      await this.persistVerifications(verifications);

      // Step 7: Enforce the submission prohibition based on the real page state.
      const detectedControls = await this.detectSubmissionControls();
      const submissionCheck = this.policyEngine.evaluateSubmissionControls(detectedControls);
      if (!submissionCheck.allowed) {
        this.emitEvent(
          this.buildEvent(
            'POLICY_BLOCKED',
            `[PolicyEngine] ${submissionCheck.code}: ${submissionCheck.reason}`,
            {
              success: false,
              metadata: {
                code: submissionCheck.code,
                controls: submissionCheck.controls,
              },
            }
          )
        );
      }

      this.stateMachine.transition('REVIEW_READY');
      const failureSummary =
        failedFields.length > 0
          ? ` ${failedFields.length} field(s) could not be populated and need operator attention.`
          : '';
      this.emitEvent(
        this.buildEvent(
          'STATE_CHANGED',
          `Form filling complete. ${verifiedCount}/${mappings.length} fields verified.` +
          `${failureSummary} Ready for human review and submission.`,
          {
            metadata: {
              failedFields,
              submissionControls: submissionCheck.controls,
            },
          }
        )
      );
    } catch (error: any) {
      if (error?.name === 'OperationCancelledError' || error?.message === 'WORKFLOW_STOPPED_BY_USER') {
        this.emitEvent(this.buildEvent('STATE_CHANGED', 'Session stopped by operator.'));
      } else if (error?.message === 'CLARIFICATION_TIMEOUT') {
        this.stateMachine.transition('ERROR');
        this.emitEvent(
          this.buildEvent(
            'TOOL_FAILED',
            'Clarification timed out. The session was left unchanged for human review.',
            { success: false }
          )
        );
      } else {
        this.stateMachine.transition('ERROR');
        this.emitEvent(
          this.buildEvent('TOOL_FAILED', `Workflow error: ${error?.message || error}`, {
            success: false,
          })
        );
        throw error;
      }
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  /**
   * Emit a tool-started event.
   *
   * @param tool Tool name.
   * @param description Human readable description.
   */
  private async emitToolStarted(tool: string, description: string): Promise<void> {
    this.emitEvent(this.buildEvent('TOOL_STARTED', description, { tool }));
  }

  /**
   * Dispatch a tool through the registry and emit truthful lifecycle events.
   *
   * @param toolName Tool to dispatch.
   * @param args Tool arguments.
   * @param startedDescription Description for the TOOL_STARTED event.
   * @param successDescription Builds the description for a successful outcome.
   * @param keepFailureAsEvent When true, a failed result is expected and returned.
   * @returns The tool result.
   * @throws ToolExecutionError when the tool fails and the caller did not opt in.
   */
  private async runTool<T>(
    toolName: string,
    args: Record<string, any>,
    startedDescription: string,
    successDescription: (result: T) => string,
    keepFailureAsEvent: boolean = false
  ): Promise<T> {
    await this.emitToolStarted(toolName, startedDescription);

    try {
      const result = await this.toolRegistry.dispatch<T>(toolName, args, this.createToolContext());

      // A tool may return success:false without throwing. Report that honestly.
      const successFlag = (result as any)?.success;
      if (successFlag === false) {
        this.emitEvent(
          this.buildEvent('TOOL_FAILED', successDescription(result), {
            tool: toolName,
            success: false,
            metadata: result as unknown as Record<string, unknown>,
          })
        );
        if (!keepFailureAsEvent) {
          throw new ToolExecutionError(
            `Tool '${toolName}' reported an unsuccessful result.`,
            'TOOL_RESULT_UNSUCCESSFUL'
          );
        }
        return result;
      }

      this.emitEvent(
        this.buildEvent('TOOL_COMPLETED', successDescription(result), {
          tool: toolName,
          success: true,
          metadata: result as unknown as Record<string, unknown>,
        })
      );
      return result;
    } catch (error: any) {
      if (error?.name === 'OperationCancelledError') {
        throw error;
      }
      this.emitEvent(
        this.buildEvent('TOOL_FAILED', `'${toolName}' failed: ${error?.message || error}`, {
          tool: toolName,
          success: false,
        })
      );
      throw error;
    }
  }

  /**
   * Fill one mapped field using the correct tool for its control type.
   *
   * @param mapping Field mapping to apply.
   * @param field Target field snapshot.
   */
  private async fillField(mapping: FieldMapping, field: FormFieldSnapshot): Promise<void> {
    const label = field.label;
    const value = String(mapping.fact_value ?? '');

    if (field.type === 'select') {
      await this.runTool(
        'select_option',
        { fieldRef: field.ref, option: value },
        `Selecting '${value}' for '${label}'...`,
        (result: any) =>
          result.success
            ? `Selected '${result.selectedOption}' for '${label}'.`
            : `Could not select '${value}' for '${label}'. ${result.reason || ''}`.trim(),
        false
      );
      return;
    }

    if (field.type === 'radio') {
      await this.runTool(
        'select_radio',
        { fieldRef: field.ref, optionValue: value },
        `Selecting '${value}' for '${label}'...`,
        (result: any) =>
          result.success
            ? `Selected '${result.selectedValue}' for '${label}'.`
            : `Could not select '${value}' for '${label}'.`,
        false
      );
      return;
    }

    if (field.type === 'checkbox') {
      const desired = this.resolveCheckboxState(mapping, field);
      await this.runTool(
        'set_checkbox',
        { fieldRef: field.ref, checked: desired },
        `${desired ? 'Checking' : 'Unchecking'} '${label}'...`,
        (result: any) =>
          result.success
            ? `'${label}' is now ${result.isChecked ? 'checked' : 'unchecked'}.`
            : `Could not set '${label}' to the desired state.`,
        false
      );
      return;
    }

    await this.runTool(
      'fill_text',
      { fieldRef: field.ref, value },
      `Filling '${label}'...`,
      (result: any) =>
        result.success
          ? `Filled '${label}'.`
          : `Value mismatch on '${label}': expected '${result.expectedValue}', entered '${result.actualValue}'.`,
      false
    );
  }

  /**
   * Persist verification records to the session audit trail.
   *
   * @param verifications Verification records produced by the verify phase.
   */
  private async persistVerifications(verifications: VerificationRecord[]): Promise<void> {
    if (!this.sessionId || verifications.length === 0) return;
    try {
      await this.backendClient.appendEvents(
        this.sessionId,
        [],
        verifications as unknown as Array<Record<string, unknown>>
      );
    } catch (error) {
      console.error('Could not persist verifications:', error);
    }
  }

  /**
   * Submit the active form upon explicit instruction from the human operator.
   *
   * Enforces the core safety rule: autonomous submission is forbidden; this method
   * can only be invoked by operator action when in REVIEW_READY or USER_TAKEOVER.
   */
  public async submitFormAsOperator(): Promise<{ success: boolean; message: string }> {
    const currentState = this.stateMachine.getState();
    if (currentState !== 'REVIEW_READY' && currentState !== 'USER_TAKEOVER') {
      throw new Error(`Cannot submit form in state: ${currentState}. Workflow must be in REVIEW_READY.`);
    }

    const result = await this.browserManager.submitFormManually();
    this.stateMachine.transition('COMPLETED');
    this.emitEvent(
      this.buildEvent(
        'STATE_CHANGED',
        'Application submitted successfully by human operator.',
        { success: true }
      )
    );
    return result;
  }

  /**
   * Close the browser and release resources.
   */
  public async cleanup(): Promise<void> {
    for (const [clarificationId, pending] of this.pendingClarifications.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new OperationCancelledError());
      this.pendingClarifications.delete(clarificationId);
    }
    await this.browserManager.close();
  }
}
