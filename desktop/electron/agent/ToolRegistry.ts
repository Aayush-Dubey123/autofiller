/**
 * ToolRegistry implementing the restricted FormPilot domain tools.
 *
 * In accordance with IMPORTANT.md:
 * - The toolset remains intentionally small, typed, and auditable.
 * - Tools do NOT expose shell, arbitrary JavaScript, or general terminal access.
 * - Every dispatch passes through PolicyEngine.validateToolInvocation and each tool's
 *   own input validator BEFORE executing, so the model is never the security boundary.
 */

import { BrowserManager } from '../browser/BrowserManager';
import { PolicyEngine } from '../policy/PolicyEngine';
import { BackendClient } from '../services/BackendClient';
import {
  AgentEventPayload,
  ClarificationPromptPayload,
  ExtractedFact,
  FormSnapshot,
} from '../shared/types';

/** JSON-schema-like field descriptor used to validate tool arguments. */
export interface ToolArgumentSpec {
  type: 'string' | 'boolean' | 'number';
  required: boolean;
}

/** Context handed to every tool invocation. */
export interface ToolContext {
  browserManager: BrowserManager;
  policyEngine: PolicyEngine;
  backendClient: BackendClient;
  sessionId: string;
  signal?: AbortSignal;
  emitEvent: (event: AgentEventPayload) => void;
  requestClarification: (prompt: ClarificationPromptPayload) => Promise<string>;
}

/** A single restricted, validated agent capability. */
export interface AgentTool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  argumentSpec: Record<string, ToolArgumentSpec>;
  validate(input: unknown): TInput;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}

/** Raised when a tool invocation is refused by policy or input validation. */
export class ToolExecutionError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'TOOL_EXECUTION_FAILED') {
    super(message);
    this.name = 'ToolExecutionError';
    this.code = code;
  }
}

export class ToolRegistry {
  private tools: Map<string, AgentTool> = new Map();

  constructor() {
    this.registerTools();
  }

  /**
   * Register every permitted FormPilot domain tool.
   */
  private registerTools(): void {
    this.register({
      name: 'inspect_document',
      description: 'Check document readability and extract its structured facts.',
      argumentSpec: {
        filePath: { type: 'string', required: false },
        rawText: { type: 'string', required: false },
        documentName: { type: 'string', required: false },
      },
      validate: (input: any) => {
        if (!input?.filePath && !input?.rawText) {
          throw new ToolExecutionError('Missing filePath or rawText', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        return await context.backendClient.extractDocument({
          filePath: input.filePath,
          rawText: input.rawText,
          documentName: input.documentName,
        });
      },
    });

    this.register({
      name: 'extract_document_facts',
      description: 'Extract structured facts (student name, DOB, contacts) from a document.',
      argumentSpec: {
        filePath: { type: 'string', required: false },
        rawText: { type: 'string', required: false },
        documentName: { type: 'string', required: false },
      },
      validate: (input: any) => {
        if (!input?.filePath && !input?.rawText) {
          throw new ToolExecutionError('Missing filePath or rawText', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext): Promise<ExtractedFact[]> => {
        const result = await context.backendClient.extractDocument({
          filePath: input.filePath,
          rawText: input.rawText,
          documentName: input.documentName,
        });
        return result.facts || [];
      },
    });

    this.register({
      name: 'inspect_form',
      description: 'Scan the active web form DOM into a structured FormSnapshot with field_refs.',
      argumentSpec: {},
      validate: () => ({}),
      execute: async (_input: unknown, context: ToolContext): Promise<FormSnapshot> => {
        return await context.browserManager.scanActiveForm();
      },
    });

    this.register({
      name: 'inspect_current_form_state',
      description: 'Read the current populated values of all form fields.',
      argumentSpec: {},
      validate: () => ({}),
      execute: async (_input: unknown, context: ToolContext): Promise<FormSnapshot> => {
        return await context.browserManager.scanActiveForm();
      },
    });

    this.register({
      name: 'request_clarification',
      description: 'Pause execution and request human clarification for an ambiguous field.',
      argumentSpec: {
        fieldRef: { type: 'string', required: true },
        question: { type: 'string', required: true },
      },
      validate: (input: any) => {
        if (!input?.fieldRef || !input?.question) {
          throw new ToolExecutionError('Missing fieldRef or question', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        const answer = await context.requestClarification({
          clarificationId: input.clarificationId || `clarify_${Date.now()}`,
          fieldRef: input.fieldRef,
          fieldLabel: input.fieldLabel || input.fieldRef,
          question: input.question,
          options: input.options || [],
        });
        return { fieldRef: input.fieldRef, selectedValue: answer };
      },
    });

    this.register({
      name: 'fill_text',
      description: 'Populate a text, email, number, date, or textarea field by field_ref.',
      argumentSpec: {
        fieldRef: { type: 'string', required: true },
        value: { type: 'string', required: true },
      },
      validate: (input: any) => {
        if (!input?.fieldRef || input.value === undefined) {
          throw new ToolExecutionError('Missing fieldRef or value', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        return await context.browserManager.fillText(
          input.fieldRef,
          String(input.value),
          context.signal
        );
      },
    });

    this.register({
      name: 'select_option',
      description: 'Choose a dropdown option for a select element by field_ref.',
      argumentSpec: {
        fieldRef: { type: 'string', required: true },
        option: { type: 'string', required: true },
      },
      validate: (input: any) => {
        if (!input?.fieldRef || !input?.option) {
          throw new ToolExecutionError('Missing fieldRef or option', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        return await context.browserManager.selectOption(
          input.fieldRef,
          input.option,
          context.signal
        );
      },
    });

    this.register({
      name: 'select_radio',
      description: 'Select a radio option scoped to the correct radio group by field_ref.',
      argumentSpec: {
        fieldRef: { type: 'string', required: true },
        optionValue: { type: 'string', required: true },
      },
      validate: (input: any) => {
        if (!input?.fieldRef || !input?.optionValue) {
          throw new ToolExecutionError('Missing fieldRef or optionValue', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        return await context.browserManager.selectRadio(
          input.fieldRef,
          input.optionValue,
          context.signal
        );
      },
    });

    this.register({
      name: 'set_checkbox',
      description: 'Set the checked state of a checkbox by field_ref.',
      argumentSpec: {
        fieldRef: { type: 'string', required: true },
        checked: { type: 'boolean', required: true },
      },
      validate: (input: any) => {
        if (!input?.fieldRef || input.checked === undefined) {
          throw new ToolExecutionError('Missing fieldRef or checked', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        return await context.browserManager.setCheckbox(
          input.fieldRef,
          Boolean(input.checked),
          context.signal
        );
      },
    });

    this.register({
      name: 'verify_field',
      description: 'Read back a field value and verify it matches the expected fact.',
      argumentSpec: {
        fieldRef: { type: 'string', required: true },
        expectedValue: { type: 'string', required: true },
      },
      validate: (input: any) => {
        if (!input?.fieldRef || input.expectedValue === undefined) {
          throw new ToolExecutionError('Missing fieldRef or expectedValue', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        return await context.browserManager.verifyField(
          input.fieldRef,
          String(input.expectedValue)
        );
      },
    });

    this.register({
      name: 'scroll_to_field',
      description: 'Scroll a specific field into the viewport.',
      argumentSpec: { fieldRef: { type: 'string', required: true } },
      validate: (input: any) => {
        if (!input?.fieldRef) {
          throw new ToolExecutionError('Missing fieldRef', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        await context.browserManager.scrollToField(input.fieldRef, context.signal);
        return { success: true, fieldRef: input.fieldRef };
      },
    });
  }

  /**
   * Register a tool, replacing any existing registration with the same name.
   *
   * @param tool Tool implementation to register.
   */
  public register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Retrieve a registered tool by name.
   *
   * @param name Tool name.
   * @returns The tool, or undefined when not registered.
   */
  public getTool(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /**
   * List the names of every registered tool.
   *
   * @returns Registered tool names.
   */
  public listToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Dispatch a tool invocation through policy enforcement and input validation.
   *
   * This is the ONLY supported way to execute a tool. It refuses unregistered tools,
   * refuses policy-denied invocations, and validates arguments before side effects.
   *
   * @param name Tool name to dispatch.
   * @param args Untrusted arguments from the agent.
   * @param context Execution context for the tool.
   * @returns The tool result.
   * @throws ToolExecutionError when the tool is unknown, denied, invalid, or fails.
   */
  public async dispatch<T = unknown>(
    name: string,
    args: Record<string, any>,
    context: ToolContext
  ): Promise<T> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolExecutionError(
        `Tool '${name}' is not registered in the FormPilot tool registry.`,
        'TOOL_NOT_REGISTERED'
      );
    }

    const decision = context.policyEngine.validateToolInvocation(name, args);
    if (!decision.allowed) {
      throw new ToolExecutionError(
        decision.reason || `Tool '${name}' was denied by execution policy.`,
        decision.code || 'TOOL_NOT_PERMITTED'
      );
    }

    const validated = tool.validate(args);
    return (await tool.execute(validated, context)) as T;
  }
}
