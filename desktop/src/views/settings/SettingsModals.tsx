import React from 'react';
import { AlertTriangle } from 'lucide-react';
export { VaultWizardModal } from './VaultWizardModal';

/* ========================================================================= */
/* 1. ChangeKeyModal Component                                              */
/* ========================================================================= */

export interface ChangeKeyModalProps {
  isOpen: boolean;
  currentKeyInput: string;
  setCurrentKeyInput: (val: string) => void;
  newKeyInput: string;
  setNewKeyInput: (val: string) => void;
  confirmNewKeyInput: string;
  setConfirmNewKeyInput: (val: string) => void;
  isProcessing: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const ChangeKeyModal: React.FC<ChangeKeyModalProps> = ({
  isOpen,
  currentKeyInput,
  setCurrentKeyInput,
  newKeyInput,
  setNewKeyInput,
  confirmNewKeyInput,
  setConfirmNewKeyInput,
  isProcessing,
  onClose,
  onSubmit,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-key-title"
      style={{
        zIndex: 9999,
        padding: '20px',
      }}
    >
      <form
        onSubmit={onSubmit}
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
        <h3 id="change-key-title" style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--text-title)' }}>Change Privacy Key</h3>

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
            onClick={onClose}
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
              background: 'var(--status-success)',
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
  );
};

/* ========================================================================= */
/* 2. DisableProtectionModal Component                                      */
/* ========================================================================= */

export interface DisableProtectionModalProps {
  isOpen: boolean;
  disableKeyInput: string;
  setDisableKeyInput: (val: string) => void;
  isProcessing: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const DisableProtectionModal: React.FC<DisableProtectionModalProps> = ({
  isOpen,
  disableKeyInput,
  setDisableKeyInput,
  isProcessing,
  onClose,
  onSubmit,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disable-protection-title"
      style={{
        zIndex: 9999,
        padding: '20px',
      }}
    >
      <form
        onSubmit={onSubmit}
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
        <h3 id="disable-protection-title" style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--text-title)' }}>Turn off Extra Protection</h3>
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
            onClick={onClose}
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
  );
};

/* ========================================================================= */
/* 3. EraseDataModal Component                                              */
/* ========================================================================= */

export interface EraseDataModalProps {
  isOpen: boolean;
  isProcessing: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const EraseDataModal: React.FC<EraseDataModalProps> = ({
  isOpen,
  isProcessing,
  onClose,
  onConfirm,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="erase-data-title"
      style={{
        zIndex: 9999,
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
          <h3 id="erase-data-title" style={{ fontSize: '1.125rem', fontWeight: 800, color: '#991B1B' }}>Erase All Data?</h3>
        </div>

        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          This will permanently delete all stored profiles, details, session history, logs, and backend state from your machine. This action cannot be undone.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <button
            type="button"
            onClick={onClose}
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
            onClick={onConfirm}
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
  );
};
