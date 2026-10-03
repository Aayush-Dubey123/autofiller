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
  /** Operator-reviewed facts. When present the agent uses them directly. */
  facts?: ExtractedFact[];
  targetUrl: string;
  /** Explicit runtime permission to fill ID-number fields. */
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
