import React from 'react';
import { X } from 'lucide-react';
import type { ExtractedFact } from '../../types/autofiller';

interface ImportDocumentModalProps {
  importReview: {
    facts: ExtractedFact[];
    fileName: string;
  };
  selectedImportKeys: Record<string, boolean>;
  onClose: () => void;
  onToggleKey: (key: string) => void;
  onApply: () => void;
}

export const ImportDocumentModal: React.FC<ImportDocumentModalProps> = ({
  importReview,
  selectedImportKeys,
  onClose,
  onToggleKey,
  onApply,
}) => {
  const selectedCount = Object.values(selectedImportKeys).filter(Boolean).length;

  return (
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
          maxWidth: '600px',
          width: '100%',
          maxHeight: '85vh',
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
          <div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0F2E23' }}>
              Extracted Facts from "{importReview.fileName}"
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Select which extracted facts you want to save to your active profile.
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
          {importReview.facts.map((fact) => {
            const isSelected = Boolean(selectedImportKeys[fact.key]);
            return (
              <div
                key={fact.key}
                onClick={() => onToggleKey(fact.key)}
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-md)',
                  border: `1px solid ${isSelected ? '#86EFAC' : 'var(--border-subtle)'}`,
                  background: isSelected ? '#F0FDF4' : 'var(--bg-app)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  cursor: 'pointer',
                }}
              >
                <input type="checkbox" checked={isSelected} onChange={() => {}} style={{ cursor: 'pointer' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#16654E' }}>
                    {fact.label} ({fact.key})
                  </div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px' }}>
                    {fact.value}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            {selectedCount} / {importReview.facts.length} selected
          </span>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
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
              onClick={onApply}
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
              Save Selected to Profile
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
