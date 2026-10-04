import React from 'react';
import { X } from 'lucide-react';
import type { VaultField } from '../../types/autofiller';

interface FieldEditModalProps {
  editingField: {
    sectionId: string;
    field: VaultField;
    isNew: boolean;
  };
  onClose: () => void;
  onSave: (e: React.FormEvent) => void;
  onChangeField: (updated: VaultField) => void;
}

export const FieldEditModal: React.FC<FieldEditModalProps> = ({
  editingField,
  onClose,
  onSave,
  onChangeField,
}) => {
  const { field, isNew } = editingField;

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
        onSubmit={onSave}
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0F2E23' }}>
            {isNew ? 'Add Field' : 'Edit Field'}
          </h3>
          <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div>
          <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Field Key (Canonical name)
          </label>
          <input
            type="text"
            value={field.key}
            disabled={!isNew}
            onChange={(e) => onChangeField({ ...field, key: e.target.value })}
            placeholder="e.g. student_name, email, phone"
            style={{
              width: '100%',
              marginTop: '6px',
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              background: isNew ? 'var(--bg-app)' : '#F1F5F9',
              fontSize: '0.875rem',
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Label (User facing)
          </label>
          <input
            type="text"
            value={field.label}
            onChange={(e) => onChangeField({ ...field, label: e.target.value })}
            placeholder="e.g. Full Name"
            style={{
              width: '100%',
              marginTop: '6px',
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-app)',
              fontSize: '0.875rem',
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            Value
          </label>
          <input
            type="text"
            value={field.value}
            onChange={(e) => onChangeField({ ...field, value: e.target.value })}
            placeholder="Enter value"
            style={{
              width: '100%',
              marginTop: '6px',
              padding: '8px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-app)',
              fontSize: '0.875rem',
            }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            type="checkbox"
            id="sensitive_check"
            checked={Boolean(field.sensitive)}
            onChange={(e) => onChangeField({ ...field, sensitive: e.target.checked })}
          />
          <label htmlFor="sensitive_check" style={{ fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}>
            Mark as sensitive / ID field (mask value on screen)
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
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
            Save Field
          </button>
        </div>
      </form>
    </div>
  );
};
