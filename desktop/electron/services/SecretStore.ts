/**
 * SecretStore using Electron's OS-level encryption for the internal operator token.
 *
 * The token is never written in plaintext and never exposed to the renderer. On
 * platforms without OS encryption support the store refuses to persist rather than
 * silently falling back to plaintext.
 */

import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';

/** File name holding the encrypted internal operator token. */
const TOKEN_FILE = 'operator-token.bin';

/** File name holding non-secret runtime preferences. */
const PREFERENCES_FILE = 'preferences.json';

export interface StoredPreferences {
  headless: boolean;
  typingDelayMs: number;
  geminiModel: string;
}

export class SecretStore {
  private tokenPath: string;
  private preferencesPath: string;

  constructor() {
    const baseDir = app.getPath('userData');
    this.tokenPath = path.join(baseDir, TOKEN_FILE);
    this.preferencesPath = path.join(baseDir, PREFERENCES_FILE);
  }

  /**
   * Report whether OS-level encryption is available.
   *
   * @returns True when `safeStorage` can encrypt on this platform.
   */
  public isEncryptionAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Persist the internal operator token using OS-level encryption.
   *
   * @param token Internal operator token issued by the backend.
   * @throws Error when OS encryption is unavailable.
   */
  public saveToken(token: string): void {
    if (!this.isEncryptionAvailable()) {
      throw new Error(
        'OS credential encryption is unavailable; refusing to store the token in plaintext.'
      );
    }
    const encrypted = safeStorage.encryptString(token);
    fs.writeFileSync(this.tokenPath, encrypted, { mode: 0o600 });
  }

  /**
   * Read the stored internal operator token.
   *
   * @returns The decrypted token, or null when none is stored.
   */
  public loadToken(): string | null {
    try {
      if (!fs.existsSync(this.tokenPath)) {
        return null;
      }
      const encrypted = fs.readFileSync(this.tokenPath);
      if (!this.isEncryptionAvailable()) {
        return null;
      }
      return safeStorage.decryptString(encrypted);
    } catch (error) {
      console.error('Could not read stored operator token:', error);
      return null;
    }
  }

  /**
   * Delete the stored operator token.
   */
  public clearToken(): void {
    try {
      if (fs.existsSync(this.tokenPath)) {
        fs.unlinkSync(this.tokenPath);
      }
    } catch (error) {
      console.error('Could not clear stored operator token:', error);
    }
  }

  /**
   * Persist non-secret runtime preferences.
   *
   * @param preferences Preferences to store.
   */
  public savePreferences(preferences: StoredPreferences): void {
    try {
      fs.writeFileSync(this.preferencesPath, JSON.stringify(preferences, null, 2), {
        mode: 0o600,
      });
    } catch (error) {
      console.error('Could not persist preferences:', error);
    }
  }

  /**
   * Read stored runtime preferences.
   *
   * @returns Stored preferences merged over the defaults.
   */
  public loadPreferences(): StoredPreferences {
    const defaults: StoredPreferences = {
      headless: false,
      typingDelayMs: 25,
      geminiModel: 'gemini-3.6-flash',
    };
    try {
      if (!fs.existsSync(this.preferencesPath)) {
        return defaults;
      }
      const raw = fs.readFileSync(this.preferencesPath, 'utf-8');
      return { ...defaults, ...JSON.parse(raw) };
    } catch (error) {
      console.error('Could not read stored preferences:', error);
      return defaults;
    }
  }
}
