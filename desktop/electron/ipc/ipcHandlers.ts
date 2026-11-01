/**
 * IPC handlers registering desktop window operations and bridging to the AgentController.
 *
 * All renderer access to privileged functionality flows through these narrow, typed
 * channels. The renderer never receives the backend URL, the operator token, or any
 * Node capability.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { AgentController } from '../agent/AgentController';
import { BackendClient } from '../services/BackendClient';
import { HistoryStore, SecretStore, VaultService } from '../services/VaultService';
import { DocumentRecord, DocumentSelection, EngineStatus, ProfileRecord, SessionRecord, StartSessionOptions, VaultStatus } from '../shared/types';
/** In-memory remembered documents cache for active session reuse (Fixes M-04). */
const rememberedDocuments: DocumentRecord[] = [];

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

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB ceiling matching backend
const UPLOAD_DIR = path.join(os.tmpdir(), 'autofiller-uploads');
const MAX_STORED_UPLOAD_COPIES = 5;

/** Ensure the designated upload directory exists. */
function ensureUploadDir(): string {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  return UPLOAD_DIR;
}

/**
 * Prune copied upload files to cap total stored copies and avoid unbounded accumulation.
 */
function pruneUploadDir(maxKeep: number = MAX_STORED_UPLOAD_COPIES): void {
  try {
    if (!fs.existsSync(UPLOAD_DIR)) return;
    const entries = fs
      .readdirSync(UPLOAD_DIR)
      .map((name) => {
        const fullPath = path.join(UPLOAD_DIR, name);
        try {
          const stat = fs.statSync(fullPath);
          return { name, fullPath, mtimeMs: stat.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((e): e is { name: string; fullPath: string; mtimeMs: number } => e !== null);

    if (entries.length > maxKeep) {
      entries.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
      const toDelete = entries.slice(0, entries.length - maxKeep);
      for (const item of toDelete) {
        try {
          fs.unlinkSync(item.fullPath);
        } catch {}
      }
    }
  } catch (err) {
    console.warn('Could not prune upload directory:', err);
  }
}

/** Clean up all upload copies (for erase-all-my-data or shutdown). */
function clearUploadDir(): void {
  try {
    if (fs.existsSync(UPLOAD_DIR)) {
      fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn('Could not clear upload directory:', err);
  }
}

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  agentController: AgentController,
  historyStore: HistoryStore,
  vaultService: VaultService,
  getEngineStatus: () => EngineStatus = () => ({ ready: true }),
  secretStore?: SecretStore | null,
  onRestartBackend?: () => Promise<boolean>
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

  let activeSessionUploadPath: string | null = null;

  // Native document selection dialog. Returns the safe file path inside designated upload directory.
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

      const originalPath = result.filePaths[0];

      // Enforce the size cap before copying so a huge file fails fast
      const stat = fs.statSync(originalPath);
      if (stat.size > MAX_DOCUMENT_BYTES) {
        return {
          canceled: false,
          error: `Document exceeds the maximum supported size of ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`,
        };
      }

      // Prune older upload copies to keep storage capped
      pruneUploadDir(MAX_STORED_UPLOAD_COPIES - 1);

      // Copy file into the app's designated upload directory with a generated safe filename
      const uploadDir = ensureUploadDir();
      const ext = path.extname(originalPath);
      const originalBase = path.basename(originalPath, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeFileName = `doc_${Date.now()}_${originalBase.slice(0, 32)}${ext}`;
      const safeFilePath = path.join(uploadDir, safeFileName);

      fs.copyFileSync(originalPath, safeFilePath);

      // Track active copied upload file for cleanup on session end
      activeSessionUploadPath = safeFilePath;

      return {
        canceled: false,
        filePath: safeFilePath,
        fileName: path.basename(originalPath),
        fileSize: stat.size,
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

    // Clean up previous error or completed state so retries launch cleanly
    const currentState = agentController.getStateMachine().getState();
    if (currentState === 'ERROR' || currentState === 'COMPLETED') {
      await agentController.cleanup().catch(() => {});
    }

    const urlError = validateTargetUrl(options?.targetUrl);
    if (urlError) {
      return { success: false, error: urlError };
    }

    historyStore.beginSession({
      targetUrl: options.targetUrl,
      profileName: options.documentName ? 'Document & Profile' : 'Profile Facts',
      dataSource: options.documentPath ? (options.facts ? 'both' : 'document') : 'profile',
      totalFields: 0,
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

  ipcMain.handle('autofiller:check-blocker-resume', async () => {
    return await agentController.checkBlockerResume();
  });

  ipcMain.handle('autofiller:stop-agent', async () => {
    await agentController.stop();
    return { success: true };
  });

  ipcMain.handle('autofiller:confirm-submission', async () => {
    await agentController.confirmManualSubmission();
    return { success: true };
  });


  ipcMain.handle('autofiller:answer-clarification', async (_event, { clarificationId, answer }) => {
    const delivered = agentController.answerClarification(clarificationId, answer);
    return { success: delivered };
  });

  // Extract document facts on behalf of the renderer so no direct backend access is needed.
  // Successful file extractions are remembered so they can be reused from the Documents view (Fixes M-04).
  ipcMain.handle('autofiller:extract-document', async (_event, payload) => {
    try {
      const result = await backendClient.extractDocument({
        filePath: payload?.filePath,
        rawText: payload?.rawText,
        documentName: payload?.documentName,
      });
      if (result && !('error' in result) && result.facts) {
        const docName = result.document_name || payload?.documentName || 'Document';
        const existingIdx = rememberedDocuments.findIndex((d) => d.name === docName);
        const record: DocumentRecord = {
          id: `doc_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
          name: docName,
          size: payload?.fileSize || 0,
          path: payload?.filePath || '',
          extractedAt: new Date().toISOString(),
          facts: result.facts,
        };
        if (existingIdx >= 0) {
          rememberedDocuments[existingIdx] = record;
        } else {
          rememberedDocuments.unshift(record);
          if (rememberedDocuments.length > 20) rememberedDocuments.pop();
        }
      }
      return result;
    } catch (error: any) {
      return { error: error?.message || 'Failed to extract document facts.' };
    }
  });

  // History & document store handlers
  ipcMain.handle('autofiller:history-list', async () => historyStore.listSessions());
  ipcMain.handle('autofiller:documents-list', async () => [...rememberedDocuments]);
  ipcMain.handle('autofiller:backend-health', async () => backendClient.healthStatus());
  ipcMain.handle('autofiller:get-engine-status', async () => getEngineStatus());
  ipcMain.handle('autofiller:history-delete', async (_event, id: string) => {
    historyStore.deleteSession(id);
    return { success: true };
  });
  ipcMain.handle('autofiller:history-delete-multiple', async (_event, ids: string[]) => {
    historyStore.deleteSessions(ids);
    return { success: true };
  });
  ipcMain.handle('autofiller:history-update-status', async (_event, payload: { id: string; status: SessionRecord['status'] }) => {
    const success = historyStore.updateSessionStatus(payload?.id, payload?.status);
    return { success };
  });
  ipcMain.handle('autofiller:history-clear-all', async () => {
    historyStore.clearAllSessions();
    return { success: true };
  });

  // Global complete data erasure ("Erase all my data")
  ipcMain.handle('autofiller:erase-all-data', async () => {
    try {
      vaultService.eraseAll();
      historyStore.clearAllSessions();
      rememberedDocuments.length = 0;
      clearUploadDir();
      activeSessionUploadPath = null;
      const logsDir = path.join(app.getPath('userData'), 'logs');
      if (fs.existsSync(logsDir)) {
        fs.rmSync(logsDir, { recursive: true, force: true });
      }
      try {
        await backendClient.purgeAllSessions();
      } catch {
        // Safe fallback if backend is offline
      }
      app.relaunch();
      app.exit(0);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Data erasure failed.' };
    }
  });

  // Encrypted Vault IPC Channels
  ipcMain.handle('vault:status', async (): Promise<VaultStatus> => vaultService.getStatus());

  ipcMain.handle('vault:create', async (_event, payload) =>
    vaultService.createVault(payload?.privacyKey, payload?.useRecoveryCode)
  );

  ipcMain.handle('vault:enable-extra', async (_event, payload) =>
    vaultService.enableExtraProtection(payload?.privacyKey, payload?.wantRecovery)
  );

  ipcMain.handle('vault:disable-extra', async (_event, payload) =>
    vaultService.disableExtraProtection(payload?.privacyKey)
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
      await vaultService.ensureVaultInitialized();
      return vaultService.getProfiles();
    } catch {
      return [];
    }
  });

  ipcMain.handle('vault:save-profile', async (_event, profile: ProfileRecord) => {
    try {
      await vaultService.saveProfile(profile);
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

  // AI Provider Configuration (Encrypted via Windows DPAPI, zero key leakage to renderer)
  ipcMain.handle('autofiller:get-ai-config', async (): Promise<{ configured: boolean }> => {
    const hasKey = secretStore ? secretStore.hasApiKey() : Boolean(process.env.GEMINI_API_KEY?.trim());
    return { configured: hasKey };
  });

  ipcMain.handle(
    'autofiller:set-ai-key',
    async (_event, apiKey: unknown): Promise<{ success: boolean; error?: string }> => {
      if (typeof apiKey !== 'string' || !apiKey.trim()) {
        return { success: false, error: 'API key must be a non-empty string.' };
      }
      try {
        const cleanKey = apiKey.trim();
        if (secretStore) {
          secretStore.saveApiKey(cleanKey);
        }
        process.env.GEMINI_API_KEY = cleanKey;
        // Dynamically update the running backend in memory without restart
        const dynamicOk = await backendClient.configureAiKey(cleanKey);
        if (!dynamicOk && onRestartBackend) {
          // Fall back to controlled backend restart if endpoint did not respond
          await onRestartBackend();
        }
        return { success: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: msg };
      }
    }
  );

  ipcMain.handle('autofiller:clear-ai-key', async (): Promise<{ success: boolean; error?: string }> => {
    try {
      if (secretStore) {
        secretStore.clearApiKey();
      }
      delete process.env.GEMINI_API_KEY;
      await backendClient.clearAiKey().catch(() => {});
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });
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
    if (state === 'COMPLETED' || state === 'ERROR' || state === 'IDLE') {
      if (activeSessionUploadPath) {
        try {
          if (fs.existsSync(activeSessionUploadPath)) {
            fs.unlinkSync(activeSessionUploadPath);
          }
        } catch {}
        activeSessionUploadPath = null;
      }
    }
  });
}
