import React from 'react';
import { ChevronDown, ChevronRight, Edit2, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import type { VaultField, VaultSection } from '../../types/autofiller';

interface ProfileSectionCardProps {
  section: VaultSection;
  isCollapsed: boolean;
  showSensitive: Record<string, boolean>;
  onToggleSection: (sectionId: string) => void;
  onToggleShowSensitive: (fieldKey: string) => void;
  onAddField: (sectionId: string) => void;
  onEditField: (sectionId: string, field: VaultField) => void;
  onDeleteField: (sectionId: string, fieldKey: string) => void;
}

export const ProfileSectionCard: React.FC<ProfileSectionCardProps> = ({
  section,
  isCollapsed,
  showSensitive,
  onToggleSection,
  onToggleShowSensitive,
  onAddField,
  onEditField,
  onDeleteField,
}) => {
  const filledCount = section.fields.filter((f) => Boolean(f.value)).length;

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
      }}
    >
      {/* Header */}
      <div
        onClick={() => onToggleSection(section.id)}
        style={{
          padding: '16px 20px',
          background: 'rgba(22, 101, 78, 0.04)',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isCollapsed ? <ChevronRight size={18} color="#16654E" /> : <ChevronDown size={18} color="#16654E" />}
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F2E23' }}>{section.title}</h3>
          <span
            style={{
              fontSize: '0.75rem',
              background: '#E2E8F0',
              color: '#475569',
              padding: '2px 8px',
              borderRadius: '12px',
              fontWeight: 600,
            }}
          >
            {filledCount} / {section.fields.length} filled
          </span>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddField(section.id);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#16654E',
            fontSize: '0.8125rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            cursor: 'pointer',
          }}
        >
          <Plus size={14} />
          <span>Add Field</span>
        </button>
      </div>

      {/* Grid */}
      {!isCollapsed && (
        <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {section.fields.map((field) => {
            const isSensitive = section.id === 'id_numbers' || Boolean(field.sensitive);
            const isVisible = Boolean(showSensitive[field.key]);
            const displayVal = isSensitive && !isVisible && field.value
              ? '•••• •••• ' + field.value.slice(-4)
              : field.value;

            return (
              <div
                key={field.key}
                style={{
                  padding: '12px 14px',
                  background: 'var(--bg-app)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      {field.label}
                    </span>
                    {isSensitive && (
                      <button
                        onClick={() => onToggleShowSensitive(field.key)}
                        title={isVisible ? 'Hide sensitive value' : 'Show sensitive value'}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748B' }}
                      >
                        {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    )}
                  </div>

                  <div
                    style={{
                      fontSize: '0.9375rem',
                      fontWeight: field.value ? 600 : 400,
                      color: field.value ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontStyle: field.value ? 'normal' : 'italic',
                      marginTop: '4px',
                      wordBreak: 'break-all',
                    }}
                  >
                    {displayVal || 'Not filled'}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: '6px' }}>
                  <button
                    onClick={() => onEditField(section.id, field)}
                    style={{ background: 'transparent', border: 'none', color: '#16654E', cursor: 'pointer', padding: '2px' }}
                    title="Edit field"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={() => onDeleteField(section.id, field.key)}
                    style={{ background: 'transparent', border: 'none', color: '#DC2626', cursor: 'pointer', padding: '2px' }}
                    title="Delete field"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
