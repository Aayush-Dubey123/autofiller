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
  BackendHealth,
  ClarificationPromptPayload,
  DocumentExtractResult,
  DocumentRecord,
  DocumentSelection,
  EngineStatus,
  SessionRecord,
  StartSessionOptions,
  WorkflowState,
} from './shared/types';

/** Typed surface available to the renderer as `window.autofiller`. */
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

const api: AutoFillerAPI = {
  isElectron: true,
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
  listSessions: () => ipcRenderer.invoke('autofiller:history-list'),
  listDocuments: () => ipcRenderer.invoke('autofiller:documents-list'),
  backendHealth: () => ipcRenderer.invoke('autofiller:backend-health'),
  getEngineStatus: () => ipcRenderer.invoke('autofiller:get-engine-status'),
  appVersion: () => ipcRenderer.invoke('autofiller:app-version'),

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

  onEngineError: (callback) => {
    const subscription = (_event: unknown, payload: EngineStatus) => callback(payload);
    ipcRenderer.on('autofiller:engine-error', subscription);
    return () => ipcRenderer.removeListener('autofiller:engine-error', subscription);
  },
};

contextBridge.exposeInMainWorld('autofiller', api);
contextBridge.exposeInMainWorld('formpilot', api);
