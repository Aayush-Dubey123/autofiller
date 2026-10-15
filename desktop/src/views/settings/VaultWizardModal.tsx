import React, { useState } from 'react';
import { AlertTriangle, Check, Copy, Download, Eye, EyeOff } from 'lucide-react';
import { bridge } from '../../lib/bridge';

interface VaultWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (error: string) => void;
  onReloadStatus: () => Promise<void>;
}

export const VaultWizardModal: React.FC<VaultWizardModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onError,
  onReloadStatus,
}) => {
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [passphrase, setPassphrase] = useState<string>('');
  const [confirmPassphrase, setConfirmPassphrase] = useState<string>('');
  const [wantRecovery, setWantRecovery] = useState<boolean>(true);
  const [showPass, setShowPass] = useState<boolean>(false);
  const [createdRecoveryCode, setCreatedRecoveryCode] = useState<string | null>(null);
  const [savedCheck, setSavedCheck] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  if (!isOpen) return null;

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

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passphrase.length < 10) {
      onError('Privacy key must be at least 10 characters long.');
      return;
    }
    if (passphrase !== confirmPassphrase) {
      onError('Privacy keys do not match.');
      return;
    }

    setIsProcessing(true);
    try {
      const res = await bridge.vaultEnableExtra({
        privacyKey: passphrase,
        wantRecovery,
      });

      if (res.success) {
        await onReloadStatus();
        if (res.recoveryCode) {
          setCreatedRecoveryCode(res.recoveryCode);
          setWizardStep(3);
        } else {
          onClose();
          onSuccess('Extra protection turned on successfully!');
        }
      } else {
        onError(res.error || 'Failed to turn on extra protection.');
      }
    } catch (err: any) {
      onError(err?.message || 'Error setting up extra protection.');
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
    onClose();
    onSuccess('Extra protection activated. Vault locked with your key.');
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vault-wizard-title"
      style={{
        zIndex: 9999,
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
          <div id="vault-wizard-title" style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--text-title)' }}>
            Setup Extra Protection ({wizardStep}/3)
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            Cancel
          </button>
        </div>

        {/* STEP 1 */}
        {wizardStep === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-title)' }}>Step 1: Why a privacy key?</h3>
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
                background: 'var(--status-success)',
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
          <form onSubmit={handleStep2Submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-title)' }}>Step 2: Choose Privacy Key</h3>

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
                  padding: '10px 20px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: 'var(--status-success)',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  cursor: isProcessing ? 'wait' : 'pointer',
                }}
              >
                {isProcessing ? 'Turning On...' : 'Turn On Extra Protection'}
              </button>
            </div>
          </form>
        )}

        {/* STEP 3 */}
        {wizardStep === 3 && createdRecoveryCode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-title)' }}>Step 3: Save Recovery Code</h3>
            <p style={{ fontSize: '0.84375rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              This is your <strong>only chance</strong> to view and save your emergency recovery code. If you forget your privacy key, this code is the only way to recover your data.
            </p>

            <div
              style={{
                background: 'var(--bg-app)',
                border: '1px dashed var(--border-focus)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.9375rem',
                fontWeight: 700,
                color: 'var(--text-title)',
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
                {copiedCode ? <Check size={14} color="var(--text-brand)" /> : <Copy size={14} />}
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
                background: savedCheck ? 'var(--accent-primary)' : 'var(--text-muted)',
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
  );
};
