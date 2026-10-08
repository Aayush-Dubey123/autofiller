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
  ProfileRecord,
  SessionRecord,
  StartSessionOptions,
  VaultStatus,
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
  confirmSubmission: () => Promise<{ success: boolean }>;
  answerClarification: (clarificationId: string, answer: string) => Promise<{ success: boolean }>;
  extractDocument: (payload: {
    filePath?: string;
    rawText?: string;
    documentName?: string;
  }) => Promise<DocumentExtractResult | { error: string }>;
  listSessions: () => Promise<SessionRecord[]>;
  listDocuments: () => Promise<DocumentRecord[]>;
  deleteHistorySession: (id: string) => Promise<{ success: boolean }>;
  deleteHistorySessions: (ids: string[]) => Promise<{ success: boolean }>;
  clearAllHistory: () => Promise<{ success: boolean }>;
  eraseAllData: () => Promise<{ success: boolean; error?: string }>;
  backendHealth: () => Promise<BackendHealth>;
  getEngineStatus: () => Promise<EngineStatus>;
  appVersion: () => Promise<string>;
  vaultStatus: () => Promise<VaultStatus>;
  vaultCreate: (payload: {
    privacyKey: string;
    useRecoveryCode?: boolean;
  }) => Promise<{ success: boolean; recoveryCode?: string; error?: string }>;
  vaultEnableExtra: (payload: {
    privacyKey: string;
    wantRecovery?: boolean;
  }) => Promise<{ success: boolean; recoveryCode?: string; error?: string }>;
  vaultDisableExtra: (payload: {
    privacyKey: string;
  }) => Promise<{ success: boolean; error?: string }>;
  vaultUnlock: (payload: {
    privacyKey?: string;
    recoveryCode?: string;
  }) => Promise<{ success: boolean; unlockedViaRecovery?: boolean; error?: string }>;
  vaultLock: () => Promise<{ success: boolean }>;
  vaultGetProfiles: () => Promise<ProfileRecord[]>;
  vaultSaveProfile: (profile: ProfileRecord) => Promise<{ success: boolean; error?: string }>;
  vaultDeleteProfile: (profileId: string) => Promise<{ success: boolean; error?: string }>;
  vaultDeleteField: (payload: {
    profileId: string;
    sectionId: string;
    fieldKey: string;
  }) => Promise<{ success: boolean; error?: string }>;
  vaultChangeKey: (payload: {
    currentPrivacyKey: string;
    newPrivacyKey: string;
  }) => Promise<{ success: boolean; error?: string }>;
  vaultEraseAll: () => Promise<{ success: boolean }>;
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
  confirmSubmission: async () => ({ success: true }),
  answerClarification: async () => ({ success: false }),
  extractDocument: async () => ({ error: 'Desktop bridge unavailable' }),
  listSessions: async () => [],
  listDocuments: async () => [],
  deleteHistorySession: async () => ({ success: true }),
  deleteHistorySessions: async () => ({ success: true }),
  clearAllHistory: async () => ({ success: true }),
  eraseAllData: async () => ({ success: true }),
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
  vaultStatus: async () => ({ exists: false, unlocked: true, recoveryAvailable: false }),
  vaultCreate: async () => ({ success: true }),
  vaultEnableExtra: async () => ({ success: true }),
  vaultDisableExtra: async () => ({ success: true }),
  vaultUnlock: async () => ({ success: true }),
  vaultLock: async () => ({ success: true }),
  vaultGetProfiles: async () => [
    {
      id: 'profile_preview',
      name: 'Primary Profile (Preview)',
      sections: [
        { id: 'sec_personal', title: 'Personal Information', fields: [{ key: 'student_name', label: 'Student Name', value: 'Aarav Sharma' }] },
        { id: 'sec_contact', title: 'Contact Details', fields: [{ key: 'email', label: 'Email Address', value: 'aarav.sharma@example.com' }] },
      ],
    },
  ],
  vaultSaveProfile: async () => ({ success: true }),
  vaultDeleteProfile: async () => ({ success: true }),
  vaultDeleteField: async () => ({ success: true }),
  vaultChangeKey: async () => ({ success: true }),
  vaultEraseAll: async () => ({ success: true }),
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
