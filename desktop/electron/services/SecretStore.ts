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

export class SecretStore {
  private tokenPath: string;

  constructor() {
    this.tokenPath = path.join(app.getPath('userData'), TOKEN_FILE);
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
}
