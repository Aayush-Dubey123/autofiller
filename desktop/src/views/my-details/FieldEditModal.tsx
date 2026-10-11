import React, { useState } from 'react';
import { EyeOff, X } from 'lucide-react';
import type { VaultField } from '../../types/autofiller';

interface FieldEditModalProps {
  initialDetail?: {
    name: string;
    value: string;
    sensitive: boolean;
    key?: string;
  };
  onClose: () => void;
  onSave: (detail: { name: string; value: string; sensitive: boolean; key?: string }) => void;
}

export const FieldEditModal: React.FC<FieldEditModalProps> = ({
  initialDetail,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState<string>(initialDetail?.name || '');
  const [value, setValue] = useState<string>(initialDetail?.value || '');
  const [sensitive, setSensitive] = useState<boolean>(initialDetail?.sensitive || false);
  const [error, setError] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a name for this detail.');
      return;
    }
    if (!value.trim()) {
      setError('Please provide a value.');
      return;
    }
    setError('');
    onSave({
      name: name.trim(),
      value: value.trim(),
      sensitive,
      key: initialDetail?.key,
    });
  };

  return (
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
        onSubmit={handleSubmit}
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
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0F2E23' }}>
            {initialDetail ? 'Edit Detail' : 'Add Another Detail'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748B' }}
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              background: '#FEF2F2',
              color: '#DC2626',
              fontSize: '0.8125rem',
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}

        <div>
          <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            What is it called?
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError('');
            }}
            placeholder="e.g. Library Membership ID, Club Number"
            style={{
              width: '100%',
              marginTop: '6px',
              padding: '9px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-app)',
              fontSize: '0.875rem',
            }}
            autoFocus
          />
        </div>

        <div>
          <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Value
          </label>
          <input
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError('');
            }}
            placeholder="e.g. LIB-991823"
            style={{
              width: '100%',
              marginTop: '6px',
              padding: '9px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-app)',
              fontSize: '0.875rem',
            }}
          />
        </div>

        <div
          onClick={() => setSensitive(!sensitive)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 12px',
            borderRadius: 'var(--radius-md)',
            background: sensitive ? 'rgba(22, 101, 78, 0.08)' : 'var(--bg-app)',
            border: `1px solid ${sensitive ? '#86EFAC' : 'var(--border-subtle)'}`,
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={sensitive}
            onChange={(e) => setSensitive(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F2E23', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <EyeOff size={14} color="#16654E" />
              Keep hidden
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '2px' }}>
              Masked on screen and requires permission before filling.
            </div>
          </div>
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
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            style={{
              padding: '8px 20px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: '#16654E',
              color: '#FFFFFF',
              fontSize: '0.875rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {initialDetail ? 'Update Detail' : 'Add Detail'}
          </button>
        </div>
      </form>
    </div>
  );
};
