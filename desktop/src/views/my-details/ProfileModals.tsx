import React, { useState } from 'react';
import { Check, EyeOff, Info, X } from 'lucide-react';
import type { ExtractedFact, VaultField } from '../../types/autofiller';
import { SCHEMA_FIELD_MAP } from '../../../electron/shared/profileSchema';

/* ========================================================================= */
/* 1. FieldEditModal Component                                              */
/* ========================================================================= */

export interface FieldEditModalProps {
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
          <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--text-title)' }}>
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
            <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-title)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <EyeOff size={14} color="var(--text-brand)" />
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
              background: 'var(--status-success)',
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

/* ========================================================================= */
/* 2. ImportDocumentModal Component                                         */
/* ========================================================================= */

export interface ImportDocumentModalProps {
  importReview: {
    facts: ExtractedFact[];
    fileName: string;
  };
  selectedImportKeys: Record<string, boolean>;
  existingValues: Record<string, string>;
  onClose: () => void;
  onToggleKey: (key: string) => void;
  onApply: () => void;
}

export const ImportDocumentModal: React.FC<ImportDocumentModalProps> = ({
  importReview,
  selectedImportKeys,
  existingValues,
  onClose,
  onToggleKey,
  onApply,
}) => {
  const selectedCount = Object.values(selectedImportKeys).filter(Boolean).length;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-doc-title"
      style={{
        zIndex: 9999,
        padding: '20px',
      }}
    >
      <div
        style={{
          maxWidth: '620px',
          width: '100%',
          maxHeight: '85vh',
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 id="import-doc-title" style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--text-title)' }}>
              Import Details from "{importReview.fileName}"
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Reviewed information extracted from your document. Select which details to add to your profile.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748B' }}
          >
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(22, 101, 78, 0.05)',
            border: '1px solid var(--badge-green-border)',
            fontSize: '0.75rem',
            color: 'var(--text-brand)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Info size={16} />
          <span>Only empty fields will be filled. Unmatched items will be placed under Other Details.</span>
        </div>

        <div
          style={{
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            paddingRight: '4px',
          }}
        >
          {importReview.facts.map((fact) => {
            const isSelected = Boolean(selectedImportKeys[fact.key]);
            const schemaField = SCHEMA_FIELD_MAP.get(fact.key);
            const destinationName = schemaField ? schemaField.label : 'Other Details';
            const isAlreadyFilled = Boolean(existingValues[fact.key]?.trim());

            return (
              <div
                key={fact.key}
                onClick={() => onToggleKey(fact.key)}
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${isSelected ? '#86EFAC' : 'var(--border-subtle)'}`,
                  background: isSelected ? '#F0FDF4' : 'var(--bg-app)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  opacity: isAlreadyFilled ? 0.7 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {}}
                  style={{ cursor: 'pointer' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-title)' }}>
                      {fact.label}
                    </div>
                    <span
                      style={{
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: '10px',
                        background: isAlreadyFilled ? '#FEF3C7' : '#E2E8F0',
                        color: isAlreadyFilled ? '#92400E' : '#334155',
                      }}
                    >
                      {isAlreadyFilled ? 'Already set' : `Maps to ${destinationName}`}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-brand)', marginTop: '3px' }}>
                    {fact.value}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: '16px',
          }}
        >
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            {selectedCount} of {importReview.facts.length} selected
          </span>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
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
              onClick={onApply}
              disabled={selectedCount === 0}
              style={{
                padding: '8px 20px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: selectedCount > 0 ? 'var(--accent-primary)' : 'var(--text-muted)',
                color: '#FFFFFF',
                fontSize: '0.875rem',
                fontWeight: 700,
                cursor: selectedCount > 0 ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Check size={16} />
              Import Selected
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
