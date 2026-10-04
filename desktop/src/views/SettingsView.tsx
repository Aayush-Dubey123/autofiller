import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  Key,
  Lock,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Trash2,
} from 'lucide-react';
import { bridge } from '../lib/bridge';
import type { VaultStatus } from '../types/autofiller';

interface SettingsViewProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onLockVault?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  theme,
  onToggleTheme,
  onLockVault,
}) => {
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>({
    exists: false,
    unlocked: true,
    hasOsSlot: true,
    hasPassphraseSlot: false,
    hasRecoverySlot: false,
    recoveryAvailable: false,
  });

  const [version, setVersion] = useState<string>('v1.0.0');
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Extra protection wizard state
  const [showWizard, setShowWizard] = useState<boolean>(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [passphrase, setPassphrase] = useState<string>('');
  const [confirmPassphrase, setConfirmPassphrase] = useState<string>('');
  const [wantRecovery, setWantRecovery] = useState<boolean>(true);
  const [showPass, setShowPass] = useState<boolean>(false);
  const [createdRecoveryCode, setCreatedRecoveryCode] = useState<string | null>(null);
  const [savedCheck, setSavedCheck] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Change key modal
  const [showChangeModal, setShowChangeModal] = useState<boolean>(false);
  const [currentKeyInput, setCurrentKeyInput] = useState<string>('');
  const [newKeyInput, setNewKeyInput] = useState<string>('');
  const [confirmNewKeyInput, setConfirmNewKeyInput] = useState<string>('');

  // Disable extra protection modal
  const [showDisableModal, setShowDisableModal] = useState<boolean>(false);
  const [disableKeyInput, setDisableKeyInput] = useState<string>('');

  // Erase all data confirmation modal
  const [showEraseModal, setShowEraseModal] = useState<boolean>(false);

  useEffect(() => {
    loadStatus();
    bridge.appVersion().then((v) => setVersion(v || '1.0.0'));
  }, []);

  const loadStatus = async () => {
    try {
      const st = await bridge.vaultStatus();
      setVaultStatus(st);
    } catch (err) {
      console.error('Failed to load vault status', err);
    }
  };

  const calculateStrength = (key: string) => {
    if (!key) return { label: 'Empty', color: '#CBD5E1', percent: 0 };
    if (key.length < 10) return { label: 'Weak (< 10 chars)', color: '#EF4444', percent: 25 };
    const hasNum = /\d/.test(key);
    const hasSpecial = /[^A-Za-z0-9]/.test(key);
    if (key.length >= 14 && hasNum && hasSpecial) return { label: 'Strong', color: '#10B981', percent: 100 };
    if (key.length >= 10 && (hasNum || hasSpecial)) return { label: 'Medium', color: '#F59E0B', percent: 65 };
    return { label: 'Fair', color: '#FBBF24', percent: 45 };
  };

  const strength = calculateStrength(passphrase);

  const handleStartWizard = () => {
    setShowWizard(true);
    setWizardStep(1);
    setPassphrase('');
    setConfirmPassphrase('');
    setWantRecovery(true);
    setCreatedRecoveryCode(null);
    setSavedCheck(false);
    setStatusMsg(null);
  };

  const handleWizardStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    if (passphrase.length < 10) {
      setStatusMsg({ type: 'error', text: 'Privacy key must be at least 10 characters long.' });
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setStatusMsg({ type: 'error', text: 'Privacy keys do not match.' });
      return;
    }

    setIsProcessing(true);
    try {
      const res = await bridge.vaultEnableExtra({
        privacyKey: passphrase,
        wantRecovery,
      });

      if (res.success) {
        await loadStatus();
        if (res.recoveryCode) {
          setCreatedRecoveryCode(res.recoveryCode);
          setWizardStep(3);
        } else {
          setShowWizard(false);
          setStatusMsg({ type: 'success', text: 'Extra protection turned on successfully!' });
        }
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Failed to turn on extra protection.' });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Error setting up extra protection.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCopyRecoveryCode = () => {
    if (createdRecoveryCode) {
      void navigator.clipboard.writeText(createdRecoveryCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 3000);
    }
  };

  const handleSaveRecoveryFile = () => {
    if (!createdRecoveryCode) return;
    const element = document.createElement('a');
    const file = new Blob([`AutoFiller AI Recovery Code:\n\n${createdRecoveryCode}\n\nKeep this code safe.`], {
      type: 'text/plain',
    });
    element.href = URL.createObjectURL(file);
    element.download = 'autofiller-recovery-code.txt';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleFinishWizard = () => {
    setShowWizard(false);
    setStatusMsg({ type: 'success', text: 'Extra protection activated. Vault locked with your key.' });
  };

  const handleChangeKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    if (newKeyInput.length < 10) {
      setStatusMsg({ type: 'error', text: 'New privacy key must be at least 10 characters long.' });
      return;
    }
    if (newKeyInput !== confirmNewKeyInput) {
      setStatusMsg({ type: 'error', text: 'New privacy keys do not match.' });
      return;
    }

    setIsProcessing(true);
    try {
      const res = await bridge.vaultChangeKey({
        currentPrivacyKey: currentKeyInput,
        newPrivacyKey: newKeyInput,
      });
      if (res.success) {
        setShowChangeModal(false);
        setCurrentKeyInput('');
        setNewKeyInput('');
        setConfirmNewKeyInput('');
        setStatusMsg({ type: 'success', text: 'Privacy key updated successfully.' });
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Failed to change key.' });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Error changing privacy key.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDisableExtra = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    setIsProcessing(true);

    try {
      const res = await bridge.vaultDisableExtra({ privacyKey: disableKeyInput });
      if (res.success) {
        await loadStatus();
        setShowDisableModal(false);
        setDisableKeyInput('');
        setStatusMsg({ type: 'success', text: 'Extra protection turned off. Vault is now in Standard protection mode.' });
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Incorrect privacy key.' });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Error disabling extra protection.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLockNow = async () => {
    await bridge.vaultLock();
    await loadStatus();
    if (onLockVault) onLockVault();
  };

  const handleEraseAllData = async () => {
    setIsProcessing(true);
    try {
      await bridge.eraseAllData();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Erase all data failed.' });
      setIsProcessing(false);
      setShowEraseModal(false);
    }
  };

  const isExtraProtectionOn = Boolean(vaultStatus.hasPassphraseSlot);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', maxWidth: '840px', margin: '0 auto' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F2E23' }}>Settings</h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Manage your privacy protection, app settings, and stored data.
        </p>
      </div>

      {statusMsg && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            background: statusMsg.type === 'success' ? '#F0FDF4' : '#FEF2F2',
            border: `1px solid ${statusMsg.type === 'success' ? '#86EFAC' : '#FCA5A5'}`,
            color: statusMsg.type === 'success' ? '#16654E' : '#991B1B',
            fontSize: '0.875rem',
            fontWeight: 600,
          }}
        >
          {statusMsg.text}
        </div>
      )}

      {/* 1. Privacy & Security */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: isExtraProtectionOn ? '#D1FAE5' : '#E2E8F0',
                color: isExtraProtectionOn ? '#065F46' : '#334155',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isExtraProtectionOn ? <ShieldCheck size={20} /> : <Lock size={20} />}
            </div>
            <div>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0F2E23' }}>Privacy & Security</h2>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Local AES-256-GCM Vault Encryption
              </div>
            </div>
          </div>

          <span
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              fontSize: '0.8125rem',
              fontWeight: 700,
              background: isExtraProtectionOn ? '#10B981' : '#64748B',
              color: '#FFFFFF',
            }}
          >
            {isExtraProtectionOn ? 'Extra protection on' : 'Standard protection'}
          </span>
        </div>

        {/* Explanation text */}
        <div
          style={{
            background: 'var(--bg-app)',
            borderRadius: 'var(--radius-md)',
            padding: '16px',
            border: '1px solid var(--border-subtle)',
            fontSize: '0.84375rem',
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {isExtraProtectionOn ? (
            <div>
              <strong>Extra Protection Mode:</strong> Your details are encrypted with your private passphrase. Passphrase is required whenever the app launches or locks.
            </div>
          ) : (
            <div>
              <strong>Standard Protection Mode:</strong> Details are encrypted locally using your Windows account security. Anyone signed in to this Windows account can open the app in Standard mode.
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '8px', fontSize: '0.78125rem', color: 'var(--text-muted)' }}>
            Your details are stored encrypted on this device. When you fill a form, the values needed to match its fields are sent to Google Gemini for processing.
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {!isExtraProtectionOn ? (
            <button
              onClick={handleStartWizard}
              style={{
                padding: '10px 20px',
                borderRadius: 'var(--radius-md)',
                background: '#16654E',
                color: '#FFFFFF',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.875rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Key size={16} />
              <span>Turn on Extra Protection</span>
            </button>
          ) : (
            <>
              <button
                onClick={() => setShowChangeModal(true)}
                style={{
                  padding: '10px 18px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-app)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                Change Privacy Key
              </button>

              <button
                onClick={() => setShowDisableModal(true)}
                style={{
                  padding: '10px 18px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-app)',
                  border: '1px solid var(--border-subtle)',
                  color: '#DC2626',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                }}
              >
                Turn off Extra Protection
              </button>

              {onLockVault && (
                <button
                  onClick={handleLockNow}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 'var(--radius-md)',
                    background: '#0F2E23',
                    color: '#FFFFFF',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Lock size={16} />
                  <span>Lock Now</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 2. Your Data */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <h2 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0F2E23' }}>Your Data</h2>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Clear all profiles, history records, logs, and backend session data from this device.
        </p>

        <div>
          <button
            onClick={() => setShowEraseModal(true)}
            style={{
              padding: '10px 18px',
              borderRadius: 'var(--radius-md)',
              background: '#FEF2F2',
              border: '1px solid #FCA5A5',
              color: '#DC2626',
              fontWeight: 700,
              fontSize: '0.875rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Trash2 size={16} />
            <span>Erase All My Data</span>
          </button>
        </div>
      </div>

      {/* 3. Appearance */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <h2 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0F2E23' }}>Appearance</h2>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--text-primary)' }}>App Theme</div>
            <div style={{ fontSize: '0.78125rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Switch between Light and Dark mode
            </div>
          </div>

          <button
            onClick={onToggleTheme}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-app)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              fontWeight: 700,
              fontSize: '0.875rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {theme === 'light' ? <Sun size={16} /> : <Moon size={16} />}
            <span>{theme === 'light' ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
        </div>
      </div>

      {/* 4. About */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <h2 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0F2E23' }}>About AutoFiller AI</h2>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          Version: <strong>{version}</strong>
        </div>
        <p style={{ fontSize: '0.8125rem', color: '#16654E', fontWeight: 700, marginTop: '4px' }}>
          AutoFiller never submits forms. You review and submit.
        </p>
      </div>

      {/* WIZARD MODAL: 3-Step Turn On Extra Protection */}
      {showWizard && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 8, 16, 0.85)',
            backdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            style={{
              maxWidth: '520px',
              width: '100%',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
              padding: '28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
            }}
          >
            {/* Steps indicator */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '14px' }}>
              <div style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0F2E23' }}>
                Setup Extra Protection ({wizardStep}/3)
              </div>
              <button onClick={() => setShowWizard(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                Cancel
              </button>
            </div>

            {/* STEP 1 */}
            {wizardStep === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F2E23' }}>Step 1: Why a privacy key?</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  A privacy key adds a master passphrase to your vault. Without this passphrase, nobody can open or read your stored details — even if someone accesses your computer.
                </p>

                <div
                  style={{
                    background: '#FFFBEB',
                    border: '1px solid #FCD34D',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 14px',
                    fontSize: '0.8125rem',
                    color: '#92400E',
                    display: 'flex',
                    gap: '10px',
                  }}
                >
                  <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <strong>Important:</strong> If you forget your privacy key, your data cannot be unlocked unless you generate and keep an emergency recovery code.
                  </div>
                </div>

                <button
                  onClick={() => setWizardStep(2)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    background: '#16654E',
                    color: '#FFFFFF',
                    border: 'none',
                    fontWeight: 700,
                    cursor: 'pointer',
                    marginTop: '8px',
                  }}
                >
                  Continue to Choose Key
                </button>
              </div>
            )}

            {/* STEP 2 */}
            {wizardStep === 2 && (
              <form onSubmit={handleWizardStep2Submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F2E23' }}>Step 2: Choose Privacy Key</h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Privacy Key (minimum 10 characters) *
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Enter a strong privacy key..."
                      required
                      style={{
                        width: '100%',
                        padding: '10px 38px 10px 12px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '0.875rem',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>

                  {/* Strength Bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                    <div style={{ flex: 1, height: '4px', background: '#E2E8F0', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${strength.percent}%`, height: '100%', background: strength.color, transition: 'all 0.3s' }} />
                    </div>
                    <span style={{ fontSize: '0.725rem', fontWeight: 700, color: strength.color }}>
                      {strength.label}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Confirm Privacy Key *
                  </label>
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={confirmPassphrase}
                    onChange={(e) => setConfirmPassphrase(e.target.value)}
                    placeholder="Re-enter privacy key..."
                    required
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8125rem', cursor: 'pointer', marginTop: '4px' }}>
                  <input
                    type="checkbox"
                    checked={wantRecovery}
                    onChange={(e) => setWantRecovery(e.target.checked)}
                  />
                  <span>Generate an emergency recovery code (recommended)</span>
                </label>

                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setWizardStep(1)}
                    style={{
                      padding: '10px 16px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      background: 'transparent',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Back
                  </button>

                  <button
                    type="submit"
                    disabled={isProcessing}
                    style={{
                      flex: 1,
                      padding: '10px 16px',
                      borderRadius: 'var(--radius-md)',
                      background: '#16654E',
                      color: '#FFFFFF',
                      border: 'none',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {isProcessing ? 'Enabling...' : 'Activate Extra Protection'}
                  </button>
                </div>
              </form>
            )}

            {/* STEP 3 */}
            {wizardStep === 3 && createdRecoveryCode && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#16654E' }}>
                  <ShieldCheck size={26} />
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0F2E23' }}>
                    Step 3: Save Your Recovery Code
                  </h3>
                </div>

                <p style={{ fontSize: '0.84375rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  This emergency recovery code is the <strong>only way</strong> to unlock your vault if you forget your privacy key. NO timers or auto-close will dismiss this.
                </p>

                <div
                  style={{
                    background: '#F1F5F9',
                    border: '2px dashed #94A3B8',
                    borderRadius: '8px',
                    padding: '16px',
                    fontFamily: 'monospace',
                    fontSize: '1.25rem',
                    fontWeight: 800,
                    color: '#0F2E23',
                    textAlign: 'center',
                    letterSpacing: '2px',
                    userSelect: 'all',
                  }}
                >
                  {createdRecoveryCode}
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={handleCopyRecoveryCode}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-app)',
                      fontWeight: 600,
                      fontSize: '0.8125rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    {copiedCode ? <Check size={14} color="#16654E" /> : <Copy size={14} />}
                    <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveRecoveryFile}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-app)',
                      fontWeight: 600,
                      fontSize: '0.8125rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <Download size={14} />
                    <span>Save as File</span>
                  </button>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8125rem', cursor: 'pointer', marginTop: '6px' }}>
                  <input
                    type="checkbox"
                    checked={savedCheck}
                    onChange={(e) => setSavedCheck(e.target.checked)}
                  />
                  <strong>I have saved my recovery code in a safe place</strong>
                </label>

                <button
                  onClick={handleFinishWizard}
                  disabled={!savedCheck}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    background: savedCheck ? '#16654E' : '#94A3B8',
                    color: '#FFFFFF',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '0.875rem',
                    cursor: savedCheck ? 'pointer' : 'not-allowed',
                    marginTop: '6px',
                  }}
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CHANGE PRIVACY KEY MODAL */}
      {showChangeModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <form
            onSubmit={handleChangeKey}
            style={{
              maxWidth: '440px',
              width: '100%',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0F2E23' }}>Change Privacy Key</h3>

            <div>
              <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                Current Privacy Key *
              </label>
              <input
                type="password"
                value={currentKeyInput}
                onChange={(e) => setCurrentKeyInput(e.target.value)}
                required
                style={{
                  width: '100%',
                  marginTop: '6px',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                New Privacy Key (minimum 10 chars) *
              </label>
              <input
                type="password"
                value={newKeyInput}
                onChange={(e) => setNewKeyInput(e.target.value)}
                required
                style={{
                  width: '100%',
                  marginTop: '6px',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                Confirm New Privacy Key *
              </label>
              <input
                type="password"
                value={confirmNewKeyInput}
                onChange={(e) => setConfirmNewKeyInput(e.target.value)}
                required
                style={{
                  width: '100%',
                  marginTop: '6px',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setShowChangeModal(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isProcessing}
                style={{
                  padding: '8px 20px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: '#16654E',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Update Key
              </button>
            </div>
          </form>
        </div>
      )}

      {/* DISABLE EXTRA PROTECTION MODAL */}
      {showDisableModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <form
            onSubmit={handleDisableExtra}
            style={{
              maxWidth: '440px',
              width: '100%',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0F2E23' }}>Turn off Extra Protection</h3>
            <p style={{ fontSize: '0.84375rem', color: 'var(--text-secondary)' }}>
              Enter your current privacy key to revert to Standard protection mode.
            </p>

            <div>
              <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                Current Privacy Key *
              </label>
              <input
                type="password"
                value={disableKeyInput}
                onChange={(e) => setDisableKeyInput(e.target.value)}
                required
                style={{
                  width: '100%',
                  marginTop: '6px',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                }}
                autoFocus
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setShowDisableModal(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isProcessing}
                style={{
                  padding: '8px 20px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: '#DC2626',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Turn off Extra Protection
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ERASE ALL DATA CONFIRMATION MODAL */}
      {showEraseModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            style={{
              maxWidth: '440px',
              width: '100%',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#DC2626' }}>
              <AlertTriangle size={24} />
              <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#991B1B' }}>Erase All Data?</h3>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              This will permanently delete all stored profiles, details, session history, logs, and backend state from your machine. This action cannot be undone.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setShowEraseModal(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEraseAllData}
                disabled={isProcessing}
                style={{
                  padding: '8px 20px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: '#DC2626',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {isProcessing ? 'Erasing...' : 'Yes, Erase Everything'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
