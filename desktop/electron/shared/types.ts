/**
 * Shared wire-contract types for AutoFiller.
 *
 * Single source of truth for the shapes exchanged between the renderer, the Electron
 * main process, and the Python backend. Previously each layer re-declared these with
 * `any`, so the "strictly typed bridge" was not actually typed.
 */

/** Supported form control types. Mirrors the backend `FormFieldType` enum. */
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

/** Structured representation of one scanned web form field. */
export interface FormFieldSnapshot {
  ref: string;
  role?: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  currentValue?: string;
  options?: string[];
  disabled: boolean;
  visible: boolean;
}

/** Structured browser observation of the active target form. */
export interface FormSnapshot {
  url: string;
  title: string;
  fields: FormFieldSnapshot[];
}

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

/** Human-in-the-loop clarification prompt. */
export interface ClarificationRequest {
  clarification_id: string;
  field_ref: string;
  field_label: string;
  question: string;
  options: string[];
  selected_value?: string | null;
}

/** Verification outcome for a populated field. */
export interface VerificationRecord {
  field_ref: string;
  field_label: string;
  expected_value: string;
  actual_value: string;
  verified: boolean;
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

/** Workflow lifecycle states. Mirrors the backend `SessionStatus` enum. */
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

/** Form mapping response. */
export interface FormMapResult {
  session_id: string;
  mappings: FieldMapping[];
  clarifications_required: ClarificationRequest[];
  unmapped_fields: string[];
}
