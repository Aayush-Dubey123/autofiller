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
  | 'combobox'
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
  autocomplete?: string;
  required: boolean;
  currentValue?: string;
  options?: string[];
  disabled: boolean;
  visible: boolean;
  isHoneypot?: boolean;
  labelSource?: string;
  enabledState?: 'enabled' | 'readonly' | 'disabled';
  location?: string;
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

/** Profile fact descriptor containing only metadata for zero-value mapping (never contains values). */
export interface FactDescriptor {
  key: string;
  label: string;
  type?: string;
  confidence: number;
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

/** Verification outcome for a populated field (safe metadata only, no values). */
export interface VerificationRecord {
  field_ref: string;
  field_label: string;
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
  hasOsSlot?: boolean;
  hasPassphraseSlot?: boolean;
  hasRecoverySlot?: boolean;
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
  /** Saved profile facts from the vault. */
  profileFacts?: ExtractedFact[];
  targetUrl: string;
  /** Explicit runtime permission to fill ID-number fields (SSN, Aadhaar, Passport, etc.). */
  fillIdFields?: boolean;
  /** Optional preflight required fact keys to verify before opening the target form. */
  requiredFactKeys?: string[];
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

/** User-visible progress states during document processing. */
export type DocumentExtractionStage =
  | 'idle'
  | 'uploading'
  | 'reading_document'
  | 'extracting_information'
  | 'organizing_facts'
  | 'completed'
  | 'error';

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
  provider?: string;
}

/** Zero-value trace record for a single form field in a scan. */
export interface FieldTraceRecord {
  ref: string;
  scannedLabel: string;
  labelSource: string;
  controlType: string;
  required: boolean;
  visible: boolean;
  enabledState: 'enabled' | 'readonly' | 'disabled';
  location: string;
  mapping: {
    factKey: string | 'none';
    confidence: number;
    source: 'heuristic' | string | 'clarification' | 'none';
  };
  valueAvailable: boolean;
  fillStrategies: Array<{
    strategy: string;
    outcome: 'ok' | string;
  }>;
  domReadBack: 'match' | 'normalized-match' | 'mismatch' | 'empty' | 'unreadable' | 'none';
  skippedReason: 'hidden' | 'disabled' | 'readonly' | 'blocker' | 'no fact' | 'user skipped' | null;
}

/** Zero-value trace record for a single form observation/scan. */
export interface ScanTraceRecord {
  scanIndex: number;
  hostAndPath: string;
  frameCount: number;
  fieldCount: number;
  timeSinceNavMs: number;
  fields: FieldTraceRecord[];
}

export interface FrameCensusCounts {
  visible: Record<string, number>;
  hidden: Record<string, number>;
}

export interface FrameCensus {
  frameId: string;
  url: string;
  name?: string;
  isMainFrame: boolean;
  inputsByType: FrameCensusCounts;
  textarea: { visible: number; hidden: number };
  select: { visible: number; hidden: number };
  roleRadio: { visible: number; hidden: number };
  roleCheckbox: { visible: number; hidden: number };
  roleListbox: { visible: number; hidden: number };
  roleCombobox: { visible: number; hidden: number };
  contenteditable: { visible: number; hidden: number };
  hasShadowRoots: boolean;
}

export interface PageCensusRecord {
  finalUrlHost: string;
  finalUrlPath: string;
  pageTitle: string;
  matchedBlockerRule: string | null;
  triggerElementOrHost: string | null;
  screenshotPath?: string | null;
  frames: FrameCensus[];
}

/** Complete zero-value trace for an execution run. */
export interface RunTrace {
  timestamp: string;
  targetUrl: string;
  aiProvider: string;
  blockedNavigationReason: string | null;
  scans: ScanTraceRecord[];
  pageCensus?: PageCensusRecord | null;
  failureEvidence?: any[];
}

