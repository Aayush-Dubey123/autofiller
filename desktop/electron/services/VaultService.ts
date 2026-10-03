/**
 * VaultService: Node crypto AES-256-GCM encrypted vault manager for AutoFiller AI.
 *
 * Implements:
 * - Local-only AES-256-GCM encryption with scrypt KDF key derivation.
 * - DEK (Data Encryption Key) wrapped by privacy key KEK and optional recovery code KEK.
 * - In-memory DEK storage during unlocked state, with zeroization on lock.
 * - 15-minute auto-lock idle timer.
 * - Rejection of prohibited sensitive credentials (passwords, card numbers, CVVs, OTPs, bank accounts).
 * - Multi-profile storage with canonical field mapping keys.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ProfileRecord, VaultStatus } from '../shared/types';

/** Prohibited key patterns that are refused from vault storage. */
const PROHIBITED_KEYS_REGEX = /password|passwd|card_number|credit_card|card_num|cvv|cvc|otp|one_time_pwd|bank_account|account_number|bank_acc|routing_number|pin_code_secret/i;

const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export interface EncryptedVaultFormat {
  version: number;
  kdf: {
    algorithm: string;
    N: number;
    r: number;
    p: number;
    salt: string;
  };
  wrappedDek: {
    iv: string;
    authTag: string;
    ciphertext: string;
  };
  recoveryWrappedDek?: {
    recoverySalt: string;
    iv: string;
    authTag: string;
    ciphertext: string;
  };
  vaultIv: string;
  vaultAuthTag: string;
  ciphertext: string;
}

export class VaultService {
  private vaultPath: string;
  private activeDek: Buffer | null = null;
  private profiles: ProfileRecord[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private failedAttempts: number = 0;
  private lastFailedTime: number = 0;

  constructor(userDataPath: string) {
    this.vaultPath = path.join(userDataPath, 'vault.enc');
  }

  /** Report vault existence and active lock status. */
  public getStatus(): VaultStatus {
    const exists = fs.existsSync(this.vaultPath);
    let recoveryAvailable = false;
    if (exists) {
      try {
        const raw = fs.readFileSync(this.vaultPath, 'utf-8');
        const parsed = JSON.parse(raw) as EncryptedVaultFormat;
        recoveryAvailable = Boolean(parsed.recoveryWrappedDek);
      } catch {
        // Ignore parse error
      }
    }
    return {
      exists,
      unlocked: this.activeDek !== null,
      recoveryAvailable,
    };
  }

  /** Reset idle auto-lock timer on activity. */
  public touchActivity(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    if (this.activeDek !== null) {
      this.idleTimer = setTimeout(() => {
        this.lock();
      }, IDLE_TIMEOUT_MS);
    }
  }

  /** Derive 32-byte KEK using scrypt. */
  private deriveKek(passphrase: string, salt: Buffer): Buffer {
    return crypto.scryptSync(passphrase, salt, 32, SCRYPT_PARAMS);
  }

  /** Encrypt buffer using AES-256-GCM. */
  private encryptAesGcm(key: Buffer, plaintext: Buffer): { iv: string; authTag: string; ciphertext: string } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      ciphertext: ciphertext.toString('hex'),
    };
  }

  /** Decrypt ciphertext using AES-256-GCM. */
  private decryptAesGcm(key: Buffer, ivHex: string, authTagHex: string, ciphertextHex: string): Buffer {
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /** Generate random recovery code (24 chars grouped). */
  private generateRecoveryCode(): string {
    const raw = crypto.randomBytes(12).toString('hex').toUpperCase();
    return (raw.match(/.{1,4}/g) || []).join('-');
  }

  /** Create new vault with privacy key and optional recovery code. */
  public createVault(
    privacyKey: string,
    useRecoveryCode: boolean = false
  ): { success: boolean; recoveryCode?: string; error?: string } {
    if (!privacyKey || privacyKey.length < 6) {
      return { success: false, error: 'Privacy key must be at least 6 characters.' };
    }

    try {
      const dek = crypto.randomBytes(32);
      const salt = crypto.randomBytes(16);
      const kek = this.deriveKek(privacyKey, salt);
      const wrappedDek = this.encryptAesGcm(kek, dek);

      let recoveryCode: string | undefined;
      let recoveryWrappedDek: EncryptedVaultFormat['recoveryWrappedDek'] | undefined;

      if (useRecoveryCode) {
        recoveryCode = this.generateRecoveryCode();
        const recoverySalt = crypto.randomBytes(16);
        const recoveryKek = this.deriveKek(recoveryCode, recoverySalt);
        const wrapped = this.encryptAesGcm(recoveryKek, dek);
        recoveryWrappedDek = {
          recoverySalt: recoverySalt.toString('hex'),
          iv: wrapped.iv,
          authTag: wrapped.authTag,
          ciphertext: wrapped.ciphertext,
        };
      }

      this.profiles = [
        {
          id: 'profile_default',
          name: 'Primary Profile',
          sections: [
            { id: 'sec_personal', title: 'Personal Information', fields: [] },
            { id: 'sec_contact', title: 'Contact Details', fields: [] },
            { id: 'sec_address', title: 'Address Information', fields: [] },
            { id: 'sec_parent', title: 'Parent / Guardian Details', fields: [] },
            { id: 'sec_education', title: 'Education & Previous School', fields: [] },
            { id: 'sec_id', title: 'ID Numbers (Optional)', fields: [] },
            { id: 'sec_custom', title: 'Custom Fields', fields: [] },
          ],
        },
      ];

      const vaultBuffer = Buffer.from(JSON.stringify(this.profiles), 'utf-8');
      const encryptedVault = this.encryptAesGcm(dek, vaultBuffer);

      const fileData: EncryptedVaultFormat = {
        version: 1,
        kdf: {
          algorithm: 'scrypt',
          N: SCRYPT_PARAMS.N,
          r: SCRYPT_PARAMS.r,
          p: SCRYPT_PARAMS.p,
          salt: salt.toString('hex'),
        },
        wrappedDek,
        recoveryWrappedDek,
        vaultIv: encryptedVault.iv,
        vaultAuthTag: encryptedVault.authTag,
        ciphertext: encryptedVault.ciphertext,
      };

      fs.writeFileSync(this.vaultPath, JSON.stringify(fileData, null, 2), { mode: 0o600 });
      this.activeDek = dek;
      this.failedAttempts = 0;
      this.touchActivity();

      return { success: true, recoveryCode };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Could not create encrypted vault.' };
    }
  }

  /** Unlock vault using privacy key or recovery code. Enforces growing backoff delay. */
  public unlock(options: { privacyKey?: string; recoveryCode?: string }): { success: boolean; error?: string } {
    if (!fs.existsSync(this.vaultPath)) {
      return { success: false, error: 'Vault does not exist.' };
    }

    // Growing backoff after 3 repeated failed unlock attempts
    if (this.failedAttempts >= 3) {
      const delayMs = Math.min(Math.pow(2, this.failedAttempts - 3) * 1000, 16000);
      const elapsed = Date.now() - this.lastFailedTime;
      if (elapsed < delayMs) {
        const remainingSec = Math.ceil((delayMs - elapsed) / 1000);
        return { success: false, error: `Too many failed attempts. Try again in ${remainingSec}s.` };
      }
    }

    try {
      const raw = fs.readFileSync(this.vaultPath, 'utf-8');
      const data = JSON.parse(raw) as EncryptedVaultFormat;

      let dek: Buffer | null = null;

      if (options.privacyKey) {
        const salt = Buffer.from(data.kdf.salt, 'hex');
        const kek = this.deriveKek(options.privacyKey, salt);
        dek = this.decryptAesGcm(kek, data.wrappedDek.iv, data.wrappedDek.authTag, data.wrappedDek.ciphertext);
      } else if (options.recoveryCode && data.recoveryWrappedDek) {
        const recoverySalt = Buffer.from(data.recoveryWrappedDek.recoverySalt, 'hex');
        const kek = this.deriveKek(options.recoveryCode, recoverySalt);
        dek = this.decryptAesGcm(
          kek,
          data.recoveryWrappedDek.iv,
          data.recoveryWrappedDek.authTag,
          data.recoveryWrappedDek.ciphertext
        );
      } else {
        return { success: false, error: 'Privacy key or recovery code required.' };
      }

      // Decrypt profiles using DEK
      const vaultBytes = this.decryptAesGcm(dek, data.vaultIv, data.vaultAuthTag, data.ciphertext);
      this.profiles = JSON.parse(vaultBytes.toString('utf-8')) as ProfileRecord[];
      this.activeDek = dek;
      this.failedAttempts = 0;
      this.touchActivity();

      return { success: true };
    } catch {
      this.failedAttempts += 1;
      this.lastFailedTime = Date.now();
      return { success: false, error: 'Invalid privacy key or recovery code.' };
    }
  }

  /** Zeroize DEK in memory and lock vault. */
  public lock(): void {
    if (this.activeDek) {
      this.activeDek.fill(0);
      this.activeDek = null;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.profiles = [];
  }

  /** Write updated profiles payload encrypted with current DEK. */
  private saveVaultData(): void {
    if (!this.activeDek || !fs.existsSync(this.vaultPath)) {
      throw new Error('Vault is locked.');
    }
    const raw = fs.readFileSync(this.vaultPath, 'utf-8');
    const data = JSON.parse(raw) as EncryptedVaultFormat;

    const vaultBuffer = Buffer.from(JSON.stringify(this.profiles), 'utf-8');
    const encryptedVault = this.encryptAesGcm(this.activeDek, vaultBuffer);

    data.vaultIv = encryptedVault.iv;
    data.vaultAuthTag = encryptedVault.authTag;
    data.ciphertext = encryptedVault.ciphertext;

    fs.writeFileSync(this.vaultPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    this.touchActivity();
  }

  /** Read profiles when unlocked. */
  public getProfiles(): ProfileRecord[] {
    if (!this.activeDek) {
      throw new Error('Vault is locked.');
    }
    this.touchActivity();
    return this.profiles;
  }

  /** Validate field for prohibited credential keys (passwords, card numbers, CVVs, OTPs). */
  private validateField(field: { key: string; label?: string; value: string }): void {
    if (PROHIBITED_KEYS_REGEX.test(field.key) || PROHIBITED_KEYS_REGEX.test(field.label || '')) {
      throw new Error(
        `Field '${field.key}' is prohibited from vault storage (passwords, card numbers, CVV, OTPs, and bank account numbers cannot be stored).`
      );
    }
  }

  /** Upsert a profile record into vault. */
  public saveProfile(profile: ProfileRecord): void {
    if (!this.activeDek) {
      throw new Error('Vault is locked.');
    }
    // Validate all fields across all sections
    for (const sec of profile.sections || []) {
      for (const field of sec.fields || []) {
        this.validateField(field);
      }
    }

    const idx = this.profiles.findIndex((p) => p.id === profile.id);
    if (idx >= 0) {
      this.profiles[idx] = profile;
    } else {
      this.profiles.push(profile);
    }
    this.saveVaultData();
  }

  /** Delete profile by ID. */
  public deleteProfile(profileId: string): void {
    if (!this.activeDek) {
      throw new Error('Vault is locked.');
    }
    this.profiles = this.profiles.filter((p) => p.id !== profileId);
    this.saveVaultData();
  }

  /** Delete single field by profileId, sectionId, fieldKey. */
  public deleteField(profileId: string, sectionId: string, fieldKey: string): void {
    if (!this.activeDek) {
      throw new Error('Vault is locked.');
    }
    const profile = this.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    const section = profile.sections.find((s) => s.id === sectionId);
    if (!section) return;
    section.fields = section.fields.filter((f) => f.key !== fieldKey);
    this.saveVaultData();
  }

  /** Re-wrap DEK with a new privacy key. */
  public changePrivacyKey(currentPrivacyKey: string, newPrivacyKey: string): { success: boolean; error?: string } {
    if (!this.activeDek) {
      return { success: false, error: 'Vault is locked.' };
    }
    if (!newPrivacyKey || newPrivacyKey.length < 6) {
      return { success: false, error: 'New privacy key must be at least 6 characters.' };
    }
    try {
      const raw = fs.readFileSync(this.vaultPath, 'utf-8');
      const data = JSON.parse(raw) as EncryptedVaultFormat;

      // Verify current key
      const currentSalt = Buffer.from(data.kdf.salt, 'hex');
      const currentKek = this.deriveKek(currentPrivacyKey, currentSalt);
      this.decryptAesGcm(currentKek, data.wrappedDek.iv, data.wrappedDek.authTag, data.wrappedDek.ciphertext);

      // Re-wrap DEK with new key
      const newSalt = crypto.randomBytes(16);
      const newKek = this.deriveKek(newPrivacyKey, newSalt);
      const newWrappedDek = this.encryptAesGcm(newKek, this.activeDek);

      data.kdf.salt = newSalt.toString('hex');
      data.wrappedDek = newWrappedDek;

      fs.writeFileSync(this.vaultPath, JSON.stringify(data, null, 2), { mode: 0o600 });
      this.touchActivity();
      return { success: true };
    } catch {
      return { success: false, error: 'Current privacy key is incorrect.' };
    }
  }

  /** Completely erase vault file and zeroize memory. */
  public eraseAll(): void {
    this.lock();
    if (fs.existsSync(this.vaultPath)) {
      fs.unlinkSync(this.vaultPath);
    }
  }
}
