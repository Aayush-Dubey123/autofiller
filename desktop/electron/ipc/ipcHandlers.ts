/**
 * IPC handlers registering desktop window operations and bridging to the AgentController.
 *
 * All renderer access to privileged functionality flows through these narrow, typed
 * channels. The renderer never receives the backend URL, the operator token, or any
 * Node capability.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

import { AgentController } from '../agent/AgentController';
import { BackendClient } from '../services/BackendClient';
import { HistoryStore } from '../services/HistoryStore';
import { VaultService } from '../services/VaultService';
import { DocumentSelection, EngineStatus, ProfileRecord, StartSessionOptions, VaultStatus } from '../shared/types';

/** Return an error message when the URL is not a usable http(s) URL, otherwise null. */
function validateTargetUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? '').trim());
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? null
      : 'Target URL must start with http:// or https://';
  } catch {
    return 'Target URL is not a valid URL';
  }
}

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  agentController: AgentController,
  historyStore: HistoryStore,
  vaultService: VaultService,
  getEngineStatus: () => EngineStatus = () => ({ ready: true })
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

  // Native document selection dialog. Returns the real file name and size.
  ipcMain.handle('autofiller:select-document', async (): Promise<DocumentSelection> => {
    try {
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
      return {
        canceled: false,
        filePath,
        fileName: path.basename(filePath),
        fileSize: fs.statSync(filePath).size,
      };
    } catch (error: any) {
      return { canceled: false, error: error?.message || 'Could not open the selected file.' };
    }
  });

  // Start an automation session, refusing concurrent runs and invalid input.
  ipcMain.handle('autofiller:start-session', async (_event, options: StartSessionOptions) => {
    if (agentController.isSessionRunning()) {
      return { success: false, error: 'A session is already running.' };
    }
    const urlError = validateTargetUrl(options?.targetUrl);
    if (urlError) {
      return { success: false, error: urlError };
    }

    historyStore.beginSession({
      documentName: options.documentName || 'Untitled document',
      targetUrl: options.targetUrl,
    });

    agentController.startSession(options).catch((error: Error) => {
      console.error('Session execution error:', error);
      sendToRenderer('autofiller:event', {
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
  ipcMain.handle('autofiller:pause-agent', async () => {
    agentController.pause();
  });

  ipcMain.handle('autofiller:resume-agent', async () => {
    agentController.resume();
  });

  ipcMain.handle('autofiller:takeover-agent', async () => {
    agentController.takeOver();
  });

  ipcMain.handle('autofiller:stop-agent', async () => {
    agentController.stop();
  });

  ipcMain.handle('autofiller:submit-form', async () => {
    try {
      const result = await agentController.submitFormAsOperator();
      return { success: true, message: result.message };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('autofiller:answer-clarification', async (_event, { clarificationId, answer }) => {
    const delivered = agentController.answerClarification(clarificationId, answer);
    return { success: delivered };
  });

  // Extract document facts on behalf of the renderer so no direct backend access is needed.
  // Successful file extractions are remembered so they can be reused from the Documents view.
  ipcMain.handle('autofiller:extract-document', async (_event, payload) => {
    try {
      const result = await backendClient.extractDocument({
        filePath: payload?.filePath,
        rawText: payload?.rawText,
        documentName: payload?.documentName,
      });
      if (payload?.filePath && result.facts?.length > 0) {
        let size = 0;
        try {
          size = fs.statSync(payload.filePath).size;
        } catch {
          // The file may have moved after extraction; the size is informational only.
        }
        historyStore.upsertDocument({
          name: payload.documentName || path.basename(payload.filePath),
          size,
          path: payload.filePath,
          facts: result.facts,
        });
      }
      return result;
    } catch (error: any) {
      return { error: error?.message || 'Failed to extract document facts.' };
    }
  });

  // Read-only views of the persisted JSON store.
  ipcMain.handle('autofiller:history-list', async () => historyStore.listSessions());
  ipcMain.handle('autofiller:documents-list', async () => historyStore.listDocuments());

  // Encrypted Vault IPC Channels
  ipcMain.handle('vault:status', async (): Promise<VaultStatus> => vaultService.getStatus());

  ipcMain.handle('vault:create', async (_event, payload) =>
    vaultService.createVault(payload?.privacyKey, payload?.useRecoveryCode)
  );

  ipcMain.handle('vault:unlock', async (_event, payload) =>
    vaultService.unlock({ privacyKey: payload?.privacyKey, recoveryCode: payload?.recoveryCode })
  );

  ipcMain.handle('vault:lock', async () => {
    vaultService.lock();
    return { success: true };
  });

  ipcMain.handle('vault:get-profiles', async (): Promise<ProfileRecord[]> => {
    try {
      return vaultService.getProfiles();
    } catch {
      return [];
    }
  });

  ipcMain.handle('vault:save-profile', async (_event, profile: ProfileRecord) => {
    try {
      vaultService.saveProfile(profile);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Could not save profile.' };
    }
  });

  ipcMain.handle('vault:delete-profile', async (_event, profileId: string) => {
    try {
      vaultService.deleteProfile(profileId);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Could not delete profile.' };
    }
  });

  ipcMain.handle('vault:delete-field', async (_event, payload) => {
    try {
      vaultService.deleteField(payload?.profileId, payload?.sectionId, payload?.fieldKey);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Could not delete field.' };
    }
  });

  ipcMain.handle('vault:change-key', async (_event, payload) =>
    vaultService.changePrivacyKey(payload?.currentPrivacyKey, payload?.newPrivacyKey)
  );

  ipcMain.handle('vault:erase-all', async () => {
    vaultService.eraseAll();
    return { success: true };
  });

  ipcMain.handle('autofiller:app-version', async () => app.getVersion());

  // Stream agent execution events to the renderer and into the session history.
  agentController.onEvent((event) => {
    historyStore.noteEvent(event);
    sendToRenderer('autofiller:event', event);
  });

  agentController.onClarificationRequest((prompt) => {
    sendToRenderer('autofiller:clarification-request', prompt);
  });

  agentController.getStateMachine().onTransition((state, previousState) => {
    historyStore.noteState(state);
    sendToRenderer('autofiller:state-change', { state, previousState });
  });
}
