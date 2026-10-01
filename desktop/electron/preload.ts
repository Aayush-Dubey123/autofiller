/**
 * Electron preload script exposing the restricted, strictly typed AutoFiller bridge.
 *
 * In accordance with IMPORTANT.md:
 * - Does NOT expose ipcRenderer, fs, child_process, Playwright, the backend URL, the
 *   operator token, or any Node internals.
 * - Only exposes typed window.autofiller methods and event subscriptions.
 */

import { contextBridge, ipcRenderer } from 'electron';

import type {
  AgentEventPayload,
  AutoFillerSettings,
  ClarificationPromptPayload,
  DocumentExtractResult,
  DocumentSelection,
  FormPilotSettings,
  GeminiTestResult,
  StartSessionOptions,
  WorkflowState,
} from './shared/types';

/** Typed surface available to the renderer as `window.autofiller`. */
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

const api: AutoFillerAPI = {
  selectDocument: () => ipcRenderer.invoke('autofiller:select-document'),
  startSession: (options) => ipcRenderer.invoke('autofiller:start-session', options),
  pauseAgent: () => ipcRenderer.invoke('autofiller:pause-agent'),
  resumeAgent: () => ipcRenderer.invoke('autofiller:resume-agent'),
  takeOver: () => ipcRenderer.invoke('autofiller:takeover-agent'),
  stopAgent: () => ipcRenderer.invoke('autofiller:stop-agent'),
  submitForm: () => ipcRenderer.invoke('autofiller:submit-form'),
  answerClarification: (clarificationId, answer) =>
    ipcRenderer.invoke('autofiller:answer-clarification', { clarificationId, answer }),
  extractDocument: (payload) => ipcRenderer.invoke('autofiller:extract-document', payload),
  getSettings: () => ipcRenderer.invoke('autofiller:get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('autofiller:save-settings', settings),
  testGemini: (apiKey, model) => ipcRenderer.invoke('autofiller:test-gemini', { apiKey, model }),
  backendHealth: () => ipcRenderer.invoke('autofiller:backend-health'),

  onAgentEvent: (callback) => {
    const subscription = (_event: unknown, payload: AgentEventPayload) => callback(payload);
    ipcRenderer.on('autofiller:event', subscription);
    return () => ipcRenderer.removeListener('autofiller:event', subscription);
  },

  onClarificationRequest: (callback) => {
    const subscription = (_event: unknown, payload: ClarificationPromptPayload) => callback(payload);
    ipcRenderer.on('autofiller:clarification-request', subscription);
    return () => ipcRenderer.removeListener('autofiller:clarification-request', subscription);
  },

  onStateChange: (callback) => {
    const subscription = (
      _event: unknown,
      payload: { state: WorkflowState; previousState: WorkflowState }
    ) => callback(payload);
    ipcRenderer.on('autofiller:state-change', subscription);
    return () => ipcRenderer.removeListener('autofiller:state-change', subscription);
  },
};

contextBridge.exposeInMainWorld('autofiller', api);
contextBridge.exposeInMainWorld('formpilot', api);
