/**
 * Typed client layer between the React renderer and the Electron preload bridge.
 *
 * Per the Eigi frontend standards and IMPORTANT.md, all backend access from the UI
 * goes through this single client. Components never call the backend URL directly and
 * never receive the operator token.
 */

import type {
  AgentEventPayload,
  AutoFillerSettings,
  ClarificationPromptPayload,
  DocumentExtractResult,
  DocumentSelection,
  ExtractedFact,
  FormPilotSettings,
  GeminiTestResult,
  StartSessionOptions,
  WorkflowState,
} from '../types/formpilot';

/** Typed surface exposed by the Electron preload script. */
export interface AutoFillerAPI {
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
  getSettings: () => Promise<AutoFillerSettings>;
  saveSettings: (settings: {
    geminiApiKey?: string;
    geminiModel?: string;
    headless?: boolean;
    typingDelayMs?: number;
  }) => Promise<{ success: boolean; apiKeyConfigured?: boolean; maskedKey?: string; error?: string }>;
  testGemini: (apiKey: string, model?: string) => Promise<GeminiTestResult>;
  backendHealth: () => Promise<{ healthy: boolean }>;
  onAgentEvent: (callback: (event: AgentEventPayload) => void) => () => void;
  onClarificationRequest: (callback: (prompt: ClarificationPromptPayload) => void) => () => void;
  onStateChange: (
    callback: (update: { state: WorkflowState; previousState: WorkflowState }) => void
  ) => () => void;
}

export type FormPilotAPI = AutoFillerAPI;

declare global {
  interface Window {
    autofiller?: AutoFillerAPI;
    formpilot?: AutoFillerAPI;
  }
}

/** True when the app is running inside Electron with the preload bridge available. */
export const hasElectronBridge = typeof window !== 'undefined' && Boolean(window.autofiller || window.formpilot);

/**
 * Fallback implementation used when the UI is opened in a plain browser for design work.
 *
 * Every method returns an explicit, harmless result so no component can accidentally
 * depend on mock behaviour leaking into the packaged app.
 */
const browserFallback: AutoFillerAPI = {
  selectDocument: async (): Promise<DocumentSelection> => ({ canceled: true }),
  startSession: async (): Promise<{ success: boolean; error?: string }> => ({
    success: false,
    error: 'Desktop bridge unavailable. Run the app through Electron.',
  }),
  pauseAgent: async () => undefined,
  resumeAgent: async () => undefined,
  takeOver: async () => undefined,
  stopAgent: async () => undefined,
  submitForm: async () => ({ success: false, error: 'Desktop bridge unavailable.' }),
  answerClarification: async () => ({ success: false }),
  extractDocument: async () => ({ error: 'Desktop bridge unavailable.' }),
  getSettings: async (): Promise<AutoFillerSettings> => ({
    headless: false,
    typingDelayMs: 25,
    geminiModel: 'gemini-3.6-flash',
    apiKeyConfigured: false,
    maskedKey: '',
  }),
  saveSettings: async () => ({ success: false, error: 'Desktop bridge unavailable.' }),
  testGemini: async (): Promise<GeminiTestResult> => ({
    valid: false,
    message: 'Desktop bridge unavailable.',
  }),
  backendHealth: async () => ({ healthy: false }),
  onAgentEvent: () => () => undefined,
  onClarificationRequest: () => () => undefined,
  onStateChange: () => () => undefined,
};

/** Active bridge implementation for the current runtime. */
export const bridge: AutoFillerAPI = (typeof window !== 'undefined' ? (window.autofiller ?? window.formpilot) : undefined) ?? browserFallback;

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
