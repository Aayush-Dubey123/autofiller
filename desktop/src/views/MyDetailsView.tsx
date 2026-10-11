import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileUp,
  Loader2,
  Plus,
  RotateCw,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { bridge } from '../lib/bridge';
import type {
  DocumentExtractionStage,
  ExtractedFact,
  ProfileRecord,
  VaultField,
  VaultSection,
} from '../types/autofiller';
import {
  PROFILE_FIELDS,
  PROFILE_SECTIONS,
  SCHEMA_FIELD_MAP,
  SchemaFieldDef,
  SchemaSectionDef,
  deriveFacts,
  generateCustomKey,
  validateFieldValue,
} from '../../electron/shared/profileSchema';
import { FieldEditModal } from './my-details/FieldEditModal';
import { ImportDocumentModal } from './my-details/ImportDocumentModal';
import { ProfileSectionCard } from './my-details/ProfileSectionCard';

interface MyDetailsViewProps {
  onProfileSaved?: () => void;
}

export const MyDetailsView: React.FC<MyDetailsViewProps> = ({ onProfileSaved }) => {
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState<VaultField[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Section collapse state: First run has only 'personal' expanded
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
    personal: false,
    contact: true,
    address: true,
    family: true,
    education: true,
    current_course: true,
    id_numbers: true,
    bank: true,
    professional: true,
    custom: true,
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [showAddCustomModal, setShowAddCustomModal] = useState<boolean>(false);
  const [showNewProfileModal, setShowNewProfileModal] = useState<boolean>(false);
  const [newProfileName, setNewProfileName] = useState<string>('');

  const [importReview, setImportReview] = useState<{ facts: ExtractedFact[]; fileName: string } | null>(null);
  const [selectedImportKeys, setSelectedImportKeys] = useState<Record<string, boolean>>({});

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialLoadRef = useRef<boolean>(true);

  useEffect(() => {
    loadProfiles();
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const loadProfiles = async () => {
    setIsLoading(true);
    try {
      const list = await bridge.vaultGetProfiles();
      if (list.length === 0) {
        const defaultProf: ProfileRecord = {
          id: `prof_${Date.now()}`,
          name: 'Primary Profile',
          sections: buildVaultSections({}, []),
        };
        await bridge.vaultSaveProfile(defaultProf);
        setProfiles([defaultProf]);
        setActiveProfileId(defaultProf.id);
        extractProfileData(defaultProf);
      } else {
        setProfiles(list);
        const active = list.find((p) => p.id === activeProfileId) || list[0];
        setActiveProfileId(active.id);
        extractProfileData(active);
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'Failed to load profile data.' });
    } finally {
      setIsLoading(false);
      isInitialLoadRef.current = false;
    }
  };

  const extractProfileData = (profile: ProfileRecord) => {
    const rawMap: Record<string, string> = {};
    const customs: VaultField[] = [];

    (profile.sections || []).forEach((sec) => {
      (sec.fields || []).forEach((f) => {
        if (!f.key) return;
        const normKey = f.key.trim().toLowerCase();
        if (SCHEMA_FIELD_MAP.has(normKey)) {
          rawMap[normKey] = f.value || '';
        } else {
          // Backward compatibility mappings
          if (normKey === 'student_name' && !rawMap.first_name) {
            rawMap.student_name = f.value || '';
            const parts = (f.value || '').trim().split(/\s+/);
            if (parts.length > 0) rawMap.first_name = parts[0];
            if (parts.length > 1) rawMap.last_name = parts.slice(1).join(' ');
          } else if (normKey === 'parent_name' && !rawMap.father_name) {
            rawMap.father_name = f.value || '';
          } else if (normKey === 'zip_code' && !rawMap.pincode) {
            rawMap.pincode = f.value || '';
          } else {
            customs.push({
              key: normKey,
              label: f.label || normKey,
              value: f.value || '',
              sensitive: Boolean(f.sensitive),
            });
          }
        }
      });
    });

    setValues(rawMap);
    setCustomFields(customs);
    setErrors({});
  };

  /**
   * Helper to structure flat values & customs into the required VaultSection[] array.
   */
  const buildVaultSections = (
    fieldValues: Record<string, string>,
    customList: VaultField[]
  ): VaultSection[] => {
    // Derive facts (full name, age, address, permanent copies)
    const derived = deriveFacts(fieldValues);

    const sections: VaultSection[] = PROFILE_SECTIONS.map((secDef) => {
      if (secDef.id === 'custom') {
        return {
          id: 'custom',
          title: secDef.title,
          fields: customList.map((cf) => ({
            key: cf.key,
            label: cf.label,
            value: cf.value,
            sensitive: Boolean(cf.sensitive),
          })),
        };
      }

      const secFields = PROFILE_FIELDS.filter((f) => f.section === secDef.id).map((f) => {
        const val = derived[f.key] !== undefined ? derived[f.key] : (fieldValues[f.key] || '');
        return {
          key: f.key,
          label: f.label,
          value: val,
          sensitive: Boolean(f.sensitive),
        };
      });

      // Supplement canonical student_name into personal section
      if (secDef.id === 'personal' && derived.student_name) {
        secFields.push({
          key: 'student_name',
          label: 'Student Full Name',
          value: derived.student_name,
          sensitive: false,
        });
      }

      return {
        id: secDef.id,
        title: secDef.title,
        fields: secFields,
      };
    });

    return sections;
  };

  /**
   * Debounced autosave (~800ms) with validation guard.
   */
  const scheduleAutosave = (
    newValues: Record<string, string>,
    newCustoms: VaultField[],
    newErrors: Record<string, string>
  ) => {
    if (isInitialLoadRef.current) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    setSaveStatus('saving');

    saveTimeoutRef.current = setTimeout(async () => {
      // Check if there are active errors on non-empty values
      const hasErrors = Object.keys(newErrors).some((k) => Boolean(newErrors[k]));
      if (hasErrors) {
        setSaveStatus('error');
        return;
      }

      const activeProfile = profiles.find((p) => p.id === activeProfileId);
      if (!activeProfile) return;

      const updatedProfile: ProfileRecord = {
        ...activeProfile,
        sections: buildVaultSections(newValues, newCustoms),
      };

      try {
        const res = await bridge.vaultSaveProfile(updatedProfile);
        if (res.success) {
          setSaveStatus('saved');
          if (onProfileSaved) onProfileSaved();
        } else {
          setSaveStatus('error');
          setStatusMessage({ type: 'error', text: res.error || 'Failed to save changes.' });
        }
      } catch (err: any) {
        setSaveStatus('error');
        setStatusMessage({ type: 'error', text: err?.message || 'Failed to save changes.' });
      }
    }, 800);
  };

  const handleFieldChange = (key: string, val: string) => {
    const updatedValues = { ...values, [key]: val };
    setValues(updatedValues);

    // Validate on change
    const valRes = validateFieldValue(key, val);
    const updatedErrors = { ...errors };
    if (!valRes.valid && val.trim()) {
      updatedErrors[key] = valRes.error || 'Invalid value';
    } else {
      delete updatedErrors[key];
    }
    setErrors(updatedErrors);

    scheduleAutosave(updatedValues, customFields, updatedErrors);
  };

  const handleToggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  };

  const handleAddCustomDetail = (detail: { name: string; value: string; sensitive: boolean }) => {
    const existingKeys = new Set(customFields.map((f) => f.key));
    const slug = generateCustomKey(detail.name, existingKeys);

    const newField: VaultField = {
      key: slug,
      label: detail.name,
      value: detail.value,
      sensitive: detail.sensitive,
    };

    const updatedCustoms = [...customFields, newField];
    setCustomFields(updatedCustoms);
    setShowAddCustomModal(false);

    scheduleAutosave(values, updatedCustoms, errors);
  };

  const handleDeleteCustomDetail = (key: string) => {
    const updatedCustoms = customFields.filter((cf) => cf.key !== key);
    setCustomFields(updatedCustoms);

    scheduleAutosave(values, updatedCustoms, errors);
  };

  const handleSwitchProfile = (profileId: string) => {
    setActiveProfileId(profileId);
    const prof = profiles.find((p) => p.id === profileId);
    if (prof) {
      extractProfileData(prof);
    }
  };

  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim()) return;

    const newProf: ProfileRecord = {
      id: `prof_${Date.now()}`,
      name: newProfileName.trim(),
      sections: buildVaultSections({}, []),
    };

    try {
      const res = await bridge.vaultSaveProfile(newProf);
      if (res.success) {
        const nextList = [...profiles, newProf];
        setProfiles(nextList);
        setActiveProfileId(newProf.id);
        extractProfileData(newProf);
        setShowNewProfileModal(false);
        setNewProfileName('');
      } else {
        setStatusMessage({ type: 'error', text: res.error || 'Could not create profile.' });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'Could not create profile.' });
    }
  };

  const handleImportDocument = async () => {
    try {
      const sel = await bridge.selectDocument();
      if (sel.canceled || !sel.filePath) return;

      setIsLoading(true);
      const res = await bridge.extractDocument({ filePath: sel.filePath, documentName: sel.fileName });
      if ('error' in res) {
        setStatusMessage({ type: 'error', text: res.error || 'Extraction failed' });
        return;
      }
      if (res.facts.length === 0) {
        setStatusMessage({ type: 'error', text: 'No facts could be extracted from this document.' });
        return;
      }

      // Pre-select facts
      const selectMap: Record<string, boolean> = {};
      res.facts.forEach((f) => {
        selectMap[f.key] = true;
      });
      setSelectedImportKeys(selectMap);
      setImportReview({ facts: res.facts, fileName: sel.fileName || 'document' });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'Document extraction failed.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyImport = () => {
    if (!importReview) return;

    const updatedValues = { ...values };
    const updatedCustoms = [...customFields];
    const existingCustomKeys = new Set(updatedCustoms.map((cf) => cf.key));

    importReview.facts.forEach((fact) => {
      if (!selectedImportKeys[fact.key]) return;

      const normKey = fact.key.trim().toLowerCase();
      if (SCHEMA_FIELD_MAP.has(normKey)) {
        // Prefill ONLY empty fields
        if (!updatedValues[normKey]?.trim()) {
          updatedValues[normKey] = fact.value;
        }
      } else {
        // Route unmatched items to Other Details
        const isAlreadyAdded = updatedCustoms.some((cf) => cf.key === normKey || cf.label === fact.label);
        if (!isAlreadyAdded) {
          const keySlug = generateCustomKey(fact.label || fact.key, existingCustomKeys);
          existingCustomKeys.add(keySlug);
          updatedCustoms.push({
            key: keySlug,
            label: fact.label || fact.key,
            value: fact.value,
            sensitive: false,
          });
        }
      }
    });

    setValues(updatedValues);
    setCustomFields(updatedCustoms);
    setImportReview(null);

    scheduleAutosave(updatedValues, updatedCustoms, errors);
    setStatusMessage({ type: 'success', text: 'Imported details saved to profile.' });
  };

  // Progress calculations
  const totalStandardCount = PROFILE_FIELDS.length;
  const filledStandardCount = PROFILE_FIELDS.filter((f) => Boolean(values[f.key]?.trim())).length;
  const totalWithCustoms = totalStandardCount + customFields.length;
  const filledWithCustoms = filledStandardCount + customFields.filter((cf) => Boolean(cf.value?.trim())).length;
  const progressPercent = totalWithCustoms > 0 ? Math.round((filledWithCustoms / totalWithCustoms) * 100) : 0;

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Intro Header & Banner */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          padding: '24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ fontSize: '1.375rem', fontWeight: 800, color: '#0F2E23' }}>
                My Details
              </h2>
              {/* Autosave status indicator */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: '12px',
                  background:
                    saveStatus === 'saved'
                      ? '#DCFCE7'
                      : saveStatus === 'saving'
                      ? '#FEF3C7'
                      : '#FEE2E2',
                  color:
                    saveStatus === 'saved'
                      ? '#16654E'
                      : saveStatus === 'saving'
                      ? '#92400E'
                      : '#DC2626',
                }}
              >
                {saveStatus === 'saving' && <Loader2 size={12} className="animate-spin" />}
                {saveStatus === 'saved' && <CheckCircle2 size={12} />}
                {saveStatus === 'error' && <AlertCircle size={12} />}
                <span>
                  {saveStatus === 'saving'
                    ? 'Saving...'
                    : saveStatus === 'saved'
                    ? 'Saved'
                    : 'Unsaved (check errors)'}
                </span>
              </div>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Add once, use on any form. Stored encrypted on this device.
            </p>
          </div>

          {/* Action buttons: Profile Switcher & Import */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={handleImportDocument}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(22, 101, 78, 0.08)',
                color: '#16654E',
                border: '1px solid #A7F3D0',
                fontSize: '0.8125rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <FileUp size={15} />
              <span>Import from Document</span>
            </button>

            {/* Profile select */}
            {profiles.length > 1 && (
              <select
                value={activeProfileId}
                onChange={(e) => handleSwitchProfile(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-app)',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: '#0F2E23',
                  cursor: 'pointer',
                }}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={() => setShowNewProfileModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="Add another profile (e.g. for a sibling or parent)"
            >
              <Plus size={14} />
              <span>New Profile</span>
            </button>
          </div>
        </div>

        {/* Status banner */}
        {statusMessage && (
          <div
            style={{
              marginTop: '16px',
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              background: statusMessage.type === 'success' ? '#F0FDF4' : '#FEF2F2',
              border: `1px solid ${statusMessage.type === 'success' ? '#86EFAC' : '#FECACA'}`,
              color: statusMessage.type === 'success' ? '#16654E' : '#DC2626',
              fontSize: '0.8125rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{statusMessage.text}</span>
            <button
              onClick={() => setStatusMessage(null)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit' }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Progress Bar */}
        <div style={{ marginTop: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F2E23' }}>
              Profile Completion
            </span>
            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#16654E' }}>
              {filledWithCustoms} of {totalWithCustoms} filled ({progressPercent}%)
            </span>
          </div>
          <div
            style={{
              height: '8px',
              borderRadius: '4px',
              background: '#E2E8F0',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progressPercent}%`,
                background: '#16654E',
                borderRadius: '4px',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>
      </div>

      {/* 10 Collapsible Sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {PROFILE_SECTIONS.map((secDef) => {
          const secFields = PROFILE_FIELDS.filter((f) => f.section === secDef.id);
          const isCollapsed = Boolean(collapsedSections[secDef.id]);

          return (
            <ProfileSectionCard
              key={secDef.id}
              sectionDef={secDef}
              fields={secFields}
              values={values}
              customFields={secDef.id === 'custom' ? customFields : undefined}
              errors={errors}
              isCollapsed={isCollapsed}
              onToggleCollapse={() => handleToggleSection(secDef.id)}
              onFieldChange={handleFieldChange}
              onAddCustomDetail={secDef.id === 'custom' ? () => setShowAddCustomModal(true) : undefined}
              onDeleteCustomDetail={secDef.id === 'custom' ? handleDeleteCustomDetail : undefined}
            />
          );
        })}
      </div>

      {/* Add Custom Detail Modal */}
      {showAddCustomModal && (
        <FieldEditModal
          onClose={() => setShowAddCustomModal(false)}
          onSave={handleAddCustomDetail}
        />
      )}

      {/* New Profile Modal */}
      {showNewProfileModal && (
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
            onSubmit={handleCreateProfile}
            style={{
              maxWidth: '400px',
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
                Create New Profile
              </h3>
              <button
                type="button"
                onClick={() => setShowNewProfileModal(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div>
              <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                Profile Name
              </label>
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="e.g. Sibling, Father, Work"
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

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setShowNewProfileModal(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  fontSize: '0.875rem',
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
                  fontSize: '0.875rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Import Document Review Modal */}
      {importReview && (
        <ImportDocumentModal
          importReview={importReview}
          selectedImportKeys={selectedImportKeys}
          existingValues={values}
          onClose={() => setImportReview(null)}
          onToggleKey={(k) =>
            setSelectedImportKeys((prev) => ({ ...prev, [k]: !prev[k] }))
          }
          onApply={handleApplyImport}
        />
      )}
    </div>
  );
};
