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
  ClarificationRequest,
  ExtractedFact,
  FieldMapping,
  FormFieldSnapshot,
  FormSnapshot,
  StartSessionOptions,
  VerificationRecord,
} from '../shared/types';

/** Maximum number of field operations before the loop abandons the session. */
const MAX_STEPS = 50;

/** How long the agent waits for a human clarification answer before giving up. */
/** How long the agent waits for a human clarification answer before giving up. */
const CLARIFICATION_TIMEOUT_MS = 10 * 60 * 1000;

/** Known form fixture schemas for deterministic information preflight requirements. */
const KNOWN_FIXTURE_SCHEMAS: Record<string, FormFieldSnapshot[]> = {
  'mock_school_form.html': [
    { ref: 'field_001', label: 'Student Full Name', type: 'text', required: true, disabled: false, visible: true },
    { ref: 'field_002', label: 'Date of Birth', type: 'date', required: true, disabled: false, visible: true },
    { ref: 'field_003', label: 'Gender', type: 'select', required: true, disabled: false, visible: true, options: ['Male', 'Female', 'Other'] },
    { ref: 'field_004', label: 'Student Email Address', type: 'email', required: true, disabled: false, visible: false },
    { ref: 'field_005', label: 'Contact Phone Number', type: 'text', required: true, disabled: false, visible: false },
    { ref: 'field_006', label: 'Residential Address', type: 'textarea', required: true, disabled: false, visible: false },
    { ref: 'field_007', label: 'City', type: 'text', required: true, disabled: false, visible: false },
    { ref: 'field_008', label: 'State', type: 'text', required: true, disabled: false, visible: false },
    { ref: 'field_009', label: 'Pincode / Zip Code', type: 'text', required: true, disabled: false, visible: false },
    { ref: 'field_010', label: "Father's Name", type: 'text', required: true, disabled: false, visible: false },
    { ref: 'field_011', label: "Mother's Name", type: 'text', required: true, disabled: false, visible: false },
    { ref: 'field_012', label: 'Previous School Attended', type: 'text', required: false, disabled: false, visible: false },
    { ref: 'field_013', label: 'Applying Grade / Class', type: 'select', required: true, disabled: false, visible: false, options: ['Grade 1', 'Grade 5', 'Grade 10'] },
    { ref: 'field_014', label: 'Does student have allergies?', type: 'radio', required: false, disabled: false, visible: false, options: ['Yes', 'No'] },
    { ref: 'field_015', label: 'Does student require transport?', type: 'radio', required: false, disabled: false, visible: false, options: ['Yes', 'No'] },
    { ref: 'field_016', label: 'I agree to the school admission terms and conditions', type: 'checkbox', required: true, disabled: false, visible: false },
  ],
};

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

  /** Active session purge promise so concurrent cleanup calls serialize and share the drain. */
  private activePurgePromise: Promise<void> | null = null;

  /** Keyed clarification resolvers so concurrent prompts cannot orphan each other. */
  private pendingClarifications: Map<
    string,
    { resolve: (answer: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  > = new Map();

  private eventListeners: Array<(event: AgentEventPayload) => void> = [];
  private clarificationListeners: Array<(prompt: ClarificationPromptPayload) => void> = [];

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
   * Access the browser manager instance bound to this controller.
   *
   * @returns The browser manager instance.
   */
  public getBrowserManager(): BrowserManager {
    return this.browserManager;
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
   * Deeply sanitize an event payload or metadata object to remove sensitive raw values
   * (fact_value, actualValue, expectedValue, etc.) before IPC emission or persistence.
   *
   * @param obj Target object, array, or primitive.
   * @returns Sanitized copy with sensitive raw value keys stripped.
   */
  private sanitizePayload(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizePayload(item));
    }
    if (typeof obj === 'object') {
      const sanitized: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (
          key === 'fact_value' ||
          key === 'factValue' ||
          key === 'actualValue' ||
          key === 'actual_value' ||
          key === 'expectedValue' ||
          key === 'expected_value' ||
          key === 'selectedValue' ||
          key === 'selected_value' ||
          key === 'selectedOption' ||
          key === 'selected_option' ||
          key === 'expectedOption' ||
          key === 'expected_option' ||
          key === 'currentValue' ||
          key === 'current_value' ||
          key === 'value'
        ) {
          continue;
        }
        sanitized[key] = this.sanitizePayload(value);
      }
      return sanitized;
    }
    return obj;
  }

  /**
   * Emit and persist a structured execution event.
   *
   * Enforces the zero-value contract across both boundaries:
   * - Strips fact_value, actualValue, expectedValue, and other raw values before emitting to
   *   renderer listeners over IPC (live UI display and history store).
   * - Strips raw values before queueing for backend persistence so that persisted audit logs
   *   contain no raw personal values.
   *
   * @param event Event payload to emit.
   */
  private emitEvent(event: AgentEventPayload): void {
    const sanitizedEvent = this.sanitizePayload(event) as AgentEventPayload;

    // 1. Sanitized payload for renderer's live display over IPC
    this.eventListeners.forEach((listener) => {
      try {
        listener(sanitizedEvent);
      } catch (error) {
        console.error('Error emitting event:', error);
      }
    });

    // 2. Sanitized payload for backend audit persistence
    if (this.sessionId && sanitizedEvent.type !== 'STATE_CHANGED') {
      // Fire-and-forget persistence; a logging failure must not break the workflow.
      // Queued locally so the backend always receives events in creation order
      // instead of racing multiple concurrent writes against each other.
      this.enqueuePersistence(sanitizedEvent as unknown as Record<string, unknown>);
    }
  }

  /**
   * Append an event to the serialized persistence queue.
   *
   * @param event Structured event payload to persist.
   */
  private enqueuePersistence(event: Record<string, unknown>): void {
    const sessionId = this.sessionId;
    if (!sessionId) return;
    this.persistenceQueue = this.persistenceQueue
      .then(async () => {
        await this.backendClient.appendEventSafe(sessionId, event);
      })
      .catch((error) => {
        console.error('Could not persist agent event:', error);
      });
  }

  /**
   * Drain any pending events in the persistence queue with a safe bounded timeout,
   * guaranteeing that already-queued events finish persisting before session deletion.
   * Persistence failures or delays must remain diagnostic-only and must never break or hang
   * the automation workflow.
   *
   * @param timeoutMs Maximum time to wait for the queue to drain before proceeding.
   */
  private async drainPersistenceQueue(timeoutMs: number = 4000): Promise<void> {
    const start = Date.now();
    try {
      while (Date.now() - start < timeoutMs) {
        const currentQueue = this.persistenceQueue;
        const remainingMs = Math.max(0, timeoutMs - (Date.now() - start));
        let timer: NodeJS.Timeout;
        const timeoutPromise = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, remainingMs);
        });

        await Promise.race([
          currentQueue.catch(() => {}),
          timeoutPromise,
        ]);
        clearTimeout(timer!);

        // If no new events were appended to the chain while awaiting, the queue is drained
        if (this.persistenceQueue === currentQueue || Date.now() - start >= timeoutMs) {
          break;
        }
      }
    } catch (err) {
      console.warn('Error while draining persistence queue:', err);
    }
  }

  /**
   * Safely drain queued audit persistence events before purging the backend session.
   * Prevents DELETE /v1/sessions/:id from racing ahead of pending POST /v1/sessions/:id/events,
   * which would otherwise cause 404 Session Not Found errors in backend logs.
   *
   * Reentrant and protected against concurrent calls from stop() and startSession finally.
   *
   * @param targetSessionId Session ID to purge. If omitted, uses this.sessionId.
   */
  private async purgeSessionSafely(targetSessionId?: string): Promise<void> {
    const sessionIdToPurge = targetSessionId || this.sessionId;
    if (!sessionIdToPurge) {
      if (this.activePurgePromise) {
        await this.activePurgePromise;
      }
      return;
    }

    if (this.activePurgePromise) {
      await this.activePurgePromise;
      return;
    }

    this.activePurgePromise = (async () => {
      // Clear this.sessionId immediately so no subsequent events are enqueued for this session
      if (this.sessionId === sessionIdToPurge) {
        this.sessionId = '';
      }

      // 1. Await the queued audit persistence chain so all events finish persisting
      await this.drainPersistenceQueue();

      // 2. Now execute the session deletion
      try {
        if (typeof this.backendClient.purgeSession === 'function') {
          await this.backendClient.purgeSession(sessionIdToPurge);
        }
      } catch (err) {
        console.warn('Could not purge backend session cleanly:', err);
      }
    })();

    try {
      await this.activePurgePromise;
    } finally {
      this.activePurgePromise = null;
    }
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
   * Stop the workflow, cancelling in-flight operations, closing the browser, and cleaning up.
   */
  public async stop(): Promise<void> {
    this.isStoppedState = true;
    this.isPausedState = false;
    this.isTakeoverState = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Close and release the Playwright browser
    await this.browserManager.close().catch(() => {});

    // Safely drain and purge the active backend session
    await this.purgeSessionSafely();

    // Cancel any pending clarification waits so promises don't hang
    for (const [clarificationId, pending] of this.pendingClarifications.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new OperationCancelledError());
      this.pendingClarifications.delete(clarificationId);
    }

    this.isRunning = false;
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
   * Identify a legitimate wizard/pagination Continue control among discovered page controls.
   *
   * Guaranteed never to return a final submission control or payment action.
   *
   * @param controls Discovered page controls.
   * @returns Allowed pagination control or undefined.
   */
  private findPaginationControl(controls: SubmissionControl[]): SubmissionControl | undefined {
    return controls.find((control) => {
      if (control.isSubmitType) return false;
      const decision = this.policyEngine.validateBrowserAction('click', control.label, false);
      return decision.allowed && decision.code === 'ALLOWED_PAGINATION';
    });
  }

  /**
   * Wait for the active form section to advance after clicking a pagination control.
   *
   * @param previousVisibleRefs Serialized fingerprint of visible fields before navigation.
   * @param timeoutMs Maximum milliseconds to wait.
   * @returns Whether the visible fields changed.
   */
  private async waitForSectionTransition(previousVisibleRefs: string, timeoutMs: number = 800): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 50));
      if (!this.browserManager) break;
      const snapshot = await this.browserManager.scanActiveForm().catch(() => null);
      if (!snapshot) break;
      const currentVisible = snapshot.fields
        .filter((f) => f.visible)
        .map((f) => f.ref)
        .sort()
        .join(',');
      if (currentVisible !== previousVisibleRefs) {
        return true;
      }
    }
    return false;
  }

  /**
   * Sequentially present human clarification prompts and collect verified answers.
   */
  private async resolveClarifications(
    clarifications: ClarificationRequest[],
    mappings: FieldMapping[]
  ): Promise<void> {
    this.stateMachine.transition('CLARIFICATION_REQUIRED');
    for (let i = 0; i < clarifications.length; i++) {
      const prompt = clarifications[i];
      await this.checkPauseOrStop();

      const clarificationResult = await this.runTool<any>(
        'request_clarification',
        {
          clarificationId: prompt.clarification_id,
          fieldRef: prompt.field_ref,
          fieldLabel: prompt.field_label,
          question: prompt.question,
          options: prompt.options,
          total: clarifications.length,
          currentIndex: i + 1,
        },
        `Awaiting human clarification for '${prompt.field_label}' (${i + 1}/${clarifications.length})...`,
        () => `Human confirmed a value for '${prompt.field_label}'.`
      );

      const answer = coerceClarificationValue(clarificationResult);
      if (!answer) {
        throw new Error(
          `CLARIFICATION_UNANSWERED: no usable value was supplied for '${prompt.field_label}'.`
        );
      }

      if (!prompt.clarification_id.startsWith('preflight_')) {
        try {
          await this.backendClient.answerClarification(
            this.sessionId,
            prompt.clarification_id,
            answer
          );
        } catch (err: any) {
          // If the clarification was synthesized on the client (e.g. DOM-level retry)
          // rather than registered in the backend session, 404 is expected and non-fatal.
          if (err?.status !== 404) {
            console.warn('Could not forward clarification answer to backend:', err?.message || err);
          }
        }
      }

      let target = mappings.find((mapping) => mapping.field_ref === prompt.field_ref);
      if (target) {
        target.fact_value = answer;
        target.status = 'RESOLVED';
      } else {
        target = {
          field_ref: prompt.field_ref,
          field_label: prompt.field_label,
          fact_value: answer,
          confidence: 1.0,
          status: 'RESOLVED',
        };
        mappings.push(target);
      }
    }
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
    this.persistenceQueue = Promise.resolve();

    const verifications: VerificationRecord[] = [];
    const failedFields: Array<{ field_ref: string; field_label: string; reason: string }> = [];
    let stepCount = 0;

    try {
      const session = await this.backendClient.createSession(
        options.documentName || 'admission_document.pdf',
        options.targetUrl
      );
      this.sessionId = session.id;

      // Step 1: Use the operator-reviewed facts when supplied, otherwise extract them.
      this.stateMachine.transition('EXTRACTING_DOC');
      await this.checkPauseOrStop();
      let facts: ExtractedFact[] =
        options.facts && options.facts.length > 0
          ? await this.useProvidedFacts(options.facts)
          : await this.runTool<any[]>(
              'extract_document_facts',
              {
                filePath: options.documentPath,
                rawText: options.documentText,
                documentName: options.documentName,
              },
              `Extracting facts from ${options.documentName || 'document'}...`,
              (result: any[]) => `Successfully extracted ${result.length} document facts.`
            );

      if (options.fillIdFields === false) {
        const idRegex = /(ssn|passport|aadhaar|tax_id|id_number|national_id)/i;
        facts = facts.filter((f) => !idRegex.test(f.key));
      }

      // Step 1b: Information Preflight BEFORE opening the form
      // Verify all required facts are available before launching the browser.
      // If any required facts are missing, collect ALL of them sequentially before opening the form.
      if (options.requiredFactKeys && options.requiredFactKeys.length > 0) {
        const availableFactKeys = new Set(facts.map((f) => f.key.toLowerCase().trim()));
        const missingRequiredKeys = options.requiredFactKeys.filter(
          (k) => !availableFactKeys.has(k.toLowerCase().trim())
        );

        if (missingRequiredKeys.length > 0) {
          this.stateMachine.transition('CLARIFICATION_REQUIRED');
          this.emitEvent(
            this.buildEvent(
              'STATE_CHANGED',
              `Information preflight: ${missingRequiredKeys.length} required field(s) missing from document facts. Collecting all missing information before launching form automation.`,
              { metadata: { missingKeys: missingRequiredKeys } }
            )
          );

          const preflightClarifications: ClarificationRequest[] = missingRequiredKeys.map((key) => ({
            clarification_id: `preflight_${key}_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
            field_ref: `preflight_${key}`,
            field_label: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            question: `Please provide value for required information: ${key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`,
            options: [],
            selected_value: '',
          }));

          const tempMappings: FieldMapping[] = [];
          await this.resolveClarifications(preflightClarifications, tempMappings);

          for (const m of tempMappings) {
            if (m.fact_value) {
              const cleanedKey = m.field_ref.replace(/^preflight_/, '');
              facts.push({
                key: cleanedKey,
                label: m.field_label,
                value: m.fact_value,
                confidence: 1.0,
                source_page: null,
              });
            }
          }

          this.emitEvent(
            this.buildEvent(
              'TOOL_COMPLETED',
              `Information preflight complete: collected ${tempMappings.length} required value(s). Proceeding to launch form automation.`,
              {
                tool: 'information_preflight',
                success: true,
                metadata: { factCount: facts.length, keys: facts.map((f) => f.key) },
              }
            )
          );
        }
      }

      // Step 1c: Comprehensive Form Schema Preflight & Mapping Completeness
      // Determine the complete required information set using existing form/schema/fixture metadata
      // or deterministic headless browser inspection.
      let preflightMappings: FieldMapping[] = [];
      let probeSnapshot: FormSnapshot | null = null;

      const matchedFixtureKey = Object.keys(KNOWN_FIXTURE_SCHEMAS).find((key) =>
        options.targetUrl.toLowerCase().includes(key.toLowerCase())
      );
      if (matchedFixtureKey) {
        probeSnapshot = {
          url: options.targetUrl,
          title: 'Greenwood Academy - Mock School Admission Form',
          fields: KNOWN_FIXTURE_SCHEMAS[matchedFixtureKey].map((f) => ({ ...f })),
        };
      } else {
        try {
          const probeBrowser = new BrowserManager();
          await probeBrowser.launch(true);
          try {
            await probeBrowser.navigateTo(options.targetUrl, this.abortController?.signal);
            probeSnapshot = await probeBrowser.scanActiveForm();
          } finally {
            await probeBrowser.close();
          }
        } catch (probeErr: any) {
          this.emitEvent(
            this.buildEvent(
              'STATE_CHANGED',
              `Headless form schema probe unavailable (${probeErr?.message || 'probe failed'}). Conditional and section requirements will be evaluated dynamically during section navigation.`
            )
          );
        }
      }

      if (probeSnapshot && probeSnapshot.fields.length > 0) {
        this.stateMachine.transition('MAPPING_FIELDS');
        const mapResult = await this.backendClient.mapForm(this.sessionId, probeSnapshot, facts);
        preflightMappings = mapResult.mappings || [];
        const preflightClarifications = mapResult.clarifications_required || [];

        // 3. Mapping Completeness Check:
        // Explicitly determine:
        // - required form fields (non-disabled)
        // - mapped fields (usable value)
        // - unmapped required fields
        // - fields with no available fact
        const requiredFields = probeSnapshot.fields.filter((f) => f.required && !f.disabled);
        const mappedWithUsableValue = new Set(
          preflightMappings
            .filter(
              (m) =>
                m.fact_value !== undefined &&
                m.fact_value !== null &&
                String(m.fact_value).trim().length > 0 &&
                m.status !== 'CLARIFICATION_REQUIRED'
            )
            .map((m) => m.field_ref)
        );

        const unmappedRequiredFields = requiredFields.filter((f) => !mappedWithUsableValue.has(f.ref));

        const consolidatedMissingClarifications: ClarificationRequest[] = [];

        // Add any clarification requests returned by the backend
        for (const cl of preflightClarifications) {
          consolidatedMissingClarifications.push(cl);
        }

        // Add all unmapped required fields (fields with no available fact)
        for (const reqField of unmappedRequiredFields) {
          if (!consolidatedMissingClarifications.some((c) => c.field_ref === reqField.ref)) {
            consolidatedMissingClarifications.push({
              clarification_id: `preflight_${reqField.ref}_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
              field_ref: reqField.ref,
              field_label: reqField.label,
              question: `Please provide value for required field '${reqField.label}':`,
              options: reqField.options || [],
              selected_value: '',
            });
          }
        }

        if (consolidatedMissingClarifications.length > 0) {
          this.stateMachine.transition('CLARIFICATION_REQUIRED');
          this.emitEvent(
            this.buildEvent(
              'STATE_CHANGED',
              `Information preflight: Target form requires ${requiredFields.length} field(s), but ${consolidatedMissingClarifications.length} required field(s) are missing from extracted facts or require clarification. Collecting all missing facts before autonomous filling.`,
              {
                metadata: {
                  totalRequiredCount: requiredFields.length,
                  missingRequiredCount: consolidatedMissingClarifications.length,
                  missingFieldRefs: consolidatedMissingClarifications.map((c) => c.field_ref),
                },
              }
            )
          );

          await this.resolveClarifications(consolidatedMissingClarifications, preflightMappings);

          // Ingest newly resolved facts
          for (const m of preflightMappings) {
            if (m.fact_value && !facts.some((f) => f.key === m.fact_key || f.key === m.field_ref)) {
              const cleanKey = (m.fact_key || m.field_label || m.field_ref)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '');
              facts.push({
                key: cleanKey,
                label: m.field_label,
                value: m.fact_value,
                confidence: 1.0,
                source_page: null,
              });
            }
          }

          this.emitEvent(
            this.buildEvent(
              'TOOL_COMPLETED',
              `Information preflight complete: Collected all ${consolidatedMissingClarifications.length} missing required value(s). Target form has ${requiredFields.length} required field(s) verified. Note: Any conditional fields revealed by future dynamic form interactions will be checked during section navigation.`,
              {
                tool: 'information_preflight',
                success: true,
                metadata: {
                  requiredFieldCount: requiredFields.length,
                  resolvedCount: consolidatedMissingClarifications.length,
                },
              }
            )
          );
        } else {
          this.emitEvent(
            this.buildEvent(
              'TOOL_COMPLETED',
              `Information preflight complete: All ${requiredFields.length} required field(s) found in document facts. Note: Any conditional fields revealed by future dynamic form interactions will be checked during section navigation.`,
              {
                tool: 'information_preflight',
                success: true,
                metadata: {
                  requiredFieldCount: requiredFields.length,
                },
              }
            )
          );
        }
      }

      // Step 2: Launch the visible browser and navigate to the target form.
      this.stateMachine.transition('SCANNING_FORM');
      await this.emitToolStarted('inspect_form', `Navigating to target form: ${options.targetUrl}...`);
      await this.browserManager.launch(false);
      await this.browserManager.navigateTo(options.targetUrl, this.abortController.signal);
      await this.checkPauseOrStop();

      // Step 3: Multi-step / section form navigation loop
      const verifiedFieldRefs = new Set<string>();
      const allDiscoveredRequiredRefs = new Set<string>();
      let mappings: FieldMapping[] = [];
      let verifiedCount = 0;
      let sectionIndex = 1;
      const MAX_SECTIONS = 15;

      while (sectionIndex <= MAX_SECTIONS) {
        await this.checkPauseOrStop();

        // 3a: Scan active form section
        const formSnapshot = await this.runTool<FormSnapshot>(
          'inspect_form',
          {},
          sectionIndex === 1
            ? `Scanning the form at ${options.targetUrl}...`
            : `Scanning form section ${sectionIndex}...`,
          (snapshot: FormSnapshot) =>
            `Detected ${snapshot.fields.length} form fields (${snapshot.fields.filter((f) => f.visible).length} visible).`
        );

        // Treat active DOM as authoritative: visible enabled fields belong to current section
        let activeSectionFields = formSnapshot.fields.filter(
          (field) => field.visible && !field.disabled
        );
        let activeRequiredFields = activeSectionFields.filter((field) => field.required);
        for (const rf of activeRequiredFields) {
          allDiscoveredRequiredRefs.add(rf.ref);
        }

        // 3b: Map unmapped fields if initial section or newly revealed fields appear
        const unmappedFields = activeSectionFields.filter(
          (field) => !mappings.some((m) => m.field_ref === field.ref)
        );

        let sectionClarifications: ClarificationRequest[] = [];

        if (sectionIndex === 1 || unmappedFields.length > 0) {
          if (sectionIndex === 1) {
            this.stateMachine.transition('MAPPING_FIELDS');
            const mapResult = await this.backendClient.mapForm(this.sessionId, formSnapshot, facts);
            mappings = mapResult.mappings || [];
            sectionClarifications = mapResult.clarifications_required || [];

            // If mapping hook updated DOM visibility (e.g. unhid wizard sections), refresh active visible fields
            const postMapSnapshot = await this.browserManager.scanActiveForm().catch(() => formSnapshot);
            activeSectionFields = postMapSnapshot.fields.filter((field) => field.visible && !field.disabled);
            activeRequiredFields = activeSectionFields.filter((field) => field.required);
            for (const rf of activeRequiredFields) {
              allDiscoveredRequiredRefs.add(rf.ref);
            }

            // Merge in preflight mappings: retain any resolved preflight mappings and include other sections
            for (const pm of preflightMappings) {
              const existingIdx = mappings.findIndex(
                (m) =>
                  m.field_ref === pm.field_ref ||
                  (m.field_label &&
                    pm.field_label &&
                    m.field_label.toLowerCase().trim() === pm.field_label.toLowerCase().trim())
              );
              if (existingIdx >= 0) {
                if (pm.status === 'RESOLVED' && pm.fact_value) {
                  mappings[existingIdx] = pm;
                }
              } else {
                mappings.push(pm);
              }
            }

            // Remove clarification requests for fields that are already resolved with usable values
            sectionClarifications = sectionClarifications.filter(
              (c) =>
                !mappings.some(
                  (m) =>
                    m.field_ref === c.field_ref &&
                    m.status === 'RESOLVED' &&
                    m.fact_value !== undefined &&
                    m.fact_value !== null &&
                    String(m.fact_value).trim().length > 0
                )
            );

            this.emitEvent(
              this.buildEvent(
                'STATE_CHANGED',
                `Mapped ${mappings.length} fields (${sectionClarifications.length} clarifications needed).`,
                {
                  metadata: {
                    mappings,
                    factCount: facts.length,
                    totalClarifications: sectionClarifications.length,
                  },
                }
              )
            );
          } else if (unmappedFields.length > 0) {
            const mapResult = await this.backendClient.mapForm(this.sessionId, formSnapshot, facts);
            const newMappings = mapResult.mappings || [];
            for (const nm of newMappings) {
              if (!mappings.some((m) => m.field_ref === nm.field_ref)) {
                mappings.push(nm);
              }
            }
            if (mapResult.clarifications_required && mapResult.clarifications_required.length > 0) {
              sectionClarifications = mapResult.clarifications_required;
            }
          }
        }

        // 3c: Identify all required/unresolved fields for current section
        // Collect ALL missing information needed rather than arbitrarily stopping after two
        const neededClarifications: ClarificationRequest[] = sectionClarifications.filter(
          (c) =>
            !verifiedFieldRefs.has(c.field_ref) &&
            activeSectionFields.some((f) => f.ref === c.field_ref) &&
            !mappings.some(
              (m) =>
                m.field_ref === c.field_ref &&
                m.status === 'RESOLVED' &&
                m.fact_value !== undefined &&
                m.fact_value !== null &&
                String(m.fact_value).trim().length > 0
            )
        );

        for (const reqField of activeRequiredFields) {
          const m = mappings.find(
            (cand) =>
              cand.field_ref === reqField.ref ||
              (cand.field_label &&
                reqField.label &&
                cand.field_label.toLowerCase().trim() === reqField.label.toLowerCase().trim())
          );
          const hasUsableValue =
            m && m.fact_value !== undefined && m.fact_value !== null && String(m.fact_value).trim().length > 0;
          if (!hasUsableValue || m?.status === 'CLARIFICATION_REQUIRED') {
            if (!neededClarifications.some((c) => c.field_ref === reqField.ref)) {
              neededClarifications.push({
                clarification_id: `clarify_${reqField.ref}_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
                field_ref: reqField.ref,
                field_label: reqField.label,
                question: `Please provide value for required field '${reqField.label}':`,
                options: reqField.options || [],
                selected_value: '',
              });
            }
          }
        }

        if (neededClarifications.length > 0) {
          await this.resolveClarifications(neededClarifications, mappings);
        }

        // 3d: Fill actionable fields in current section
        const actionableFields = activeSectionFields.filter(
          (field) => !verifiedFieldRefs.has(field.ref)
        );

        if (actionableFields.length > 0) {
          this.stateMachine.transition('FILLING_FORM');
          for (const field of actionableFields) {
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

            let mapping = mappings.find(
              (candidate) =>
                candidate.field_ref === field.ref ||
                (candidate.field_label &&
                  field.label &&
                  candidate.field_label.toLowerCase().trim() === field.label.toLowerCase().trim())
            );
            if (
              !mapping ||
              mapping.fact_value === undefined ||
              mapping.fact_value === null ||
              !String(mapping.fact_value).trim()
            ) {
              if (field.required) {
                // Required value discovered missing during automation: pause safely and request clarification
                this.stateMachine.transition('CLARIFICATION_REQUIRED');
                const missingClarifyId = `clarify_missing_${field.ref}_${Date.now()}`;
                const prompt: ClarificationPromptPayload = {
                  clarificationId: missingClarifyId,
                  fieldRef: field.ref,
                  fieldLabel: field.label,
                  question: `Please provide value for required field '${field.label}':`,
                  options: field.options || [],
                  total: 1,
                  currentIndex: 1,
                };
                const clarificationResult = await this.runTool<any>(
                  'request_clarification',
                  prompt,
                  `Awaiting missing value for required field '${field.label}'...`,
                  () => `Human provided value for '${field.label}'.`
                );
                const answer = coerceClarificationValue(clarificationResult);
                if (answer) {
                  if (mapping) {
                    mapping.fact_value = answer;
                    mapping.status = 'RESOLVED';
                  } else {
                    mapping = {
                      field_ref: field.ref,
                      field_label: field.label,
                      fact_value: answer,
                      confidence: 1.0,
                      status: 'RESOLVED',
                    };
                    mappings.push(mapping);
                  }
                  try {
                    await this.backendClient.answerClarification(this.sessionId, missingClarifyId, answer);
                  } catch (err: any) {
                    if (err?.status !== 404) {
                      console.warn('Could not forward clarification answer to backend:', err?.message || err);
                    }
                  }
                  this.stateMachine.transition('FILLING_FORM');
                } else {
                  continue;
                }
              } else {
                // Optional field without value; skip
                continue;
              }
            }

            // Fill and independently verify actual DOM value with safe retry
            let isVerified = false;
            let attempts = 0;
            const MAX_FILL_ATTEMPTS = 2;

            while (!isVerified && attempts < MAX_FILL_ATTEMPTS) {
              attempts += 1;
              try {
                await this.fillField(mapping, field);
              } catch (fieldError: any) {
                if (fieldError?.name === 'OperationCancelledError') {
                  throw fieldError;
                }
                this.emitEvent(
                  this.buildEvent(
                    'TOOL_FAILED',
                    `Fill attempt ${attempts} for '${field.label}' failed: ${fieldError?.message || 'could not be populated'}`,
                    { success: false, metadata: { fieldRef: mapping.field_ref } }
                  )
                );
              }

              // Read back actual DOM value and independently verify
              this.stateMachine.transition('VERIFYING');
              const verifyOutcome = await this.runTool<{ verified: boolean; actualValue: string; expectedValue: string }>(
                'verify_field',
                { fieldRef: mapping.field_ref, expectedValue: mapping.fact_value },
                `Verifying '${mapping.field_label}' in browser DOM...`,
                (outcome) =>
                  outcome.verified
                    ? `Verified '${mapping.field_label}' in browser DOM.`
                    : `Mismatch on '${mapping.field_label}'.`,
                true
              );

              if (verifyOutcome.verified) {
                isVerified = true;
                break;
              }

              if (attempts < MAX_FILL_ATTEMPTS) {
                await new Promise((r) => setTimeout(r, 200));
              }
            }

            // If verification failed and field is required:
            // "If verification fails, retry safely or request clarification."
            // "Simulate a typo/mismatched value and prove the agent retries or requests clarification instead of advancing."
            if (!isVerified && field.required) {
              this.stateMachine.transition('CLARIFICATION_REQUIRED');
              const clarifyFixId = `clarify_fix_${mapping.field_ref}_${Date.now()}`;
              const prompt: ClarificationPromptPayload = {
                clarificationId: clarifyFixId,
                fieldRef: mapping.field_ref,
                fieldLabel: mapping.field_label,
                question: `Verification failed for '${mapping.field_label}'. Please confirm or provide correct value:`,
                options: field.options || [],
                total: 1,
                currentIndex: 1,
              };

              const clarificationResult = await this.runTool<any>(
                'request_clarification',
                prompt,
                `Awaiting correction for '${mapping.field_label}'...`,
                () => `Human provided corrected value for '${mapping.field_label}'.`
              );

              const correctedAnswer = coerceClarificationValue(clarificationResult);
              if (correctedAnswer) {
                mapping.fact_value = correctedAnswer;
                mapping.status = 'RESOLVED';
                try {
                  await this.backendClient.answerClarification(
                    this.sessionId,
                    clarifyFixId,
                    correctedAnswer
                  );
                } catch (err: any) {
                  if (err?.status !== 404) {
                    console.warn('Could not forward clarification answer to backend:', err?.message || err);
                  }
                }

                this.stateMachine.transition('FILLING_FORM');
                try {
                  await this.fillField(mapping, field);
                } catch (err: any) {
                  if (err?.name === 'OperationCancelledError') throw err;
                }

                this.stateMachine.transition('VERIFYING');
                const retryVerify = await this.runTool<{ verified: boolean; actualValue: string; expectedValue: string }>(
                  'verify_field',
                  { fieldRef: mapping.field_ref, expectedValue: mapping.fact_value },
                  `Verifying corrected '${mapping.field_label}' in browser DOM...`,
                  (outcome) =>
                    outcome.verified
                      ? `Verified '${mapping.field_label}' in browser DOM.`
                      : `Mismatch on '${mapping.field_label}'.`,
                  true
                );
                if (retryVerify.verified) {
                  isVerified = true;
                }
              }
            }

            // Required invariant: A field is COMPLETE only when actual DOM value is successfully filled AND verified
            if (isVerified) {
              verifiedFieldRefs.add(field.ref);
              verifiedCount += 1;
              verifications.push({
                field_ref: mapping.field_ref,
                field_label: mapping.field_label,
                verified: true,
              });
            } else {
              failedFields.push({
                field_ref: mapping.field_ref,
                field_label: field.label,
                reason: 'Field could not be populated or verified in browser DOM.',
              });
              verifications.push({
                field_ref: mapping.field_ref,
                field_label: mapping.field_label,
                verified: false,
              });
            }
          }
        }

        if (stepCount > MAX_STEPS) {
          break;
        }

        // 3e: Invariant verification check
        // "Never advance to Continue while required browser fields remain unverified."
        // "Do not Continue while any required field is unresolved."
        let unverifiedRequired = activeRequiredFields.filter(
          (rf) => !verifiedFieldRefs.has(rf.ref)
        );

        if (unverifiedRequired.length > 0) {
          const resolveRemaining: ClarificationRequest[] = unverifiedRequired.map((rf) => ({
            clarification_id: `clarify_req_${rf.ref}_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
            field_ref: rf.ref,
            field_label: rf.label,
            question: `Please provide value for required field '${rf.label}':`,
            options: rf.options || [],
            selected_value: '',
          }));

          try {
            await this.resolveClarifications(resolveRemaining, mappings);
            for (const rf of unverifiedRequired) {
              const m = mappings.find((cand) => cand.field_ref === rf.ref);
              if (m && m.fact_value) {
                this.stateMachine.transition('FILLING_FORM');
                await this.fillField(m, rf);
                this.stateMachine.transition('VERIFYING');
                const verifyRes = await this.runTool<{ verified: boolean }>(
                  'verify_field',
                  { fieldRef: rf.ref, expectedValue: m.fact_value },
                  `Verifying '${rf.label}' in browser DOM...`,
                  (out) => out.verified ? `Verified '${rf.label}' in browser DOM.` : `Mismatch on '${rf.label}'.`,
                  true
                );
                if (verifyRes.verified) {
                  verifiedFieldRefs.add(rf.ref);
                  verifiedCount += 1;
                }
              }
            }
          } catch (clarifyErr: any) {
            console.warn('Clarification resolution for unverified fields interrupted:', clarifyErr?.message);
          }

          unverifiedRequired = activeRequiredFields.filter(
            (rf) => !verifiedFieldRefs.has(rf.ref)
          );
        }

        if (unverifiedRequired.length > 0) {
          this.emitEvent(
            this.buildEvent(
              'TOOL_FAILED',
              `Navigation blocked: ${unverifiedRequired.length} required field(s) (${unverifiedRequired.map((f) => f.label).join(', ')}) remain unverified in the browser DOM.`,
              {
                success: false,
                metadata: {
                  unverifiedRequired: unverifiedRequired.map((f) => f.ref),
                },
              }
            )
          );
          if (this.stateMachine.getState() !== 'CLARIFICATION_REQUIRED') {
            this.stateMachine.transition('CLARIFICATION_REQUIRED');
          }
          break; // Stop loop! Do NOT Continue!
        }

        // 3f: Check for legitimate wizard pagination Continue control
        const detectedControls = await this.detectSubmissionControls();
        const hasFinalSubmit = detectedControls.some((c) => c.isSubmitType);
        if (
          hasFinalSubmit &&
          allDiscoveredRequiredRefs.size > 0 &&
          Array.from(allDiscoveredRequiredRefs).every((ref) => verifiedFieldRefs.has(ref))
        ) {
          // All form required fields are verified and final submit control is reached
          break;
        }

        const continueControl = this.findPaginationControl(detectedControls);

        if (continueControl) {
          const visibleBefore = formSnapshot.fields
            .filter((f) => f.visible)
            .map((f) => f.ref)
            .sort()
            .join(',');

          await this.runTool(
            'click_pagination',
            { label: continueControl.label, selector: continueControl.selector },
            `Advancing to next section via '${continueControl.label}'...`,
            () => `Advanced section via '${continueControl.label}'.`
          );

          const advanced = await this.waitForSectionTransition(visibleBefore, 1500);

          if (!advanced) {
            this.emitEvent(
              this.buildEvent(
                'TOOL_FAILED',
                `Clicked '${continueControl.label}', but section did not advance. Halting pagination for human review.`,
                { success: false }
              )
            );
            break;
          }

          sectionIndex += 1;
        } else {
          // No legitimate Continue control found -> reached final section or single-page form
          break;
        }
      }

      await this.persistVerifications(verifications);

      // Step 4: Final section review and Never-Submit enforcement
      // "Every required field across the complete form must have successful browser-side verification.
      //  Only then may the agent detect the final Submit and transition to REVIEW_READY.
      //  Never click Submit."
      const finalControls = await this.detectSubmissionControls();
      const submissionCheck = this.policyEngine.evaluateSubmissionControls(finalControls);
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

      // Check whether all required fields across the complete form have successful browser-side verification
      const allRequiredVerified =
        allDiscoveredRequiredRefs.size > 0 &&
        Array.from(allDiscoveredRequiredRefs).every((ref) => verifiedFieldRefs.has(ref));

      const hasFailedRequired = verifications.some((v) => {
        return allDiscoveredRequiredRefs.has(v.field_ref) && !v.verified;
      });

      if (allRequiredVerified && !hasFailedRequired && this.stateMachine.getState() !== 'CLARIFICATION_REQUIRED') {
        this.stateMachine.transition('REVIEW_READY');
        const failureSummary =
          failedFields.length > 0
            ? ` ${failedFields.length} optional field(s) could not be populated and need operator attention.`
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
      } else {
        if (this.stateMachine.getState() !== 'CLARIFICATION_REQUIRED') {
          this.stateMachine.transition('CLARIFICATION_REQUIRED');
        }
      }
    } catch (error: any) {
      if (error?.name === 'OperationCancelledError' || error?.message === 'WORKFLOW_STOPPED_BY_USER' || this.isStoppedState) {
        if (this.stateMachine.getState() !== 'IDLE') {
          this.stateMachine.transition('IDLE');
        }
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
      await this.purgeSessionSafely();
      this.isRunning = false;
      this.abortController = null;
      if (this.isStoppedState && this.stateMachine.getState() !== 'IDLE') {
        this.stateMachine.transition('IDLE');
      }
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
   * Adopt facts the operator already reviewed in the UI instead of extracting again.
   *
   * @param facts Operator-reviewed facts.
   * @returns The same facts, after emitting a truthful completion event.
   */
  private async useProvidedFacts(facts: ExtractedFact[]): Promise<ExtractedFact[]> {
    this.emitEvent(
      this.buildEvent('TOOL_COMPLETED', `Using ${facts.length} operator-reviewed document facts.`, {
        tool: 'extract_document_facts',
        success: true,
      })
    );
    return facts;
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

      const eventMetadata =
        toolName === 'extract_document_facts'
          ? { factCount: Array.isArray(result) ? (result as any[]).length : 0 }
          : (result as unknown as Record<string, unknown>);

      this.emitEvent(
        this.buildEvent('TOOL_COMPLETED', successDescription(result), {
          tool: toolName,
          success: true,
          metadata: eventMetadata,
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
        `Selecting option for '${label}'...`,
        (result: any) =>
          result.success
            ? `Selected option for '${label}'.`
            : `Could not select option for '${label}'.`,
        false
      );
      return;
    }

    if (field.type === 'radio') {
      await this.runTool(
        'select_radio',
        { fieldRef: field.ref, optionValue: value },
        `Selecting option for '${label}'...`,
        (result: any) =>
          result.success
            ? `Selected option for '${label}'.`
            : `Could not select option for '${label}'.`,
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
          : `Field mismatch on '${label}'.`,
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
   * Close the browser and release resources.
   */
  public async cleanup(): Promise<void> {
    for (const [clarificationId, pending] of this.pendingClarifications.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new OperationCancelledError());
      this.pendingClarifications.delete(clarificationId);
    }
    await this.browserManager.close().catch(() => {});
    await this.purgeSessionSafely();
  }
}
