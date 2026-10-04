import React, { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { bridge } from '../../lib/bridge';

interface VaultLockModalProps {
  isOpen: boolean;
  mode?: 'setup' | 'unlock';
  onUnlocked: () => void;
  onResetVault: () => void;
}

export const VaultLockModal: React.FC<VaultLockModalProps> = ({
  isOpen,
  onUnlocked,
  onResetVault,
}) => {
  const [privacyKey, setPrivacyKey] = useState('');
  const [useRecoveryMode, setUseRecoveryMode] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

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
        setPrivacyKey('');
        setRecoveryInput('');
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
          maxWidth: '440px',
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
            <Lock size={22} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0F2E23' }}>
              Unlock AutoFiller Vault
            </h2>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Enter your privacy key to access your details
            </div>
          </div>
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

        <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {!useRecoveryMode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F2E23' }}>
                Privacy Key
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={privacyKey}
                  onChange={(e) => setPrivacyKey(e.target.value)}
                  placeholder="Enter your privacy key..."
                  required
                  autoFocus
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
              {useRecoveryMode ? 'Use Privacy Key' : 'Forgot key? Use recovery code'}
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
      </div>
    </div>
  );
};
