/**
 * IPC handlers registering desktop window operations and bridging to the AgentController.
 *
 * All renderer access to privileged functionality flows through these narrow, typed
 * channels. The renderer never receives the backend URL, the operator token, or any
 * Node capability.
 */

import { BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'path';

import { AgentController } from '../agent/AgentController';
import { BackendClient } from '../services/BackendClient';
import { SecretStore } from '../services/SecretStore';
import { DocumentSelection, StartSessionOptions } from '../shared/types';

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  agentController: AgentController,
  secretStore: SecretStore
): void {
  const backendClient: BackendClient = agentController.getBackendClient();

  /**
   * Send an event to the renderer when it is still alive.
   *
   * @param channel IPC channel name.
   * @param payload Serializable payload.
   */
  const sendToRenderer = (channel: string, payload: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  // Native document selection dialog.
  ipcMain.handle('formpilot:select-document', async (): Promise<DocumentSelection> => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Student Document / Admission Form',
      filters: [
        { name: 'Documents & Images', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt'] },
        { name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: 'PDF Documents', extensions: ['pdf'] },
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];
    return { canceled: false, filePath, fileName: path.basename(filePath) };
  });

  // Start an automation session, refusing concurrent runs.
  ipcMain.handle('formpilot:start-session', async (_event, options: StartSessionOptions) => {
    if (agentController.isSessionRunning()) {
      return { success: false, error: 'A session is already running.' };
    }

    agentController.updateSettings(secretStore.loadPreferences());

    agentController.startSession(options).catch((error: Error) => {
      console.error('Session execution error:', error);
      sendToRenderer('formpilot:event', {
        eventId: `evt_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'TOOL_FAILED',
        description: `Session failed: ${error.message}`,
        success: false,
      });
    });

    return { success: true };
  });

  // Interruption controls.
  ipcMain.handle('formpilot:pause-agent', async () => {
    agentController.pause();
  });

  ipcMain.handle('formpilot:resume-agent', async () => {
    agentController.resume();
  });

  ipcMain.handle('formpilot:takeover-agent', async () => {
    agentController.takeOver();
  });

  ipcMain.handle('formpilot:stop-agent', async () => {
    agentController.stop();
  });

  ipcMain.handle('formpilot:submit-form', async () => {
    try {
      const result = await agentController.submitFormAsOperator();
      return { success: true, message: result.message };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('formpilot:answer-clarification', async (_event, { clarificationId, answer }) => {
    const delivered = agentController.answerClarification(clarificationId, answer);
    return { success: delivered };
  });

  // Read runtime configuration with a redacted credential preview.
  ipcMain.handle('formpilot:get-settings', async () => {
    const preferences = secretStore.loadPreferences();
    try {
      const remote = await backendClient.getSettings();
      return {
        headless: preferences.headless,
        typingDelayMs: preferences.typingDelayMs,
        geminiModel: remote.model || preferences.geminiModel,
        apiKeyConfigured: remote.api_key_configured,
        maskedKey: remote.masked_key,
      };
    } catch {
      return {
        headless: preferences.headless,
        typingDelayMs: preferences.typingDelayMs,
        geminiModel: preferences.geminiModel,
        apiKeyConfigured: false,
        maskedKey: '',
      };
    }
  });

  // Persist settings. The API key is forwarded to the backend for encrypted storage
  // and is never written to the renderer or to a plaintext file here.
  ipcMain.handle('formpilot:save-settings', async (_event, settings) => {
    const preferences = {
      headless: Boolean(settings?.headless ?? false),
      typingDelayMs: Number(settings?.typingDelayMs ?? 25),
      geminiModel: String(settings?.geminiModel ?? 'gemini-3.6-flash'),
    };
    secretStore.savePreferences(preferences);
    agentController.updateSettings(preferences);

    const apiKey = typeof settings?.geminiApiKey === 'string' ? settings.geminiApiKey.trim() : '';
    try {
      const result = await backendClient.updateSettings(apiKey || undefined, preferences.geminiModel);
      return { success: true, apiKeyConfigured: result.api_key_configured, maskedKey: result.masked_key };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Failed to update settings.' };
    }
  });

  // Validate a candidate Gemini key without persisting it.
  ipcMain.handle('formpilot:test-gemini', async (_event, { apiKey, model }) => {
    try {
      return await backendClient.testGemini(apiKey, model);
    } catch (error: any) {
      return { valid: false, message: error?.message || 'Backend unreachable.' };
    }
  });

  // Extract document facts on behalf of the renderer so no direct backend access is needed.
  ipcMain.handle('formpilot:extract-document', async (_event, payload) => {
    try {
      return await backendClient.extractDocument({
        filePath: payload?.filePath,
        rawText: payload?.rawText,
        documentName: payload?.documentName,
      });
    } catch (error: any) {
      return { error: error?.message || 'Failed to extract document facts.' };
    }
  });

  // Report backend reachability for the UI status indicator.
  ipcMain.handle('formpilot:backend-health', async () => {
    return { healthy: await backendClient.health() };
  });

  // Stream agent execution events to the renderer.
  agentController.onEvent((event) => {
    sendToRenderer('formpilot:event', event);
  });

  agentController.onClarificationRequest((prompt) => {
    sendToRenderer('formpilot:clarification-request', prompt);
  });

  agentController.getStateMachine().onTransition((state, previousState) => {
    sendToRenderer('formpilot:state-change', { state, previousState });
  });
}
