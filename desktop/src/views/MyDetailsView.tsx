import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileUp,
  Lock,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  User,
  ShieldAlert,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { bridge } from '../lib/bridge';
import type { ExtractedFact, ProfileRecord, VaultField, VaultSection } from '../types/autofiller';

const PROHIBITED_KEYS_REGEX =
  /(password|passwd|pin|cvv|cvc|credit_card|card_number|cardnum|otp|bank_account|account_number|routing_number)/i;

const DEFAULT_SECTIONS: VaultSection[] = [
  {
    id: 'personal',
    title: 'Personal Information',
    fields: [
      { key: 'student_name', label: 'Full Name', value: '' },
      { key: 'dob', label: 'Date of Birth (YYYY-MM-DD)', value: '' },
      { key: 'gender', label: 'Gender', value: '' },
    ],
  },
  {
    id: 'contact',
    title: 'Contact Details',
    fields: [
      { key: 'email', label: 'Email Address', value: '' },
      { key: 'phone', label: 'Primary Phone', value: '' },
      { key: 'alternate_phone', label: 'Alternate Phone', value: '' },
    ],
  },
  {
    id: 'address',
    title: 'Address Information',
    fields: [
      { key: 'address', label: 'Street Address', value: '' },
      { key: 'city', label: 'City', value: '' },
      { key: 'state', label: 'State / Province', value: '' },
      { key: 'zip_code', label: 'Pincode / Zip Code', value: '' },
    ],
  },
  {
    id: 'parent',
    title: 'Parent / Guardian Info',
    fields: [
      { key: 'parent_name', label: "Father's / Guardian Name", value: '' },
      { key: 'mother_name', label: "Mother's Name", value: '' },
    ],
  },
  {
    id: 'education',
    title: 'Education History',
    fields: [
      { key: 'previous_school', label: 'Previous School', value: '' },
      { key: 'grade', label: 'Class / Grade Applied', value: '' },
    ],
  },
  {
    id: 'id_numbers',
    title: 'ID Numbers & Identification',
    fields: [
      { key: 'aadhaar_number', label: 'Aadhaar / National ID', value: '', sensitive: true },
      { key: 'ssn', label: 'SSN / Tax ID', value: '', sensitive: true },
      { key: 'passport_number', label: 'Passport Number', value: '', sensitive: true },
    ],
  },
];

export const MyDetailsView: React.FC = () => {
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [showSensitive, setShowSensitive] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Field Edit Modal state
  const [editingField, setEditingField] = useState<{
    sectionId: string;
    field: VaultField;
    isNew: boolean;
  } | null>(null);

  // New Profile Modal state
  const [showNewProfileModal, setShowNewProfileModal] = useState<boolean>(false);
  const [newProfileName, setNewProfileName] = useState<string>('');

  // Import Document Review Modal state
  const [importReview, setImportReview] = useState<{
    facts: ExtractedFact[];
    fileName: string;
  } | null>(null);
  const [selectedImportKeys, setSelectedImportKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    setIsLoading(true);
    try {
      const list = await bridge.vaultGetProfiles();
      if (list.length === 0) {
        // Create default profile if none exists
        const defaultProf: ProfileRecord = {
          id: `prof_${Date.now()}`,
          name: 'Default Profile',
          sections: DEFAULT_SECTIONS,
        };
        await bridge.vaultSaveProfile(defaultProf);
        setProfiles([defaultProf]);
        setActiveProfileId(defaultProf.id);
      } else {
        setProfiles(list);
        if (!activeProfileId || !list.find((p) => p.id === activeProfileId)) {
          setActiveProfileId(list[0].id);
        }
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'Failed to load profiles' });
    } finally {
      setIsLoading(false);
    }
  };

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const toggleShowSensitive = (fieldKey: string) => {
    setShowSensitive((prev) => ({ ...prev, [fieldKey]: !prev[fieldKey] }));
  };

  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProfileName.trim()) return;

    const newProf: ProfileRecord = {
      id: `prof_${Date.now()}`,
      name: newProfileName.trim(),
      sections: DEFAULT_SECTIONS,
    };

    const res = await bridge.vaultSaveProfile(newProf);
    if (res.success) {
      await loadProfiles();
      setActiveProfileId(newProf.id);
      setShowNewProfileModal(false);
      setNewProfileName('');
      setStatusMessage({ type: 'success', text: `Profile "${newProf.name}" created.` });
    } else {
      setStatusMessage({ type: 'error', text: res.error || 'Could not create profile.' });
    }
  };

  const handleDeleteProfile = async (profId: string) => {
    if (profiles.length <= 1) {
      setStatusMessage({ type: 'error', text: 'Cannot delete the only profile.' });
      return;
    }
    if (!confirm('Are you sure you want to delete this profile?')) return;

    const res = await bridge.vaultDeleteProfile(profId);
    if (res.success) {
      await loadProfiles();
      setStatusMessage({ type: 'success', text: 'Profile deleted.' });
    } else {
      setStatusMessage({ type: 'error', text: res.error || 'Failed to delete profile.' });
    }
  };

  const handleSaveField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingField || !activeProfile) return;

    const { sectionId, field } = editingField;
    const key = field.key.trim().toLowerCase().replace(/\s+/g, '_');
    const label = field.label.trim() || key;

    if (!key) {
      setStatusMessage({ type: 'error', text: 'Field key is required.' });
      return;
    }

    if (PROHIBITED_KEYS_REGEX.test(key)) {
      setStatusMessage({
        type: 'error',
        text: 'Security restriction: Passwords, card numbers, CVV, OTP, and bank account numbers cannot be stored in the vault.',
      });
      return;
    }

    // Clone sections and update target
    const updatedSections = activeProfile.sections.map((sec) => {
      if (sec.id !== sectionId) return sec;
      const existingIndex = sec.fields.findIndex((f) => f.key === key || f.key === field.key);
      const isSensitive = sec.id === 'id_numbers' || Boolean(field.sensitive);
      const newFieldObj: VaultField = {
        key,
        label,
        value: field.value,
        sensitive: isSensitive,
      };

      let newFieldsList = [...sec.fields];
      if (existingIndex >= 0) {
        newFieldsList[existingIndex] = newFieldObj;
      } else {
        newFieldsList.push(newFieldObj);
      }
      return { ...sec, fields: newFieldsList };
    });

    const updatedProf: ProfileRecord = {
      ...activeProfile,
      sections: updatedSections,
    };

    const res = await bridge.vaultSaveProfile(updatedProf);
    if (res.success) {
      await loadProfiles();
      setEditingField(null);
      setStatusMessage({ type: 'success', text: `Field "${label}" saved.` });
    } else {
      setStatusMessage({ type: 'error', text: res.error || 'Failed to save field.' });
    }
  };

  const handleDeleteField = async (sectionId: string, fieldKey: string) => {
    if (!activeProfile) return;
    const res = await bridge.vaultDeleteField({
      profileId: activeProfile.id,
      sectionId,
      fieldKey,
    });
    if (res.success) {
      await loadProfiles();
      setStatusMessage({ type: 'success', text: 'Field removed.' });
    } else {
      setStatusMessage({ type: 'error', text: res.error || 'Failed to delete field.' });
    }
  };

  const handleImportDocument = async () => {
    try {
      const sel = await bridge.selectDocument();
      if (sel.canceled || !sel.filePath) return;

      setIsLoading(true);
      const res = await bridge.extractDocument({
        filePath: sel.filePath,
        documentName: sel.fileName,
      });

      if ('error' in res) {
        setStatusMessage({ type: 'error', text: res.error });
        return;
      }

      if (res.facts.length === 0) {
        setStatusMessage({ type: 'error', text: 'No facts could be extracted from this document.' });
        return;
      }

      // Pre-select all extracted facts
      const selectMap: Record<string, boolean> = {};
      res.facts.forEach((f) => {
        selectMap[f.key] = true;
      });

      setSelectedImportKeys(selectMap);
      setImportReview({ facts: res.facts, fileName: sel.fileName || 'document' });
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err?.message || 'Extraction failed' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyImportedFacts = async () => {
    if (!importReview || !activeProfile) return;

    const factsToApply = importReview.facts.filter((f) => selectedImportKeys[f.key]);
    if (factsToApply.length === 0) {
      setImportReview(null);
      return;
    }

    // Merge into active profile sections
    const updatedSections = [...activeProfile.sections];

    factsToApply.forEach((fact) => {
      let targetSection = updatedSections.find((sec) =>
        sec.fields.some((f) => f.key === fact.key)
      );

      if (!targetSection) {
        // Find best default section
        if (['student_name', 'dob', 'gender'].includes(fact.key)) {
          targetSection = updatedSections.find((s) => s.id === 'personal');
        } else if (['email', 'phone', 'alternate_phone'].includes(fact.key)) {
          targetSection = updatedSections.find((s) => s.id === 'contact');
        } else if (['address', 'city', 'state', 'zip_code'].includes(fact.key)) {
          targetSection = updatedSections.find((s) => s.id === 'address');
        } else if (['parent_name', 'mother_name'].includes(fact.key)) {
          targetSection = updatedSections.find((s) => s.id === 'parent');
        } else if (['previous_school', 'grade'].includes(fact.key)) {
          targetSection = updatedSections.find((s) => s.id === 'education');
        } else {
          targetSection = updatedSections.find((s) => s.id === 'personal') || updatedSections[0];
        }
      }

      if (targetSection) {
        const existingIdx = targetSection.fields.findIndex((f) => f.key === fact.key);
        if (existingIdx >= 0) {
          targetSection.fields[existingIdx] = {
            ...targetSection.fields[existingIdx],
            value: fact.value,
          };
        } else {
          targetSection.fields.push({
            key: fact.key,
            label: fact.label || fact.key,
            value: fact.value,
          });
        }
      }
    });

    const updatedProf: ProfileRecord = {
      ...activeProfile,
      sections: updatedSections,
    };

    const res = await bridge.vaultSaveProfile(updatedProf);
    if (res.success) {
      await loadProfiles();
      setImportReview(null);
      setStatusMessage({
        type: 'success',
        text: `Applied ${factsToApply.length} extracted facts to profile.`,
      });
    } else {
      setStatusMessage({ type: 'error', text: res.error || 'Failed to update profile.' });
    }
  };

  if (isLoading && profiles.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px' }}>
        <RefreshCw size={24} className="animate-spin" color="#16654E" />
        <span style={{ marginLeft: '12px', color: 'var(--text-secondary)' }}>Loading Encrypted Vault...</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Header & Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <User size={22} color="#16654E" />
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F2E23' }}>My Details & Vault</h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Manage your encrypted personal data stored safely on your machine.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Profile Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <select
              value={activeProfileId}
              onChange={(e) => setActiveProfileId(e.target.value)}
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 14px',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  Profile: {p.name}
                </option>
              ))}
            </select>

            <button
              onClick={() => setShowNewProfileModal(true)}
              title="Create new profile"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 12px',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Plus size={16} />
              <span>New</span>
            </button>

            {profiles.length > 1 && (
              <button
                onClick={() => handleDeleteProfile(activeProfileId)}
                title="Delete current profile"
                style={{
                  background: '#FEF2F2',
                  border: '1px solid #FCA5A5',
                  borderRadius: 'var(--radius-md)',
                  padding: '8px 12px',
                  color: '#DC2626',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>

          {/* Import Document Button */}
          <button
            onClick={handleImportDocument}
            style={{
              background: '#16654E',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: '8px 16px',
              fontSize: '0.875rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <FileUp size={16} />
            <span>Import from Document</span>
          </button>
        </div>
      </div>

      {/* Status banner */}
      {statusMessage && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            background: statusMessage.type === 'success' ? '#F0FDF4' : '#FEF2F2',
            border: `1px solid ${statusMessage.type === 'success' ? '#86EFAC' : '#FCA5A5'}`,
            color: statusMessage.type === 'success' ? '#16654E' : '#991B1B',
            fontSize: '0.875rem',
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
            <X size={16} />
          </button>
        </div>
      )}

      {/* Sections Accordion */}
      {activeProfile?.sections.map((section) => {
        const isCollapsed = Boolean(collapsedSections[section.id]);
        return (
          <div
            key={section.id}
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
            }}
          >
            {/* Section Header */}
            <div
              onClick={() => toggleSection(section.id)}
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
                  {section.fields.filter((f) => Boolean(f.value)).length} / {section.fields.length} filled
                </span>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingField({
                    sectionId: section.id,
                    field: { key: '', label: '', value: '', sensitive: section.id === 'id_numbers' },
                    isNew: true,
                  });
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

            {/* Section Body */}
            {!isCollapsed && (
              <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                {section.fields.map((field) => {
                  const isSensitive = section.id === 'id_numbers' || Boolean(field.sensitive);
                  const isVisible = showSensitive[field.key];
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
                              onClick={() => toggleShowSensitive(field.key)}
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
                          onClick={() =>
                            setEditingField({
                              sectionId: section.id,
                              field: { ...field },
                              isNew: false,
                            })
                          }
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#16654E',
                            cursor: 'pointer',
                            padding: '2px',
                          }}
                          title="Edit field"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteField(section.id, field.key)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#DC2626',
                            cursor: 'pointer',
                            padding: '2px',
                          }}
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
      })}

      {/* Edit / Add Field Modal */}
      {editingField && (
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
            onSubmit={handleSaveField}
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
                {editingField.isNew ? 'Add Field' : 'Edit Field'}
              </h3>
              <button
                type="button"
                onClick={() => setEditingField(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div>
              <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                Field Key (Canonical name)
              </label>
              <input
                type="text"
                value={editingField.field.key}
                disabled={!editingField.isNew}
                onChange={(e) =>
                  setEditingField({
                    ...editingField,
                    field: { ...editingField.field, key: e.target.value },
                  })
                }
                placeholder="e.g. student_name, email, phone"
                style={{
                  width: '100%',
                  marginTop: '6px',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  background: editingField.isNew ? 'var(--bg-app)' : '#F1F5F9',
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
                value={editingField.field.label}
                onChange={(e) =>
                  setEditingField({
                    ...editingField,
                    field: { ...editingField.field, label: e.target.value },
                  })
                }
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
                value={editingField.field.value}
                onChange={(e) =>
                  setEditingField({
                    ...editingField,
                    field: { ...editingField.field, value: e.target.value },
                  })
                }
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
                checked={Boolean(editingField.field.sensitive)}
                onChange={(e) =>
                  setEditingField({
                    ...editingField,
                    field: { ...editingField.field, sensitive: e.target.checked },
                  })
                }
              />
              <label htmlFor="sensitive_check" style={{ fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}>
                Mark as sensitive / ID field (mask value on screen)
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
              <button
                type="button"
                onClick={() => setEditingField(null)}
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
            <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0F2E23' }}>Create Profile</h3>
            <div>
              <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                Profile Name
              </label>
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="e.g. Son's Application, College Form"
                style={{
                  width: '100%',
                  marginTop: '6px',
                  padding: '8px 12px',
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
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newProfileName.trim()}
                style={{
                  padding: '8px 20px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: '#16654E',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  cursor: newProfileName.trim() ? 'pointer' : 'not-allowed',
                  opacity: newProfileName.trim() ? 1 : 0.6,
                }}
              >
                Create Profile
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Import Document Review Modal */}
      {importReview && (
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
              <button
                onClick={() => setImportReview(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
              {importReview.facts.map((fact) => {
                const isSelected = Boolean(selectedImportKeys[fact.key]);
                return (
                  <div
                    key={fact.key}
                    onClick={() =>
                      setSelectedImportKeys((prev) => ({ ...prev, [fact.key]: !prev[fact.key] }))
                    }
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
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      style={{ cursor: 'pointer' }}
                    />
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
                {Object.values(selectedImportKeys).filter(Boolean).length} / {importReview.facts.length} selected
              </span>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => setImportReview(null)}
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
                  onClick={handleApplyImportedFacts}
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
      )}
    </div>
  );
};
