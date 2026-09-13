/**
 * Electron preload script exposing the restricted, strictly typed FormPilot bridge.
 *
 * In accordance with IMPORTANT.md:
 * - Does NOT expose ipcRenderer, fs, child_process, Playwright, the backend URL, the
 *   operator token, or any Node internals.
 * - Only exposes typed window.formpilot methods and event subscriptions.
 */

import { contextBridge, ipcRenderer } from 'electron';

import type {
  AgentEventPayload,
  ClarificationPromptPayload,
  DocumentExtractResult,
  DocumentSelection,
  FormPilotSettings,
  GeminiTestResult,
  StartSessionOptions,
  WorkflowState,
} from './shared/types';

/** Typed surface available to the renderer as `window.formpilot`. */
export interface FormPilotAPI {
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
  getSettings: () => Promise<FormPilotSettings>;
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

const api: FormPilotAPI = {
  selectDocument: () => ipcRenderer.invoke('formpilot:select-document'),
  startSession: (options) => ipcRenderer.invoke('formpilot:start-session', options),
  pauseAgent: () => ipcRenderer.invoke('formpilot:pause-agent'),
  resumeAgent: () => ipcRenderer.invoke('formpilot:resume-agent'),
  takeOver: () => ipcRenderer.invoke('formpilot:takeover-agent'),
  stopAgent: () => ipcRenderer.invoke('formpilot:stop-agent'),
  submitForm: () => ipcRenderer.invoke('formpilot:submit-form'),
  answerClarification: (clarificationId, answer) =>
    ipcRenderer.invoke('formpilot:answer-clarification', { clarificationId, answer }),
  extractDocument: (payload) => ipcRenderer.invoke('formpilot:extract-document', payload),
  getSettings: () => ipcRenderer.invoke('formpilot:get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('formpilot:save-settings', settings),
  testGemini: (apiKey, model) => ipcRenderer.invoke('formpilot:test-gemini', { apiKey, model }),
  backendHealth: () => ipcRenderer.invoke('formpilot:backend-health'),

  onAgentEvent: (callback) => {
    const subscription = (_event: unknown, payload: AgentEventPayload) => callback(payload);
    ipcRenderer.on('formpilot:event', subscription);
    return () => ipcRenderer.removeListener('formpilot:event', subscription);
  },

  onClarificationRequest: (callback) => {
    const subscription = (_event: unknown, payload: ClarificationPromptPayload) => callback(payload);
    ipcRenderer.on('formpilot:clarification-request', subscription);
    return () => ipcRenderer.removeListener('formpilot:clarification-request', subscription);
  },

  onStateChange: (callback) => {
    const subscription = (
      _event: unknown,
      payload: { state: WorkflowState; previousState: WorkflowState }
    ) => callback(payload);
    ipcRenderer.on('formpilot:state-change', subscription);
    return () => ipcRenderer.removeListener('formpilot:state-change', subscription);
  },
};

contextBridge.exposeInMainWorld('autofiller', api);
contextBridge.exposeInMainWorld('formpilot', api);
