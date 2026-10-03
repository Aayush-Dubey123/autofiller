import React, { useState } from 'react';
import { AlertTriangle, Key, Lock, ShieldCheck, Sparkles, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { bridge } from '../../lib/bridge';

interface VaultLockModalProps {
  isOpen: boolean;
  mode: 'setup' | 'unlock';
  onUnlocked: () => void;
  onResetVault: () => void;
}

export const VaultLockModal: React.FC<VaultLockModalProps> = ({
  isOpen,
  mode,
  onUnlocked,
  onResetVault,
}) => {
  const [privacyKey, setPrivacyKey] = useState('');
  const [confirmKey, setConfirmKey] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [useRecoveryMode, setUseRecoveryMode] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [createdRecoveryCode, setCreatedRecoveryCode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const calculateStrength = (key: string): { label: string; color: string; percent: number } => {
    if (!key) return { label: 'Empty', color: '#CBD5E1', percent: 0 };
    if (key.length < 6) return { label: 'Weak (< 6 chars)', color: '#EF4444', percent: 25 };
    const hasNum = /\d/.test(key);
    const hasSpecial = /[^A-Za-z0-9]/.test(key);
    if (key.length >= 10 && hasNum && hasSpecial) return { label: 'Strong', color: '#10B981', percent: 100 };
    if (key.length >= 8 && (hasNum || hasSpecial)) return { label: 'Medium', color: '#F59E0B', percent: 65 };
    return { label: 'Fair', color: '#FBBF24', percent: 45 };
  };

  const strength = calculateStrength(privacyKey);

  const handleCreateVault = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (privacyKey.length < 6) {
      setErrorMsg('Privacy key must be at least 6 characters long.');
      return;
    }
    if (privacyKey !== confirmKey) {
      setErrorMsg('Privacy keys do not match.');
      return;
    }

    setIsProcessing(true);
    try {
      const res = await bridge.vaultCreate({ privacyKey, useRecoveryCode });
      if (res.success) {
        if (res.recoveryCode) {
          setCreatedRecoveryCode(res.recoveryCode);
        } else {
          onUnlocked();
        }
      } else {
        setErrorMsg(res.error || 'Failed to create vault.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Vault creation error.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsProcessing(true);

    try {
      const payload = useRecoveryMode
        ? { recoveryCode: recoveryInput.trim() }
        : { privacyKey };
      const res = await bridge.vaultUnlock(payload);
      if (res.success) {
        onUnlocked();
      } else {
        setErrorMsg(res.error || 'Incorrect key or recovery code.');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unlock error.');
    } finally {
      setIsProcessing(false);
    }
  };

  // If a recovery code was generated, display it ONCE with acknowledgment
  if (createdRecoveryCode) {
    return (
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
            maxWidth: '480px',
            width: '100%',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            padding: '28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#16654E' }}>
            <ShieldCheck size={28} />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0F2E23' }}>
              Emergency Recovery Code
            </h2>
          </div>

          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Store this recovery code in a safe place. If you forget your privacy key, this code is the <strong>only way</strong> to unlock your vault.
          </p>

          <div
            style={{
              background: '#F1F5F9',
              border: '2px dashed #94A3B8',
              borderRadius: '8px',
              padding: '16px',
              fontFamily: 'monospace',
              fontSize: '1.2rem',
              fontWeight: 800,
              color: '#0F2E23',
              textAlign: 'center',
              letterSpacing: '2px',
              userSelect: 'all',
            }}
          >
            {createdRecoveryCode}
          </div>

          <button
            onClick={() => {
              setCreatedRecoveryCode(null);
              onUnlocked();
            }}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: 'var(--radius-md)',
              background: '#16654E',
              color: '#FFFFFF',
              border: 'none',
              fontWeight: 700,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            I Have Saved My Recovery Code
          </button>
        </div>
      </div>
    );
  }

  return (
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
          maxWidth: '480px',
          width: '100%',
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 25px 60px rgba(0,0,0,0.4)',
          padding: '28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: '#D9EFE0',
              color: '#16654E',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {mode === 'setup' ? <Key size={22} /> : <Lock size={22} />}
          </div>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0F2E23' }}>
              {mode === 'setup' ? 'Set Up Your Private Vault' : 'Unlock AutoFiller Vault'}
            </h2>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              {mode === 'setup'
                ? 'AES-256-GCM Local Data Encryption'
                : 'Enter your privacy key to access your profiles'}
            </div>
          </div>
        </div>

        {/* Honest Privacy Disclosure */}
        <div
          style={{
            background: '#F8FAFC',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
            fontSize: '0.78125rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.45,
          }}
        >
          <strong>Privacy & Security Note:</strong> Your details stay encrypted on this device. AutoFiller never uploads your profile data to any server. Documents and form fields are parsed on-demand by Google Gemini AI.
        </div>

        {errorMsg && (
          <div
            style={{
              background: '#FEF2F2',
              border: '1px solid #FCA5A5',
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
              color: '#991B1B',
              fontSize: '0.8125rem',
              fontWeight: 600,
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* Form Body */}
        {mode === 'setup' ? (
          <form onSubmit={handleCreateVault} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F2E23' }}>
                Create Privacy Key *
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={privacyKey}
                  onChange={(e) => setPrivacyKey(e.target.value)}
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
                  onClick={() => setShowPassword(!showPassword)}
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
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {/* Strength bar */}
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
              <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F2E23' }}>
                Confirm Privacy Key *
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmKey}
                onChange={(e) => setConfirmKey(e.target.value)}
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

            <div
              style={{
                background: '#FFFBEB',
                border: '1px solid #FCD34D',
                borderRadius: 'var(--radius-md)',
                padding: '10px 12px',
                fontSize: '0.75rem',
                color: '#92400E',
                display: 'flex',
                gap: '8px',
                alignItems: 'flex-start',
              }}
            >
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Warning:</strong> If you forget your privacy key, stored data cannot be recovered unless an emergency recovery code is generated.
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8125rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={useRecoveryCode}
                onChange={(e) => setUseRecoveryCode(e.target.checked)}
              />
              <span>Generate an emergency recovery code (recommended)</span>
            </label>

            <button
              type="submit"
              disabled={isProcessing}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 'var(--radius-md)',
                background: '#16654E',
                color: '#FFFFFF',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.875rem',
                cursor: 'pointer',
                marginTop: '6px',
              }}
            >
              {isProcessing ? 'Creating Vault...' : 'Create Encrypted Vault'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {!useRecoveryMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F2E23' }}>
                  Privacy Key
                </label>
                <input
                  type="password"
                  value={privacyKey}
                  onChange={(e) => setPrivacyKey(e.target.value)}
                  placeholder="Enter your privacy key..."
                  required
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.875rem',
                  }}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F2E23' }}>
                  Emergency Recovery Code
                </label>
                <input
                  type="text"
                  value={recoveryInput}
                  onChange={(e) => setRecoveryInput(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX..."
                  required
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.875rem',
                    fontFamily: 'monospace',
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setUseRecoveryMode(!useRecoveryMode)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#16654E',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                {useRecoveryMode ? 'Use Privacy Key' : 'Use Recovery Code'}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (confirm('Are you sure you want to reset the vault and erase all stored profiles?')) {
                    onResetVault();
                  }
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#DC2626',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Erase & Reset Vault
              </button>
            </div>

            <button
              type="submit"
              disabled={isProcessing}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 'var(--radius-md)',
                background: '#16654E',
                color: '#FFFFFF',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.875rem',
                cursor: 'pointer',
                marginTop: '6px',
              }}
            >
              {isProcessing ? 'Unlocking...' : 'Unlock Vault'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
