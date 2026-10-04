import React, { useEffect, useState } from 'react';
import { FileUp, Plus, RefreshCw, Trash2, User, X } from 'lucide-react';
import { bridge } from '../lib/bridge';
import type { ExtractedFact, ProfileRecord, VaultField, VaultSection } from '../types/autofiller';
import { FieldEditModal } from './my-details/FieldEditModal';
import { ImportDocumentModal } from './my-details/ImportDocumentModal';
import { ProfileSectionCard } from './my-details/ProfileSectionCard';

const REFUSED_KEYS = new Set([
  'password',
  'passwd',
  'cvv',
  'cvc',
  'otp',
  'card_number',
  'credit_card',
  'bank_account_number',
]);

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
      { key: 'aadhaar_card_number', label: 'Aadhaar / National ID', value: '', sensitive: true },
      { key: 'pan_card_number', label: 'PAN Card Number', value: '', sensitive: true },
      { key: 'passport_number', label: 'Passport Number', value: '', sensitive: true },
    ],
  },
];

interface MyDetailsViewProps {
  onProfileSaved?: () => void;
}

export const MyDetailsView: React.FC<MyDetailsViewProps> = ({ onProfileSaved }) => {
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [showSensitive, setShowSensitive] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [editingField, setEditingField] = useState<{
    sectionId: string;
    field: VaultField;
    isNew: boolean;
  } | null>(null);

  const [showNewProfileModal, setShowNewProfileModal] = useState<boolean>(false);
  const [newProfileName, setNewProfileName] = useState<string>('');

  const [importReview, setImportReview] = useState<{ facts: ExtractedFact[]; fileName: string } | null>(null);
  const [selectedImportKeys, setSelectedImportKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    setIsLoading(true);
    try {
      const list = await bridge.vaultGetProfiles();
      if (list.length === 0) {
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

    if (REFUSED_KEYS.has(key)) {
      setStatusMessage({
        type: 'error',
        text: 'Security restriction: Passwords, card numbers, CVV, OTP, and bank account numbers cannot be stored.',
      });
      return;
    }

    const updatedSections = activeProfile.sections.map((sec) => {
      if (sec.id !== sectionId) return sec;
      const existingIndex = sec.fields.findIndex((f) => f.key === key || f.key === field.key);
      const isSensitive = sec.id === 'id_numbers' || Boolean(field.sensitive);
      const newFieldObj: VaultField = { key, label, value: field.value, sensitive: isSensitive };

      let newFieldsList = [...sec.fields];
      if (existingIndex >= 0) {
        newFieldsList[existingIndex] = newFieldObj;
      } else {
        newFieldsList.push(newFieldObj);
      }
      return { ...sec, fields: newFieldsList };
    });

    const updatedProf: ProfileRecord = { ...activeProfile, sections: updatedSections };
    const res = await bridge.vaultSaveProfile(updatedProf);

    if (res.success) {
      await loadProfiles();
      setEditingField(null);
      setStatusMessage({ type: 'success', text: `Field "${label}" saved.` });
      if (onProfileSaved) onProfileSaved();
    } else {
      setStatusMessage({ type: 'error', text: res.error || 'Failed to save field.' });
    }
  };

  const handleDeleteField = async (sectionId: string, fieldKey: string) => {
    if (!activeProfile) return;
    const res = await bridge.vaultDeleteField({ profileId: activeProfile.id, sectionId, fieldKey });
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
      const res = await bridge.extractDocument({ filePath: sel.filePath, documentName: sel.fileName });
      if ('error' in res) {
        setStatusMessage({ type: 'error', text: res.error });
        return;
      }
      if (res.facts.length === 0) {
        setStatusMessage({ type: 'error', text: 'No facts could be extracted from this document.' });
        return;
      }

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

    const updatedSections = [...activeProfile.sections];
    factsToApply.forEach((fact) => {
      let targetSection = updatedSections.find((sec) => sec.fields.some((f) => f.key === fact.key));
      if (!targetSection) {
        if (['student_name', 'dob', 'gender'].includes(fact.key)) {
          targetSection = updatedSections.find((s) => s.id === 'personal');
        } else if (['email', 'phone', 'alternate_phone'].includes(fact.key)) {
          targetSection = updatedSections.find((s) => s.id === 'contact');
        } else if (['address', 'city', 'state', 'zip_code'].includes(fact.key)) {
          targetSection = updatedSections.find((s) => s.id === 'address');
        } else {
          targetSection = updatedSections.find((s) => s.id === 'personal') || updatedSections[0];
        }
      }

      if (targetSection) {
        const existingIdx = targetSection.fields.findIndex((f) => f.key === fact.key);
        if (existingIdx >= 0) {
          targetSection.fields[existingIdx] = { ...targetSection.fields[existingIdx], value: fact.value };
        } else {
          targetSection.fields.push({ key: fact.key, label: fact.label || fact.key, value: fact.value });
        }
      }
    });

    const updatedProf: ProfileRecord = { ...activeProfile, sections: updatedSections };
    const res = await bridge.vaultSaveProfile(updatedProf);
    if (res.success) {
      await loadProfiles();
      setImportReview(null);
      setStatusMessage({ type: 'success', text: `Applied ${factsToApply.length} extracted facts to profile.` });
      if (onProfileSaved) onProfileSaved();
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
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <User size={22} color="#16654E" />
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F2E23' }}>My Details</h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Manage your personal profile stored safely on this device.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
          <button onClick={() => setStatusMessage(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Accordion list */}
      {activeProfile?.sections.map((section) => (
        <ProfileSectionCard
          key={section.id}
          section={section}
          isCollapsed={Boolean(collapsedSections[section.id])}
          showSensitive={showSensitive}
          onToggleSection={(id) => setCollapsedSections((prev) => ({ ...prev, [id]: !prev[id] }))}
          onToggleShowSensitive={(key) => setShowSensitive((prev) => ({ ...prev, [key]: !prev[key] }))}
          onAddField={(secId) =>
            setEditingField({
              sectionId: secId,
              field: { key: '', label: '', value: '', sensitive: secId === 'id_numbers' },
              isNew: true,
            })
          }
          onEditField={(secId, field) => setEditingField({ sectionId: secId, field: { ...field }, isNew: false })}
          onDeleteField={handleDeleteField}
        />
      ))}

      {editingField && (
        <FieldEditModal
          editingField={editingField}
          onClose={() => setEditingField(null)}
          onSave={handleSaveField}
          onChangeField={(field) => setEditingField({ ...editingField, field })}
        />
      )}

      {importReview && (
        <ImportDocumentModal
          importReview={importReview}
          selectedImportKeys={selectedImportKeys}
          onClose={() => setImportReview(null)}
          onToggleKey={(key) => setSelectedImportKeys((prev) => ({ ...prev, [key]: !prev[key] }))}
          onApply={handleApplyImportedFacts}
        />
      )}
    </div>
  );
};
