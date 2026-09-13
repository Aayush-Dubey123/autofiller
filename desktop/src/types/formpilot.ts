/**
 * Shared renderer-side contract types for AutoFiller.
 *
 * Mirrors the Electron main-process shared types so the preload bridge is genuinely
 * typed instead of exchanging `any`.
 */

/** Supported form control types. */
export type FormFieldType =
  | 'text'
  | 'number'
  | 'email'
  | 'tel'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'textarea'
  | 'password'
  | 'other';

/** A discrete fact extracted from a user document. */
export interface ExtractedFact {
  key: string;
  label: string;
  value: string;
  confidence: number;
  source_page?: number | null;
}

/** Semantic mapping between a form field and an extracted fact. */
export interface FieldMapping {
  field_ref: string;
  field_label: string;
  fact_key?: string | null;
  fact_value?: string | null;
  confidence: number;
  status: string;
  clarification_id?: string | null;
}

/** Agent execution event types emitted to the UI. */
export type AgentEventType =
  | 'TOOL_STARTED'
  | 'TOOL_COMPLETED'
  | 'TOOL_FAILED'
  | 'STATE_CHANGED'
  | 'POLICY_BLOCKED';

/** Structured observable execution event. */
export interface AgentEventPayload {
  eventId: string;
  timestamp: string;
  type: AgentEventType;
  tool?: string;
  description: string;
  success?: boolean;
  metadata?: Record<string, unknown>;
}

/** Clarification prompt delivered to the renderer. */
export interface ClarificationPromptPayload {
  clarificationId: string;
  fieldRef: string;
  fieldLabel: string;
  question: string;
  options: string[];
}

/** Workflow lifecycle states. */
export type WorkflowState =
  | 'IDLE'
  | 'EXTRACTING_DOC'
  | 'SCANNING_FORM'
  | 'MAPPING_FIELDS'
  | 'CLARIFICATION_REQUIRED'
  | 'FILLING_FORM'
  | 'VERIFYING'
  | 'REVIEW_READY'
  | 'PAUSED'
  | 'USER_TAKEOVER'
  | 'COMPLETED'
  | 'ERROR';

/** Runtime configuration surfaced to the settings UI. */
export interface AutoFillerSettings {
  headless: boolean;
  typingDelayMs: number;
  geminiModel: string;
  apiKeyConfigured: boolean;
  maskedKey: string;
}
export type FormPilotSettings = AutoFillerSettings;

/** Options accepted when starting an automation session. */
export interface StartSessionOptions {
  documentPath?: string;
  documentText?: string;
  documentName?: string;
  targetUrl: string;
}

/** Result of a native document selection dialog. */
export interface DocumentSelection {
  canceled: boolean;
  filePath?: string;
  fileName?: string;
}

/** Result of a Gemini credential test. */
export interface GeminiTestResult {
  valid: boolean;
  message: string;
  latency_ms?: number;
  model?: string;
  sample_response?: string;
}

/** Extracted document facts response. */
export interface DocumentExtractResult {
  document_name: string;
  facts: ExtractedFact[];
  fact_count: number;
}
