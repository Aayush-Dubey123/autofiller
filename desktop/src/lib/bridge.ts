/**
 * Typed client layer between the React renderer and the Electron preload bridge.
 *
 * Per the Eigi frontend standards and IMPORTANT.md, all backend access from the UI
 * goes through this single client. Components never call the backend URL directly and
 * never receive the operator token.
 */

import type {
  AgentEventPayload,
  BackendHealth,
  ClarificationPromptPayload,
  DocumentExtractResult,
  DocumentRecord,
  DocumentSelection,
  EngineStatus,
  ExtractedFact,
  SessionRecord,
  StartSessionOptions,
  WorkflowState,
} from '../types/autofiller';

/** Typed surface exposed by the Electron preload script. */
export interface AutoFillerAPI {
  isElectron: boolean;
  selectDocument: () => Promise<DocumentSelection>;
  startSession: (options: StartSessionOptions) => Promise<{ success: boolean; error?: string }>;
  pauseAgent: () => Promise<void>;
  resumeAgent: () => Promise<void>;
  takeOver: () => Promise<void>;
  stopAgent: () => Promise<void>;
  submitForm: () => Promise<{ success: boolean; error?: string; message?: string }>;
  answerClarification: (clarificationId: string, answer: string) => Promise<{ success: boolean }>;
  extractDocument: (payload: {
    filePath?: string;
    rawText?: string;
    documentName?: string;
  }) => Promise<DocumentExtractResult | { error: string }>;
  listSessions: () => Promise<SessionRecord[]>;
  listDocuments: () => Promise<DocumentRecord[]>;
  backendHealth: () => Promise<BackendHealth>;
  getEngineStatus: () => Promise<EngineStatus>;
  appVersion: () => Promise<string>;
  onAgentEvent: (callback: (event: AgentEventPayload) => void) => () => void;
  onClarificationRequest: (callback: (prompt: ClarificationPromptPayload) => void) => () => void;
  onStateChange: (
    callback: (update: { state: WorkflowState; previousState: WorkflowState }) => void
  ) => () => void;
  onEngineError: (callback: (status: EngineStatus) => void) => () => void;
}

export type FormPilotAPI = AutoFillerAPI;

declare global {
  interface Window {
    autofiller?: AutoFillerAPI;
    formpilot?: AutoFillerAPI;
  }
}

/** True when the app is running inside Electron with the preload bridge available. */
export const hasElectronBridge =
  typeof window !== 'undefined' && Boolean(window.autofiller || window.formpilot);

/**
 * Fallback implementation used when the UI is opened in a plain browser for design work.
 *
 * Every method returns an explicit, harmless result so no component can accidentally
 * depend on mock behaviour leaking into the packaged app.
 */
const browserFallback: AutoFillerAPI = {
  isElectron: false,
  selectDocument: async (): Promise<DocumentSelection> => ({
    canceled: false,
    error: 'Desktop bridge unavailable. Run in desktop app to start session.',
  }),
  startSession: async (): Promise<{ success: boolean; error?: string }> => ({
    success: false,
    error: 'Desktop bridge unavailable. Run in desktop app to start session.',
  }),
  pauseAgent: async () => undefined,
  resumeAgent: async () => undefined,
  takeOver: async () => undefined,
  stopAgent: async () => undefined,
  submitForm: async () => ({ success: false, error: 'Desktop bridge unavailable' }),
  answerClarification: async () => ({ success: false }),
  extractDocument: async () => ({ error: 'Desktop bridge unavailable' }),
  listSessions: async () => [],
  listDocuments: async () => [],
  backendHealth: async () => ({ healthy: false, geminiConfigured: false }),
  getEngineStatus: async (): Promise<EngineStatus> => {
    const isElectronUA = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');
    if (isElectronUA) {
      return {
        ready: false,
        errorDetail: 'Fatal preload bridge error: window.autofiller is undefined inside Electron shell.',
      };
    }
    return { ready: true };
  },
  appVersion: async () => '1.0.0 (Browser Preview)',
  onAgentEvent: () => () => undefined,
  onClarificationRequest: () => () => undefined,
  onStateChange: () => () => undefined,
  onEngineError: () => () => undefined,
};

/** Active bridge implementation for the current runtime. */
export const bridge: AutoFillerAPI =
  (typeof window !== 'undefined' ? (window.autofiller ?? window.formpilot) : undefined) ??
  browserFallback;

/**
 * Extract document facts through the desktop bridge.
 *
 * @param payload File path or raw text plus document name.
 * @returns Extracted facts, or an empty list with the reported error.
 */
export async function extractDocumentFacts(payload: {
  filePath?: string;
  rawText?: string;
  documentName?: string;
}): Promise<{ facts: ExtractedFact[]; error?: string }> {
  const result = await bridge.extractDocument(payload);
  if ('error' in result) {
    return { facts: [], error: result.error };
  }
  return { facts: result.facts ?? [] };
}
