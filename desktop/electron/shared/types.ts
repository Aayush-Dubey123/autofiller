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
  total?: number;
  currentIndex?: number;
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

/** Backend readiness as reported by the unauthenticated /health endpoint. */
export interface BackendHealth {
  healthy: boolean;
  /** Whether GEMINI_API_KEY is configured in backend/.env. Boolean only, never the key. */
  geminiConfigured: boolean;
}

/** Vault operational status surfaced to the UI. */
export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
  hasOsSlot: boolean;
  hasPassphraseSlot: boolean;
  hasRecoverySlot: boolean;
  recoveryAvailable: boolean;
}

/** Individual stored field within a vault section. */
export interface VaultField {
  key: string;
  label: string;
  value: string;
  sensitive?: boolean;
}

/** Section grouping related vault fields (Personal, Contact, Address, etc.). */
export interface VaultSection {
  id: string;
  title: string;
  fields: VaultField[];
}

/** Complete user profile record inside the encrypted vault. */
export interface ProfileRecord {
  id: string;
  name: string;
  sections: VaultSection[];
}

/** Engine operational status surfaced to the renderer. */
export interface EngineStatus {
  ready: boolean;
  errorDetail?: string;
}

/** Options accepted when starting an automation session. */
export interface StartSessionOptions {
  documentPath?: string;
  documentText?: string;
  documentName?: string;
  /** Operator-reviewed facts. When present the agent skips re-extraction. */
  facts?: ExtractedFact[];
  targetUrl: string;
  /** Explicit runtime permission to fill ID-number fields (SSN, Aadhaar, Passport, etc.). */
  fillIdFields?: boolean;
}

/** Result of a native document selection dialog. */
export interface DocumentSelection {
  canceled: boolean;
  filePath?: string;
  fileName?: string;
  /** Real file size in bytes. */
  fileSize?: number;
  error?: string;
}

/** A past automation session metadata persisted in the userData JSON store (no values). */
export interface SessionRecord {
  id: string;
  date: string;
  hostAndPath: string;
  status: WorkflowState | 'INTERRUPTED';
  fieldsFilled: number;
  totalFields?: number;
  profileName?: string;
  dataSource?: string;
  error?: string;
}

/** A processed document and its extracted facts, persisted in the userData JSON store. */
export interface DocumentRecord {
  id: string;
  name: string;
  size: number;
  path: string;
  extractedAt: string;
  facts: ExtractedFact[];
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
