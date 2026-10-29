/**
 * ManagementViews: Profile vault, application settings, and help views for AutoFiller AI.
 *
 * Consolidates MyDetailsView, SettingsView, and HelpView into a unified management view module.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  FileUp,
  Globe,
  HelpCircle,
  Key,
  Loader2,
  Lock,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import { bridge } from '../lib/bridge';
import type {
  ExtractedFact,
  ProfileRecord,
  VaultField,
  VaultSection,
  VaultStatus,
} from '../types/autofiller';
import {
  PROFILE_FIELDS,
  PROFILE_SECTIONS,
  SCHEMA_FIELD_MAP,
  SchemaFieldDef,
  deriveFacts,
  generateCustomKey,
  validateFieldValue,
} from '../../electron/shared/profileSchema';
import { FieldEditModal, ImportDocumentModal } from './my-details/ProfileModals';
import { ProfileSectionCard } from './my-details/ProfileSectionCard';
import {
  ChangeKeyModal,
  DisableProtectionModal,
  EraseDataModal,
  VaultWizardModal,
} from './settings/SettingsModals';

/* ========================================================================= */
/* 1. MyDetailsView Component                                               */
/* ========================================================================= */

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
    <div style={{ maxWidth: '1040px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
              <User size={22} color="var(--text-brand)" />
              <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-title)' }}>
                My Details
              </h1>
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
                      ? 'var(--badge-green-text)'
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
                color: 'var(--text-brand)',
                border: '1px solid var(--badge-green-border)',
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
                  color: 'var(--text-title)',
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
              color: statusMessage.type === 'success' ? 'var(--badge-green-text)' : 'var(--status-danger)',
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
            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-title)' }}>
              Profile Completion
            </span>
            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-brand)' }}>
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
                background: 'var(--status-success)',
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
              <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--text-title)' }}>
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
                  background: 'var(--status-success)',
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

/* ========================================================================= */
/* 2. SettingsView Component                                                */
/* ========================================================================= */

interface SettingsViewProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onLockVault?: () => void;
  onTryMockForm?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  theme,
  onToggleTheme,
  onLockVault,
  onTryMockForm,
}) => {
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>({
    exists: false,
    unlocked: true,
    hasOsSlot: true,
    hasPassphraseSlot: false,
    hasRecoverySlot: false,
    recoveryAvailable: false,
  });

  const [version, setVersion] = useState<string>('v1.0.0');
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Extra protection wizard state (encapsulated in VaultWizardModal)
  const [showWizard, setShowWizard] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Change key modal
  const [showChangeModal, setShowChangeModal] = useState<boolean>(false);
  const [currentKeyInput, setCurrentKeyInput] = useState<string>('');
  const [newKeyInput, setNewKeyInput] = useState<string>('');
  const [confirmNewKeyInput, setConfirmNewKeyInput] = useState<string>('');

  // Disable extra protection modal
  const [showDisableModal, setShowDisableModal] = useState<boolean>(false);
  const [disableKeyInput, setDisableKeyInput] = useState<string>('');

  // Erase all data confirmation modal
  const [showEraseModal, setShowEraseModal] = useState<boolean>(false);

  // AI Model Configuration
  const [aiConfigured, setAiConfigured] = useState<boolean>(false);
  const [aiKeyInput, setAiKeyInput] = useState<string>('');
  const [showAiKey, setShowAiKey] = useState<boolean>(false);
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);

  useEffect(() => {
    loadStatus();
    bridge.appVersion().then((v) => setVersion(v || '1.0.0'));
  }, []);

  const loadStatus = async () => {
    try {
      const st = await bridge.vaultStatus();
      setVaultStatus(st);
      const aiStatus = await bridge.getAiConfig();
      setAiConfigured(aiStatus.configured);
    } catch (err) {
      console.error('Failed to load vault status', err);
    }
  };

  const handleSaveAiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiKeyInput.trim()) return;
    setIsAiProcessing(true);
    setStatusMsg(null);
    try {
      const res = await bridge.setAiApiKey(aiKeyInput.trim());
      if (res.success) {
        setAiConfigured(true);
        setAiKeyInput('');
        setStatusMsg({ type: 'success', text: 'AI API key saved and encrypted with Windows DPAPI. Automation is ready.' });
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Failed to save AI API key.' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMsg({ type: 'error', text: msg });
    } finally {
      setIsAiProcessing(false);
    }
  };

  const handleClearAiKey = async () => {
    setIsAiProcessing(true);
    setStatusMsg(null);
    try {
      const res = await bridge.clearAiApiKey();
      if (res.success) {
        setAiConfigured(false);
        setAiKeyInput('');
        setStatusMsg({ type: 'success', text: 'AI API key removed.' });
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Failed to remove AI API key.' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMsg({ type: 'error', text: msg });
    } finally {
      setIsAiProcessing(false);
    }
  };
  const handleStartWizard = () => {
    setShowWizard(true);
    setStatusMsg(null);
  };

  const handleChangeKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    if (newKeyInput.length < 10) {
      setStatusMsg({ type: 'error', text: 'New privacy key must be at least 10 characters long.' });
      return;
    }
    if (newKeyInput !== confirmNewKeyInput) {
      setStatusMsg({ type: 'error', text: 'New privacy keys do not match.' });
      return;
    }

    setIsProcessing(true);
    try {
      const res = await bridge.vaultChangeKey({
        currentPrivacyKey: currentKeyInput,
        newPrivacyKey: newKeyInput,
      });
      if (res.success) {
        setShowChangeModal(false);
        setCurrentKeyInput('');
        setNewKeyInput('');
        setConfirmNewKeyInput('');
        setStatusMsg({ type: 'success', text: 'Privacy key updated successfully.' });
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Failed to change key.' });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Error changing privacy key.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDisableExtra = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg(null);
    setIsProcessing(true);

    try {
      const res = await bridge.vaultDisableExtra({ privacyKey: disableKeyInput });
      if (res.success) {
        await loadStatus();
        setShowDisableModal(false);
        setDisableKeyInput('');
        setStatusMsg({ type: 'success', text: 'Extra protection turned off. Vault is now in Standard protection mode.' });
      } else {
        setStatusMsg({ type: 'error', text: res.error || 'Incorrect privacy key.' });
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Error disabling extra protection.' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLockNow = async () => {
    await bridge.vaultLock();
    await loadStatus();
    if (onLockVault) onLockVault();
  };

  const handleEraseAllData = async () => {
    setIsProcessing(true);
    try {
      await bridge.eraseAllData();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Erase all data failed.' });
      setIsProcessing(false);
      setShowEraseModal(false);
    }
  };

  const isExtraProtectionOn = Boolean(vaultStatus.hasPassphraseSlot);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}>
      {/* Compact Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Settings size={20} color="var(--text-brand)" />
          <h1 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-title)', margin: 0 }}>Settings</h1>
          <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>&bull; Manage privacy, AI model, and app preferences</span>
        </div>
      </div>

      {statusMsg && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 'var(--radius-md)',
            background: statusMsg.type === 'success' ? '#F0FDF4' : '#FEF2F2',
            border: `1px solid ${statusMsg.type === 'success' ? '#86EFAC' : '#FCA5A5'}`,
            color: statusMsg.type === 'success' ? 'var(--badge-green-text)' : 'var(--status-danger)',
            fontSize: '0.8125rem',
            fontWeight: 600,
          }}
        >
          {statusMsg.text}
        </div>
      )}

      {/* Balanced Responsive 2-Column Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '12px', minHeight: 0 }}>
        {/* Left Column: AI Model Configuration + Privacy & Security */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* 1. AI Model Configuration Card */}
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
              padding: '14px 16px',
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={16} color="var(--text-brand)" />
                <h2 style={{ fontSize: '0.875rem', fontWeight: 800, color: 'var(--text-title)', margin: 0 }}>AI Model Configuration</h2>
              </div>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  background: aiConfigured ? '#10B981' : '#F59E0B',
                  color: '#FFFFFF',
                }}
              >
                {aiConfigured ? 'Configured (Encrypted)' : 'Setup Required'}
              </span>
            </div>

            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              Enter your Google Gemini API key to enable document fact extraction and semantic form field mapping.
              Key is encrypted locally using Windows DPAPI and never logged.
            </p>

            <form onSubmit={handleSaveAiKey} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type={showAiKey ? 'text' : 'password'}
                  placeholder={aiConfigured ? '•••••••••••••••••••••••• (Change key)' : 'AIzaSy... (Paste Gemini key)'}
                  value={aiKeyInput}
                  onChange={(e) => setAiKeyInput(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 32px 6px 10px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-surface-subtle)',
                    color: 'var(--text-title)',
                    fontSize: '0.8125rem',
                    fontFamily: 'monospace',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowAiKey(!showAiKey)}
                  style={{
                    position: 'absolute',
                    right: '6px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title={showAiKey ? 'Hide Key' : 'Show Key'}
                >
                  {showAiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <button
                type="submit"
                disabled={isAiProcessing || !aiKeyInput.trim()}
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--status-success)',
                  color: '#FFFFFF',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '0.8125rem',
                  cursor: isAiProcessing || !aiKeyInput.trim() ? 'not-allowed' : 'pointer',
                  opacity: isAiProcessing || !aiKeyInput.trim() ? 0.6 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Save size={13} />
                <span>{isAiProcessing ? 'Saving...' : 'Save'}</span>
              </button>
              {aiConfigured && (
                <button
                  type="button"
                  onClick={handleClearAiKey}
                  disabled={isAiProcessing}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-md)',
                    background: 'transparent',
                    color: 'var(--status-danger)',
                    border: '1px solid var(--status-danger)',
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                  }}
                  title="Remove stored API key"
                >
                  Clear
                </button>
              )}
            </form>
          </div>

          {/* 2. Privacy & Security Vault Card */}
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
              padding: '14px 16px',
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '8px',
                    background: isExtraProtectionOn ? '#D1FAE5' : '#E2E8F0',
                    color: isExtraProtectionOn ? '#065F46' : '#334155',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {isExtraProtectionOn ? <ShieldCheck size={16} /> : <Lock size={16} />}
                </div>
                <div>
                  <h2 style={{ fontSize: '0.875rem', fontWeight: 800, color: 'var(--text-title)', margin: 0 }}>Privacy & Security</h2>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Local AES-256-GCM Vault</div>
                </div>
              </div>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  background: isExtraProtectionOn ? '#10B981' : '#64748B',
                  color: '#FFFFFF',
                }}
              >
                {isExtraProtectionOn ? 'Extra protection on' : 'Standard protection'}
              </span>
            </div>

            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              {isExtraProtectionOn
                ? 'Your profile details are encrypted with your master passphrase, required on each launch.'
                : 'Encrypted locally using Windows DPAPI user security. Anyone signed into this Windows account can open the app.'}
            </p>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
              {!isExtraProtectionOn ? (
                <button
                  onClick={handleStartWizard}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--status-success)',
                    color: '#FFFFFF',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '0.78125rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Key size={14} />
                  <span>Turn on Extra Protection</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setShowChangeModal(true)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-app)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      fontWeight: 600,
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    Change Key
                  </button>
                  <button
                    onClick={() => setShowDisableModal(true)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-app)',
                      border: '1px solid var(--border-subtle)',
                      color: '#DC2626',
                      fontWeight: 600,
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    Turn off
                  </button>
                  {onLockVault && (
                    <button
                      onClick={handleLockNow}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--accent-primary)',
                        color: '#FFFFFF',
                        border: 'none',
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <Lock size={12} />
                      <span>Lock Now</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Practice Form + App Preferences & Storage */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* 3. Practice Form & Simulation Card */}
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
              padding: '14px 16px',
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Globe size={16} color="var(--text-brand)" />
                <h2 style={{ fontSize: '0.875rem', fontWeight: 800, color: 'var(--text-title)', margin: 0 }}>Practice Form & Simulation</h2>
              </div>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  background: 'var(--badge-green-bg)',
                  color: 'var(--text-brand)',
                }}
              >
                Ready &amp; Bundled
              </span>
            </div>

            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.35 }}>
              Test automated form filling locally on the 5-step school admission form without submitting to external websites.
            </p>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: 'auto' }}>
              <div
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.75rem',
                  fontFamily: 'monospace',
                  color: 'var(--text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title="http://127.0.0.1:8000/mock_school_form.html"
              >
                http://127.0.0.1:8000/mock_school_form.html
              </div>
              {onTryMockForm && (
                <button
                  type="button"
                  onClick={onTryMockForm}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--accent-primary)',
                    color: '#FFFFFF',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '0.78125rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Play size={13} />
                  <span>Try Practice Form</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => window.open('http://127.0.0.1:8000/mock_school_form.html', '_blank')}
                style={{
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap',
                }}
                title="Open practice form in external browser"
              >
                <ExternalLink size={12} />
                <span>View</span>
              </button>
            </div>
          </div>

          {/* 4. Preferences, Storage & System Panel */}
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
              padding: '14px 16px',
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings size={16} color="var(--text-brand)" />
                <h2 style={{ fontSize: '0.875rem', fontWeight: 800, color: 'var(--text-title)', margin: 0 }}>Preferences &amp; Storage</h2>
              </div>
              <span
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--badge-green-bg)',
                  color: 'var(--text-brand)',
                }}
              >
                v{version}
              </span>
            </div>

            {/* Theme Toggle Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-title)' }}>App Appearance</div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Toggle light or dark desktop theme</div>
              </div>
              <button
                onClick={onToggleTheme}
                style={{
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-title)',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {theme === 'light' ? <Sun size={13} color="var(--text-brand)" /> : <Moon size={13} color="var(--text-brand)" />}
                <span>{theme === 'light' ? 'Light Theme' : 'Dark Theme'}</span>
              </button>
            </div>

            {/* Data & Storage Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
              <div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-title)' }}>Local Data Storage</div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Purge local profiles, session histories, and traces</div>
              </div>
              <button
                onClick={() => setShowEraseModal(true)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-md)',
                  background: '#FEF2F2',
                  border: '1px solid #FCA5A5',
                  color: '#DC2626',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  flexShrink: 0,
                }}
              >
                <Trash2 size={12} />
                <span>Erase All Data</span>
              </button>
            </div>

            <div style={{ fontSize: '0.6875rem', color: 'var(--text-brand)', fontWeight: 700, marginTop: 'auto', paddingTop: '4px', borderTop: '1px solid var(--border-subtle)' }}>
              Safety Policy: Form submission is strictly user-controlled.
            </div>
          </div>
        </div>
      </div>

      {/* Modular Settings Modals (Fixes H-03) */}
      <VaultWizardModal
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        onSuccess={(msg) => setStatusMsg({ type: 'success', text: msg })}
        onError={(err) => setStatusMsg({ type: 'error', text: err })}
        onReloadStatus={loadStatus}
      />

      <ChangeKeyModal
        isOpen={showChangeModal}
        currentKeyInput={currentKeyInput}
        setCurrentKeyInput={setCurrentKeyInput}
        newKeyInput={newKeyInput}
        setNewKeyInput={setNewKeyInput}
        confirmNewKeyInput={confirmNewKeyInput}
        setConfirmNewKeyInput={setConfirmNewKeyInput}
        isProcessing={isProcessing}
        onClose={() => setShowChangeModal(false)}
        onSubmit={handleChangeKey}
      />

      <DisableProtectionModal
        isOpen={showDisableModal}
        disableKeyInput={disableKeyInput}
        setDisableKeyInput={setDisableKeyInput}
        isProcessing={isProcessing}
        onClose={() => setShowDisableModal(false)}
        onSubmit={handleDisableExtra}
      />

      <EraseDataModal
        isOpen={showEraseModal}
        isProcessing={isProcessing}
        onClose={() => setShowEraseModal(false)}
        onConfirm={handleEraseAllData}
      />
    </div>
  );
};

/* ========================================================================= */
/* 3. HelpView Component                                                    */
/* ========================================================================= */

export const HelpView: React.FC = () => {
  const [version, setVersion] = useState<string>('1.0.0');

  useEffect(() => {
    bridge.appVersion().then(setVersion).catch(() => setVersion('1.0.0'));
  }, []);

  const steps = [
    {
      num: 1,
      color: 'var(--text-brand)',
      title: 'Store Details or Select Document',
      desc: 'Save your profile once under My Details, or extract facts from uploaded PDFs and images on demand.',
    },
    {
      num: 2,
      color: 'var(--text-brand)',
      title: 'Choose Source & Form URL',
      desc: 'Select your data source (Vault Profile or Uploaded Document) and paste the target web form URL.',
    },
    {
      num: 3,
      color: '#2563EB',
      title: 'Supervise Automation Live',
      desc: 'Start automation. Playwright opens the browser window and maps facts to form fields under your live observation.',
    },
    {
      num: 4,
      color: '#059669',
      title: 'Human Review & Manual Submit',
      desc: 'Form filling strictly halts at REVIEW_READY. You inspect the filled form in the browser and click submit manually.',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1040px', margin: '0 auto' }}>
      {/* Canonical Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <HelpCircle size={22} color="var(--text-brand)" />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-title)' }}>Usage & Privacy Guide</h1>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--badge-green-bg)',
              color: 'var(--text-brand)',
              marginLeft: '4px',
            }}
          >
            v{version}
          </span>
        </div>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Automated document extraction to web form filling with strict human-in-the-loop safety.
        </p>
      </div>

      {/* Workflow Steps Card (Compact 2x2 Grid) */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={18} color="var(--text-brand)" />
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-title)' }}>
              How AutoFiller Works in 4 Steps
            </h3>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            Zero-friction local workflow
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
          {steps.map((s) => (
            <div
              key={s.num}
              style={{
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-start',
                padding: '14px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-surface-subtle)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: s.color,
                  color: '#FFFFFF',
                  fontWeight: 800,
                  fontSize: '0.8125rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {s.num}
              </div>
              <div>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-title)' }}>
                  {s.title}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '3px', lineHeight: 1.45 }}>
                  {s.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2-Column Split: Privacy Notice & Never-Submit Guarantee */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Privacy Notice Card */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Lock size={18} color="var(--text-brand)" />
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-title)' }}>
              Privacy & Data Processing Policy
            </h3>
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Field labels are sent to AI for matching; your values stay on this device; uploaded documents are processed by Gemini. No personal values are ever logged in traces or persisted without encryption.
          </p>
        </div>

        {/* Safety Guarantee Card */}
        <div
          style={{
            background: 'var(--badge-green-bg)',
            border: '1.5px solid var(--badge-green-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            boxShadow: 'var(--shadow-card)',
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-start',
          }}
        >
          <ShieldAlert size={22} color="var(--text-brand)" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 800, color: 'var(--text-brand)' }}>
              Never-Submit Safety Guarantee
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-brand)', marginTop: '4px', lineHeight: 1.5 }}>
              AutoFiller PolicyEngine strictly enforces that form submission is never automated. Automation always stops at <strong>REVIEW_READY</strong> so you retain 100% control over form submission.
            </p>
          </div>
        </div>
      </div>

      {/* Footer Info Bar */}
      <div
        style={{
          paddingTop: '12px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.8125rem',
          color: 'var(--text-muted)',
        }}
      >
        <div>
          AutoFiller AI <strong>v{version}</strong>
        </div>
        <div style={{ fontWeight: 600, color: 'var(--text-title)' }}>
          Safe Local Storage • Human-in-the-Loop Architecture
        </div>
      </div>
    </div>
  );
};
