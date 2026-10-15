import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Lock,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  EDUCATION_LEVELS,
  SchemaFieldDef,
  SchemaSectionDef,
  calculateAge,
  deriveFullName,
} from '../../../electron/shared/profileSchema';
import type { VaultField } from '../../types/autofiller';

interface ProfileSectionCardProps {
  sectionDef: SchemaSectionDef;
  fields: SchemaFieldDef[];
  values: Record<string, string>;
  customFields?: VaultField[];
  errors: Record<string, string>;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onFieldChange: (key: string, value: string) => void;
  onAddCustomDetail?: () => void;
  onDeleteCustomDetail?: (key: string) => void;
}

export const ProfileSectionCard: React.FC<ProfileSectionCardProps> = ({
  sectionDef,
  fields,
  values,
  customFields = [],
  errors,
  isCollapsed,
  onToggleCollapse,
  onFieldChange,
  onAddCustomDetail,
  onDeleteCustomDetail,
}) => {
  const [showSensitive, setShowSensitive] = useState<Record<string, boolean>>({});
  const [collapsedSubLevels, setCollapsedSubLevels] = useState<Record<string, boolean>>({
    '10th': true,
    '12th': true,
    'diploma': true,
    'graduation': true,
    'post_graduation': true,
  });

  const toggleSensitive = (key: string) => {
    setShowSensitive((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleSubLevel = (subId: string) => {
    setCollapsedSubLevels((prev) => ({ ...prev, [subId]: !prev[subId] }));
  };

  // Calculate filled counts
  const totalStandardFields = fields.length;
  const filledStandardCount = fields.filter((f) => Boolean(values[f.key]?.trim())).length;
  const totalCount = sectionDef.id === 'custom' ? customFields.length : totalStandardFields;
  const filledCount =
    sectionDef.id === 'custom'
      ? customFields.filter((f) => Boolean(f.value?.trim())).length
      : filledStandardCount;

  // Derived values for Personal
  const fullName = deriveFullName(values.first_name, values.middle_name, values.last_name);
  const age = calculateAge(values.dob || '');

  // Address "Same as current"
  const isSameAddress =
    values.same_as_current_address === 'true' || values.same_as_current_address === '1';

  const renderFieldInput = (f: SchemaFieldDef, disabled: boolean = false) => {
    const val = values[f.key] || '';
    const err = errors[f.key];
    const isSensitive = Boolean(f.sensitive);
    const isMasked = isSensitive && !showSensitive[f.key];

    return (
      <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label
            htmlFor={f.key}
            style={{
              fontSize: '0.8125rem',
              fontWeight: 700,
              color: 'var(--text-secondary)',
            }}
          >
            {f.label}
            {!f.optional && <span style={{ color: '#DC2626', marginLeft: '3px' }}>*</span>}
          </label>
          {isSensitive && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  fontSize: '0.6875rem',
                  color: '#059669',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                }}
              >
                <Lock size={11} /> Never sent to AI
              </span>
              <button
                type="button"
                onClick={() => toggleSensitive(f.key)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#64748B',
                  padding: '2px',
                }}
                title={isMasked ? 'Reveal value' : 'Hide value'}
              >
                {isMasked ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
            </div>
          )}
        </div>

        {f.type === 'select' ? (
          <select
            id={f.key}
            value={val}
            disabled={disabled}
            onChange={(e) => onFieldChange(f.key, e.target.value)}
            style={{
              padding: '9px 12px',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${err ? '#DC2626' : 'var(--border-subtle)'}`,
              background: disabled ? '#F1F5F9' : 'var(--bg-app)',
              fontSize: '0.875rem',
              color: 'var(--text-primary)',
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            <option value="">Select {f.label}...</option>
            {f.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={f.key}
            type={
              isMasked
                ? 'password'
                : f.type === 'date'
                ? 'date'
                : f.type === 'tel'
                ? 'tel'
                : f.type === 'email'
                ? 'email'
                : f.type === 'number'
                ? 'number'
                : 'text'
            }
            value={val}
            disabled={disabled}
            placeholder={f.placeholder}
            onChange={(e) => onFieldChange(f.key, e.target.value)}
            style={{
              padding: '9px 12px',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${err ? '#DC2626' : 'var(--border-subtle)'}`,
              background: disabled ? '#F1F5F9' : 'var(--bg-app)',
              fontSize: '0.875rem',
              color: 'var(--text-primary)',
              cursor: disabled ? 'not-allowed' : 'text',
            }}
          />
        )}

        {err && (
          <span style={{ fontSize: '0.75rem', color: '#DC2626', fontWeight: 600 }}>
            {err}
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      {/* Section Header */}
      <div
        onClick={onToggleCollapse}
        style={{
          padding: '14px 20px',
          background: isCollapsed ? 'var(--bg-card)' : 'rgba(22, 101, 78, 0.04)',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'background 0.2s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isCollapsed ? <ChevronRight size={18} color="var(--text-brand)" /> : <ChevronDown size={18} color="var(--text-brand)" />}
          <div>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 800, color: 'var(--text-title)' }}>
              {sectionDef.title}
            </h3>
            {sectionDef.description && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                {sectionDef.description}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              fontSize: '0.75rem',
              background: filledCount === totalCount && totalCount > 0 ? '#DCFCE7' : '#F1F5F9',
              color: filledCount === totalCount && totalCount > 0 ? 'var(--text-brand)' : 'var(--text-secondary)',
              padding: '3px 10px',
              borderRadius: '12px',
              fontWeight: 700,
            }}
          >
            {filledCount} / {totalCount} filled
          </span>
        </div>
      </div>

      {/* Expanded Content */}
      {!isCollapsed && (
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* PERSONAL SECTION SPECIAL DISPLAY */}
          {sectionDef.id === 'personal' && (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: '16px',
                }}
              >
                {fields.slice(0, 3).map((f) => renderFieldInput(f))}
              </div>

              {/* Read-only Full Name banner */}
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(22, 101, 78, 0.05)',
                  border: '1px dashed #A7F3D0',
                  fontSize: '0.8125rem',
                  color: 'var(--text-title)',
                }}
              >
                <strong>Full Name:</strong>{' '}
                <span style={{ color: fullName ? 'var(--accent-primary)' : 'var(--text-muted)', fontWeight: 600 }}>
                  {fullName || 'Auto-derived when names are entered'}
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: '16px',
                }}
              >
                {fields.slice(3, 4).map((f) => renderFieldInput(f))}
              </div>

              {/* Read-only Age banner */}
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(22, 101, 78, 0.05)',
                  border: '1px dashed #A7F3D0',
                  fontSize: '0.8125rem',
                  color: 'var(--text-title)',
                }}
              >
                <strong>Age:</strong>{' '}
                <span style={{ color: age ? 'var(--accent-primary)' : 'var(--text-muted)', fontWeight: 600 }}>
                  {age ? `${age} years old (as of today)` : 'Auto-calculated from date of birth'}
                </span>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: '16px',
                }}
              >
                {fields.slice(4).map((f) => renderFieldInput(f))}
              </div>
            </>
          )}

          {/* ADDRESS SECTION SPECIAL DISPLAY */}
          {sectionDef.id === 'address' && (
            <>
              <h4 style={{ fontSize: '0.8125rem', fontWeight: 800, color: 'var(--text-brand)', textTransform: 'uppercase' }}>
                Current Residence
              </h4>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: '16px',
                }}
              >
                {fields.slice(0, 4).map((f) => renderFieldInput(f))}
              </div>

              {/* Same as current address checkbox */}
              <div
                onClick={() =>
                  onFieldChange('same_as_current_address', isSameAddress ? 'false' : 'true')
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: isSameAddress ? 'rgba(22, 101, 78, 0.08)' : 'var(--bg-app)',
                  border: `1px solid ${isSameAddress ? '#86EFAC' : 'var(--border-subtle)'}`,
                  cursor: 'pointer',
                  userSelect: 'none',
                  margin: '4px 0',
                }}
              >
                <input
                  type="checkbox"
                  checked={isSameAddress}
                  onChange={(e) =>
                    onFieldChange('same_as_current_address', e.target.checked ? 'true' : 'false')
                  }
                  style={{ cursor: 'pointer' }}
                />
                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-title)' }}>
                  Permanent address is same as current address
                </span>
              </div>

              <h4 style={{ fontSize: '0.8125rem', fontWeight: 800, color: 'var(--text-brand)', textTransform: 'uppercase', marginTop: '6px' }}>
                Permanent Residence
              </h4>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: '16px',
                  opacity: isSameAddress ? 0.6 : 1,
                }}
              >
                {fields.slice(4).map((f) => renderFieldInput(f, isSameAddress))}
              </div>
            </>
          )}

          {/* EDUCATION SECTION WITH COLLAPSIBLE LEVELS */}
          {sectionDef.id === 'education' && (
            <>
              {fields
                .filter((f) => !f.subSection)
                .map((f) => (
                  <div key={f.key} style={{ maxWidth: '480px' }}>
                    {renderFieldInput(f)}
                  </div>
                ))}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '6px' }}>
                {EDUCATION_LEVELS.map((lvl) => {
                  const levelFields = fields.filter((f) => f.subSection === lvl.id);
                  const lvlFilled = levelFields.filter((f) => Boolean(values[f.key]?.trim())).length;
                  const isSubCollapsed = Boolean(collapsedSubLevels[lvl.id]);

                  return (
                    <div
                      key={lvl.id}
                      style={{
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        onClick={() => toggleSubLevel(lvl.id)}
                        style={{
                          padding: '10px 14px',
                          background: isSubCollapsed ? 'var(--bg-app)' : 'rgba(22, 101, 78, 0.03)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {isSubCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                          <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-title)' }}>
                            {lvl.title}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '10px',
                            background: lvlFilled > 0 ? '#E2E8F0' : '#F1F5F9',
                            color: '#334155',
                          }}
                        >
                          {lvlFilled} / {levelFields.length}
                        </span>
                      </div>

                      {!isSubCollapsed && (
                        <div
                          style={{
                            padding: '16px',
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                            gap: '14px',
                            background: 'var(--bg-card)',
                          }}
                        >
                          {levelFields.map((f) => renderFieldInput(f))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* OTHER DETAILS (CUSTOM SECTION) */}
          {sectionDef.id === 'custom' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {customFields.length === 0 ? (
                <div
                  style={{
                    padding: '24px',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '0.875rem',
                    background: 'var(--bg-app)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px dashed var(--border-subtle)',
                  }}
                >
                  No custom details added yet. Click below to add extra details.
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                    gap: '12px',
                  }}
                >
                  {customFields.map((cf) => {
                    const isMasked = cf.sensitive && !showSensitive[cf.key];
                    const displayVal = isMasked
                      ? '•••• •••• ' + (cf.value.slice(-4) || '••••')
                      : cf.value;

                    return (
                      <div
                        key={cf.key}
                        style={{
                          padding: '12px 14px',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--bg-app)',
                          border: '1px solid var(--border-subtle)',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '6px',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                              {cf.label}
                            </span>
                            {cf.sensitive && (
                              <button
                                type="button"
                                onClick={() => toggleSensitive(cf.key)}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748B' }}
                              >
                                {isMasked ? <Eye size={13} /> : <EyeOff size={13} />}
                              </button>
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: '0.875rem',
                              fontWeight: 600,
                              color: 'var(--text-secondary)',
                              marginTop: '2px',
                              wordBreak: 'break-all',
                            }}
                          >
                            {displayVal}
                          </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                          <button
                            type="button"
                            onClick={() => onDeleteCustomDetail && onDeleteCustomDetail(cf.key)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#DC2626',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                            }}
                          >
                            <Trash2 size={13} /> Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {onAddCustomDetail && (
                <button
                  type="button"
                  onClick={onAddCustomDetail}
                  style={{
                    alignSelf: 'flex-start',
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px dashed var(--border-focus)',
                    background: 'rgba(22, 101, 78, 0.04)',
                    color: 'var(--text-brand)',
                    fontSize: '0.8125rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Plus size={15} />
                  Add another detail
                </button>
              )}
            </div>
          )}

          {/* STANDARD SECTIONS (Contact, Family, Current Course, ID Numbers, Bank, Professional) */}
          {sectionDef.id !== 'personal' &&
            sectionDef.id !== 'address' &&
            sectionDef.id !== 'education' &&
            sectionDef.id !== 'custom' && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: '16px',
                }}
              >
                {fields.map((f) => renderFieldInput(f))}
              </div>
            )}
        </div>
      )}
    </div>
  );
};
