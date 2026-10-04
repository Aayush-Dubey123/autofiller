/**
 * VaultService: Node crypto AES-256-GCM encrypted vault manager for AutoFiller AI.
 *
 * Implements Vault V2 (Key Slots):
 * - KeyProtector interface with Electron safeStorage implementation and test fallback.
 * - Standard protection (os slot, transparent decryption on logged-in OS account).
 * - Extra protection (passphrase slot with scrypt N=2^17, optional recovery slot).
 * - Backward compatibility with V1 vault files.
 * - Atomic disk writes (temp file + rename, keeping vault.enc.bak).
 * - Whole-word / exact-key prohibited field validation (password, card_number refused; aadhaar_card_number, passport allowed).
 * - 15-minute idle auto-lock active ONLY when passphrase slot exists.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { safeStorage } from 'electron';
import { ProfileRecord, VaultStatus } from '../shared/types';

const SCRYPT_N_V2 = 131072; // N = 2^17
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/** Prohibited exact keys & whole-word patterns refused from vault storage. */
const REFUSED_KEYS = new Set([
  'password',
  'passwd',
  'cvv',
  'cvc',
  'otp',
  'card_number',
  'credit_card',
  'bank_account_number',
]);

/** KeySlotCipher structure used in V2 slots. */
export interface KeySlotCipher {
  iv: string;
  authTag: string;
  ciphertext: string;
}

/** PassphraseSlot specification for V2 vault files. */
export interface PassphraseSlot extends KeySlotCipher {
  algorithm: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
}

/** RecoverySlot specification for V2 vault files. */
export interface RecoverySlot extends KeySlotCipher {
  recoverySalt: string;
}

/** Vault V2 on-disk encrypted structure. */
export interface EncryptedVaultFormatV2 {
  version: 2;
  slots: {
    os?: KeySlotCipher;
    passphrase?: PassphraseSlot;
    recovery?: RecoverySlot;
  };
  vault: KeySlotCipher;
}

/** Legacy Vault V1 on-disk encrypted structure. */
export interface EncryptedVaultFormatV1 {
  version?: 1;
  kdf: {
    algorithm: string;
    N: number;
    r: number;
    p: number;
    salt: string;
  };
  wrappedDek: KeySlotCipher;
  recoveryWrappedDek?: RecoverySlot;
  vaultIv: string;
  vaultAuthTag: string;
  ciphertext: string;
}

export type EncryptedVaultFormat = EncryptedVaultFormatV2 | EncryptedVaultFormatV1;

/** Abstract KeyProtector interface for wrapping/unwrapping DEK with OS keychain. */
export interface KeyProtector {
  isAvailable(): boolean;
  wrap(dek: Buffer): Promise<KeySlotCipher>;
  unwrap(slot: KeySlotCipher): Promise<Buffer>;
}

/** Electron safeStorage implementation of KeyProtector. */
export class ElectronKeyProtector implements KeyProtector {
  public isAvailable(): boolean {
    try {
      if (typeof safeStorage === 'undefined' || !safeStorage) return false;
      if (!safeStorage.isEncryptionAvailable()) return false;
      const backend = safeStorage.getSelectedStorageBackend?.();
      if (backend === 'basic_text') return false;
      return true;
    } catch {
      return false;
    }
  }

  public async wrap(dek: Buffer): Promise<KeySlotCipher> {
    if (!this.isAvailable()) {
      throw new Error('OS safeStorage encryption is unavailable.');
    }
    const encrypted = safeStorage.encryptString(dek.toString('hex'));
    return {
      iv: 'os_safe_storage',
      authTag: 'os_safe_storage',
      ciphertext: encrypted.toString('hex'),
    };
  }

  public async unwrap(slot: KeySlotCipher): Promise<Buffer> {
    if (!this.isAvailable()) {
      throw new Error('OS safeStorage encryption is unavailable.');
    }
    const buf = Buffer.from(slot.ciphertext, 'hex');
    const decryptedHex = safeStorage.decryptString(buf);
    return Buffer.from(decryptedHex, 'hex');
  }
}

/** FakeKeyProtector implementation for unit tests when safeStorage is unavailable. */
export class FakeKeyProtector implements KeyProtector {
  private fakeKey = crypto.scryptSync('fake_os_key', 'salt', 32, { N: 16384, r: 8, p: 1 });

  public isAvailable(): boolean {
    return true;
  }

  public async wrap(dek: Buffer): Promise<KeySlotCipher> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.fakeKey, iv);
    const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      ciphertext: ciphertext.toString('hex'),
    };
  }

  public async unwrap(slot: KeySlotCipher): Promise<Buffer> {
    const iv = Buffer.from(slot.iv, 'hex');
    const authTag = Buffer.from(slot.authTag, 'hex');
    const ciphertext = Buffer.from(slot.ciphertext, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.fakeKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

export class VaultService {
  private vaultPath: string;
  private activeDek: Buffer | null = null;
  private profiles: ProfileRecord[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private failedAttempts: number = 0;
  private lastFailedTime: number = 0;
  private keyProtector: KeyProtector;

  constructor(userDataPath: string, keyProtector?: KeyProtector) {
    this.vaultPath = path.join(userDataPath, 'vault.enc');
    this.keyProtector = keyProtector || new ElectronKeyProtector();
  }

  public setKeyProtector(protector: KeyProtector): void {
    this.keyProtector = protector;
  }

  /** Report vault existence, unlock status, and slot details. */
  public getStatus(): VaultStatus {
    const exists = fs.existsSync(this.vaultPath);
    let hasOsSlot = false;
    let hasPassphraseSlot = false;
    let hasRecoverySlot = false;

    if (exists) {
      try {
        const raw = fs.readFileSync(this.vaultPath, 'utf-8');
        const parsed = JSON.parse(raw) as EncryptedVaultFormat;
        if (parsed.version === 2) {
          hasOsSlot = Boolean(parsed.slots.os);
          hasPassphraseSlot = Boolean(parsed.slots.passphrase);
          hasRecoverySlot = Boolean(parsed.slots.recovery);
        } else {
          // V1 format treated as passphrase slot
          hasPassphraseSlot = true;
          hasRecoverySlot = Boolean((parsed as EncryptedVaultFormatV1).recoveryWrappedDek);
        }
      } catch {
        // Ignore parse error
      }
    }

    return {
      exists,
      unlocked: this.activeDek !== null,
      hasOsSlot,
      hasPassphraseSlot,
      hasRecoverySlot,
      recoveryAvailable: hasRecoverySlot,
    };
  }

  /** Reset idle auto-lock timer on activity. Auto-lock applies ONLY when passphrase slot exists. */
  public touchActivity(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const status = this.getStatus();
    if (this.activeDek !== null && status.hasPassphraseSlot) {
      this.idleTimer = setTimeout(() => {
        this.lock();
      }, IDLE_TIMEOUT_MS);
    }
  }

  /** Derive KEK using async scrypt. */
  private async deriveKekAsync(passphrase: string, salt: Buffer, N: number = SCRYPT_N_V2): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(passphrase, salt, 32, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey as Buffer);
      });
    });
  }

  /** Sync KEK derivation fallback. */
  private deriveKekSync(passphrase: string, salt: Buffer, N: number = SCRYPT_N_V2): Buffer {
    return crypto.scryptSync(passphrase, salt, 32, {
      N,
      r: 8,
      p: 1,
      maxmem: 256 * 1024 * 1024,
    });
  }

  /** Encrypt buffer using AES-256-GCM. */
  private encryptAesGcm(key: Buffer, plaintext: Buffer): KeySlotCipher {
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
  private decryptAesGcm(key: Buffer, cipherData: KeySlotCipher): Buffer {
    const iv = Buffer.from(cipherData.iv, 'hex');
    const authTag = Buffer.from(cipherData.authTag, 'hex');
    const ciphertext = Buffer.from(cipherData.ciphertext, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /** Generate random recovery code (24 chars grouped). */
  private generateRecoveryCode(): string {
    const raw = crypto.randomBytes(12).toString('hex').toUpperCase();
    return (raw.match(/.{1,4}/g) || []).join('-');
  }

  /** Write file atomically using temp file + rename, keeping vault.enc.bak. */
  private writeVaultFileAtomically(fileData: EncryptedVaultFormatV2): void {
    const tmpPath = this.vaultPath + '.tmp';
    const bakPath = this.vaultPath + '.bak';
    const content = JSON.stringify(fileData, null, 2);

    fs.writeFileSync(tmpPath, content, { mode: 0o600 });
    if (fs.existsSync(this.vaultPath)) {
      try {
        fs.copyFileSync(this.vaultPath, bakPath);
      } catch {
        // Ignore backup failure if non-critical
      }
    }
    fs.renameSync(tmpPath, this.vaultPath);
  }

  /** Ensure vault file exists and is initialized. Silent creation uses OS slot (Standard protection). */
  public async ensureVaultInitialized(): Promise<boolean> {
    if (this.activeDek !== null) return true;

    if (!fs.existsSync(this.vaultPath)) {
      // Create new vault with OS slot
      const dek = crypto.randomBytes(32);
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

      let osSlot: KeySlotCipher | undefined;
      if (this.keyProtector.isAvailable()) {
        try {
          osSlot = await this.keyProtector.wrap(dek);
        } catch {
          // If OS slot fails, no slots present
        }
      }

      const fileData: EncryptedVaultFormatV2 = {
        version: 2,
        slots: {
          os: osSlot,
        },
        vault: encryptedVault,
      };

      this.writeVaultFileAtomically(fileData);
      this.activeDek = dek;
      this.touchActivity();
      return true;
    }

    // Vault file exists — check if OS slot can silently unlock it
    try {
      const raw = fs.readFileSync(this.vaultPath, 'utf-8');
      const data = JSON.parse(raw) as EncryptedVaultFormat;
      if (data.version === 2 && data.slots.os && this.keyProtector.isAvailable()) {
        const dek = await this.keyProtector.unwrap(data.slots.os);
        const vaultBytes = this.decryptAesGcm(dek, data.vault);
        this.profiles = JSON.parse(vaultBytes.toString('utf-8')) as ProfileRecord[];
        this.activeDek = dek;
        this.touchActivity();
        return true;
      }
    } catch {
      // OS slot unwrap failed or passphrase required
    }

    return this.activeDek !== null;
  }

  /** Unlock vault using privacy key, recovery code, or OS slot. */
  public async unlock(options: { privacyKey?: string; recoveryCode?: string }): Promise<{ success: boolean; error?: string }> {
    if (!fs.existsSync(this.vaultPath)) {
      await this.ensureVaultInitialized();
      if (this.activeDek !== null) return { success: true };
      return { success: false, error: 'Vault does not exist.' };
    }

    // Rate-limit backoff after repeated failures
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

      if (data.version === 2) {
        if (options.privacyKey && data.slots.passphrase) {
          const slot = data.slots.passphrase;
          const salt = Buffer.from(slot.salt, 'hex');
          const kek = await this.deriveKekAsync(options.privacyKey, salt, slot.N);
          dek = this.decryptAesGcm(kek, slot);
        } else if (options.recoveryCode && data.slots.recovery) {
          const slot = data.slots.recovery;
          const recoverySalt = Buffer.from(slot.recoverySalt, 'hex');
          const kek = await this.deriveKekAsync(options.recoveryCode, recoverySalt, SCRYPT_N_V2);
          dek = this.decryptAesGcm(kek, slot);
        } else if (!options.privacyKey && !options.recoveryCode && data.slots.os && this.keyProtector.isAvailable()) {
          dek = await this.keyProtector.unwrap(data.slots.os);
        } else {
          return { success: false, error: 'Privacy key or recovery code required.' };
        }

        const vaultBytes = this.decryptAesGcm(dek, data.vault);
        this.profiles = JSON.parse(vaultBytes.toString('utf-8')) as ProfileRecord[];
        this.activeDek = dek;
        this.failedAttempts = 0;
        this.touchActivity();
        return { success: true };
      } else {
        // V1 Format handling
        const v1Data = data as EncryptedVaultFormatV1;
        if (options.privacyKey && v1Data.wrappedDek) {
          const salt = Buffer.from(v1Data.kdf.salt, 'hex');
          const kek = await this.deriveKekAsync(options.privacyKey, salt, v1Data.kdf.N);
          dek = this.decryptAesGcm(kek, v1Data.wrappedDek);
        } else if (options.recoveryCode && v1Data.recoveryWrappedDek) {
          const slot = v1Data.recoveryWrappedDek;
          const recoverySalt = Buffer.from(slot.recoverySalt, 'hex');
          const kek = await this.deriveKekAsync(options.recoveryCode, recoverySalt, SCRYPT_N_V2);
          dek = this.decryptAesGcm(kek, slot);
        } else {
          return { success: false, error: 'Privacy key or recovery code required.' };
        }

        const vaultBytes = this.decryptAesGcm(dek, {
          iv: v1Data.vaultIv,
          authTag: v1Data.vaultAuthTag,
          ciphertext: v1Data.ciphertext,
        });
        this.profiles = JSON.parse(vaultBytes.toString('utf-8')) as ProfileRecord[];
        this.activeDek = dek;
        this.failedAttempts = 0;
        this.touchActivity();
        return { success: true };
      }
    } catch {
      this.failedAttempts += 1;
      this.lastFailedTime = Date.now();
      return { success: false, error: 'Invalid privacy key or recovery code.' };
    }
  }

  /** Turn on Extra Protection with a privacy key (minimum 10 chars) and optional recovery code. */
  public async enableExtraProtection(
    privacyKey: string,
    wantRecovery: boolean = false
  ): Promise<{ success: boolean; recoveryCode?: string; error?: string }> {
    if (!privacyKey || privacyKey.length < 10) {
      return { success: false, error: 'Privacy key must be at least 10 characters long.' };
    }

    await this.ensureVaultInitialized();
    if (!this.activeDek) {
      return { success: false, error: 'Vault is locked.' };
    }

    try {
      const salt = crypto.randomBytes(16);
      const kek = await this.deriveKekAsync(privacyKey, salt, SCRYPT_N_V2);
      const passphraseWrapped = this.encryptAesGcm(kek, this.activeDek);

      const passphraseSlot: PassphraseSlot = {
        algorithm: 'scrypt',
        N: SCRYPT_N_V2,
        r: 8,
        p: 1,
        salt: salt.toString('hex'),
        ...passphraseWrapped,
      };

      let recoveryCode: string | undefined;
      let recoverySlot: RecoverySlot | undefined;

      if (wantRecovery) {
        recoveryCode = this.generateRecoveryCode();
        const recoverySalt = crypto.randomBytes(16);
        const recoveryKek = await this.deriveKekAsync(recoveryCode, recoverySalt, SCRYPT_N_V2);
        const recoveryWrapped = this.encryptAesGcm(recoveryKek, this.activeDek);
        recoverySlot = {
          recoverySalt: recoverySalt.toString('hex'),
          ...recoveryWrapped,
        };
      }

      const vaultBuffer = Buffer.from(JSON.stringify(this.profiles), 'utf-8');
      const encryptedVault = this.encryptAesGcm(this.activeDek, vaultBuffer);

      const fileData: EncryptedVaultFormatV2 = {
        version: 2,
        slots: {
          passphrase: passphraseSlot,
          recovery: recoverySlot,
        },
        vault: encryptedVault,
      };

      this.writeVaultFileAtomically(fileData);
      this.touchActivity();

      return { success: true, recoveryCode };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Could not enable extra protection.' };
    }
  }

  /** Turn off Extra Protection (requires valid current privacy key; restores OS slot). */
  public async disableExtraProtection(privacyKey: string): Promise<{ success: boolean; error?: string }> {
    if (!privacyKey) {
      return { success: false, error: 'Current privacy key is required.' };
    }

    const unlockRes = await this.unlock({ privacyKey });
    if (!unlockRes.success || !this.activeDek) {
      return { success: false, error: 'Incorrect privacy key.' };
    }

    try {
      let osSlot: KeySlotCipher | undefined;
      if (this.keyProtector.isAvailable()) {
        osSlot = await this.keyProtector.wrap(this.activeDek);
      }

      const vaultBuffer = Buffer.from(JSON.stringify(this.profiles), 'utf-8');
      const encryptedVault = this.encryptAesGcm(this.activeDek, vaultBuffer);

      const fileData: EncryptedVaultFormatV2 = {
        version: 2,
        slots: {
          os: osSlot,
        },
        vault: encryptedVault,
      };

      this.writeVaultFileAtomically(fileData);
      this.touchActivity();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Could not disable extra protection.' };
    }
  }

  /** Change privacy key (requires valid current privacy key and new key min 10 chars). */
  public async changePrivacyKey(currentPrivacyKey: string, newPrivacyKey: string): Promise<{ success: boolean; error?: string }> {
    if (!newPrivacyKey || newPrivacyKey.length < 10) {
      return { success: false, error: 'New privacy key must be at least 10 characters long.' };
    }

    const unlockRes = await this.unlock({ privacyKey: currentPrivacyKey });
    if (!unlockRes.success || !this.activeDek) {
      return { success: false, error: 'Current privacy key is incorrect.' };
    }

    try {
      const raw = fs.readFileSync(this.vaultPath, 'utf-8');
      const data = JSON.parse(raw) as EncryptedVaultFormat;

      const newSalt = crypto.randomBytes(16);
      const newKek = await this.deriveKekAsync(newPrivacyKey, newSalt, SCRYPT_N_V2);
      const newWrappedDek = this.encryptAesGcm(newKek, this.activeDek);

      const passphraseSlot: PassphraseSlot = {
        algorithm: 'scrypt',
        N: SCRYPT_N_V2,
        r: 8,
        p: 1,
        salt: newSalt.toString('hex'),
        ...newWrappedDek,
      };

      const recoverySlot = data.version === 2 ? data.slots.recovery : undefined;

      const vaultBuffer = Buffer.from(JSON.stringify(this.profiles), 'utf-8');
      const encryptedVault = this.encryptAesGcm(this.activeDek, vaultBuffer);

      const fileData: EncryptedVaultFormatV2 = {
        version: 2,
        slots: {
          passphrase: passphraseSlot,
          recovery: recoverySlot,
        },
        vault: encryptedVault,
      };

      this.writeVaultFileAtomically(fileData);
      this.touchActivity();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Failed to change privacy key.' };
    }
  }

  /** Legacy createVault alias supporting V2 extra protection setup. */
  public createVault(
    privacyKey: string,
    useRecoveryCode: boolean = false
  ): { success: boolean; recoveryCode?: string; error?: string } {
    if (!privacyKey || privacyKey.length < 10) {
      return { success: false, error: 'Privacy key must be at least 10 characters long.' };
    }

    try {
      const dek = crypto.randomBytes(32);
      const salt = crypto.randomBytes(16);
      const kek = this.deriveKekSync(privacyKey, salt, SCRYPT_N_V2);
      const wrappedDek = this.encryptAesGcm(kek, dek);

      const passphraseSlot: PassphraseSlot = {
        algorithm: 'scrypt',
        N: SCRYPT_N_V2,
        r: 8,
        p: 1,
        salt: salt.toString('hex'),
        ...wrappedDek,
      };

      let recoveryCode: string | undefined;
      let recoverySlot: RecoverySlot | undefined;

      if (useRecoveryCode) {
        recoveryCode = this.generateRecoveryCode();
        const recoverySalt = crypto.randomBytes(16);
        const recoveryKek = this.deriveKekSync(recoveryCode, recoverySalt, SCRYPT_N_V2);
        const wrapped = this.encryptAesGcm(recoveryKek, dek);
        recoverySlot = {
          recoverySalt: recoverySalt.toString('hex'),
          ...wrapped,
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

      const fileData: EncryptedVaultFormatV2 = {
        version: 2,
        slots: {
          passphrase: passphraseSlot,
          recovery: recoverySlot,
        },
        vault: encryptedVault,
      };

      this.writeVaultFileAtomically(fileData);
      this.activeDek = dek;
      this.failedAttempts = 0;
      this.touchActivity();

      return { success: true, recoveryCode };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Could not create encrypted vault.' };
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

  /** Save active profiles data payload encrypted with current DEK. */
  private saveVaultData(): void {
    if (!this.activeDek || !fs.existsSync(this.vaultPath)) {
      throw new Error('Vault is locked.');
    }
    const raw = fs.readFileSync(this.vaultPath, 'utf-8');
    const data = JSON.parse(raw) as EncryptedVaultFormat;

    const vaultBuffer = Buffer.from(JSON.stringify(this.profiles), 'utf-8');
    const encryptedVault = this.encryptAesGcm(this.activeDek, vaultBuffer);

    if (data.version === 2) {
      data.vault = encryptedVault;
      this.writeVaultFileAtomically(data);
    } else {
      const v1Data = data as EncryptedVaultFormatV1;
      v1Data.vaultIv = encryptedVault.iv;
      v1Data.vaultAuthTag = encryptedVault.authTag;
      v1Data.ciphertext = encryptedVault.ciphertext;
      fs.writeFileSync(this.vaultPath, JSON.stringify(v1Data, null, 2), { mode: 0o600 });
    }
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

  /** Whole-word / exact-key validation refusing prohibited credentials. */
  private validateField(field: { key: string; label?: string; value: string }): void {
    const normKey = (field.key || '').trim().toLowerCase();
    const normLabel = (field.label || '').trim().toLowerCase();

    // Check exact allowed list first
    if (['aadhaar_card_number', 'aadhaar_number', 'pan_card_number', 'pan_number', 'passport_number'].includes(normKey)) {
      return;
    }

    // Explicit refused exact keys
    if (REFUSED_KEYS.has(normKey)) {
      throw new Error(
        `Field '${field.key}' is prohibited from vault storage (passwords, card numbers, CVVs, OTPs, and bank account numbers cannot be stored).`
      );
    }

    // Whole-word / token inspection
    const keyTokens = normKey.split(/[^a-z0-9]+/);
    for (const token of keyTokens) {
      if (['password', 'passwd', 'cvv', 'cvc', 'otp'].includes(token)) {
        throw new Error(
          `Field '${field.key}' is prohibited from vault storage (passwords, card numbers, CVVs, OTPs, and bank account numbers cannot be stored).`
        );
      }
    }

    if (normKey === 'card_number' || normKey === 'credit_card' || normKey === 'bank_account_number') {
      throw new Error(
        `Field '${field.key}' is prohibited from vault storage (passwords, card numbers, CVVs, OTPs, and bank account numbers cannot be stored).`
      );
    }

    // Label check
    if (/^(password|passwd|cvv|cvc|otp|card number|credit card|bank account number)$/i.test(normLabel)) {
      throw new Error(
        `Field '${field.label}' is prohibited from vault storage.`
      );
    }
  }

  /** Upsert a profile record into vault. Automatically initializes vault if missing. */
  public async saveProfile(profile: ProfileRecord): Promise<void> {
    if (!this.activeDek) {
      await this.ensureVaultInitialized();
    }
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

  /** Completely erase vault file and zeroize memory. */
  public eraseAll(): void {
    this.lock();
    if (fs.existsSync(this.vaultPath)) {
      fs.unlinkSync(this.vaultPath);
    }
    const bakPath = this.vaultPath + '.bak';
    if (fs.existsSync(bakPath)) {
      fs.unlinkSync(bakPath);
    }
  }
}
