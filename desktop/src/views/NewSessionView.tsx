import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleDot,
  FileText,
  Globe,
  Lock,
  Play,
  RotateCw,
  Shield,
  UploadCloud,
  User,
  Layers,
} from 'lucide-react';
import { bridge, hasElectronBridge } from '../lib/bridge';
import type {
  AgentEventPayload,
  ExtractedFact,
  ProfileRecord,
  WorkflowState,
} from '../types/autofiller';

type DataSourceMode = 'profile' | 'document' | 'both';

interface NewSessionViewProps {
  state: WorkflowState;
  documentName: string;
  documentSize: number;
  facts: ExtractedFact[];
  targetUrl: string;
  instruction: string;
  events: AgentEventPayload[];
  inlineError: string | null;
  isExtracting: boolean;
  canStart: boolean;
  disabledReason: string;
  onSelectDocument: () => void;
  onStartSession: () => void;
  onSetFacts: React.Dispatch<React.SetStateAction<ExtractedFact[]>>;
  onSetTargetUrl: (url: string) => void;
  onSetInstruction: (inst: string) => void;
  onStopSession?: () => void;
}

export const NewSessionView: React.FC<NewSessionViewProps> = ({
  state,
  documentName: propDocumentName,
  documentSize: propDocumentSize,
  facts: propFacts,
  targetUrl,
  events,
  inlineError: propInlineError,
  isExtracting: propIsExtracting,
  onSetTargetUrl,
  onSetFacts,
  onStopSession,
}) => {
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>(() => {
    if (propFacts && propFacts.length > 0) return 'document';
    return 'profile';
  });
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');

  // Uploaded Document state
  const [uploadedDocName, setUploadedDocName] = useState<string>(propDocumentName || '');
  const [uploadedDocPath, setUploadedDocPath] = useState<string>('');
  const [uploadedDocSize, setUploadedDocSize] = useState<number>(propDocumentSize || 0);
  const [docFacts, setDocFacts] = useState<ExtractedFact[]>(propFacts || []);
  const [isExtractingDoc, setIsExtractingDoc] = useState<boolean>(false);

  // ID fields permission
  const [fillIdFields, setFillIdFields] = useState<boolean>(false);

  // Conflicts resolution state: map of key -> 'profile' | 'document'
  const [conflictChoices, setConflictChoices] = useState<Record<string, 'profile' | 'document'>>({});

  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    loadVaultProfiles();
  }, []);

  useEffect(() => {
    if (propFacts && propFacts.length > 0 && docFacts.length === 0) {
      setDocFacts(propFacts);
      if (propDocumentName && !uploadedDocName) setUploadedDocName(propDocumentName);
      if (propDocumentSize && !uploadedDocSize) setUploadedDocSize(propDocumentSize);
    }
  }, [propFacts, propDocumentName, propDocumentSize]);

  const loadVaultProfiles = async () => {
    try {
      const list = await bridge.vaultGetProfiles();
      setProfiles(list);
      if (list.length > 0) {
        setSelectedProfileId(list[0].id);
      }
    } catch (err) {
      console.error('Failed to load profiles for session launcher', err);
    }
  };

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);

  // Convert vault profile fields to ExtractedFacts
  const getProfileFacts = (): ExtractedFact[] => {
    if (!selectedProfile) return [];
    const result: ExtractedFact[] = [];
    selectedProfile.sections.forEach((sec) => {
      sec.fields.forEach((f) => {
        if (!f.value) return;
        const isId = sec.id === 'id_numbers' || Boolean(f.sensitive);
        if (isId && !fillIdFields) return; // Omit ID fields if permission not granted

        result.push({
          key: f.key,
          label: f.label || f.key,
          value: f.value,
          confidence: 1.0,
          source_page: null,
        });
      });
    });
    return result;
  };

  // Get active document facts, filtering ID fields if fillIdFields is false
  const getFilteredDocFacts = (): ExtractedFact[] => {
    const idRegex = /(ssn|passport|aadhaar|tax_id|id_number|national_id)/i;
    return docFacts.filter((f) => {
      if (idRegex.test(f.key) && !fillIdFields) return false;
      return true;
    });
  };

  const profileFacts = getProfileFacts();
  const currentDocFacts = getFilteredDocFacts();

  // Find conflicts between Profile and Document facts
  const conflicts: Array<{ key: string; label: string; profileVal: string; docVal: string }> = [];
  if (dataSourceMode === 'both') {
    profileFacts.forEach((pFact) => {
      const dFact = currentDocFacts.find((df) => df.key === pFact.key);
      if (dFact && dFact.value.trim() !== pFact.value.trim()) {
        conflicts.push({
          key: pFact.key,
          label: pFact.label || pFact.key,
          profileVal: pFact.value,
          docVal: dFact.value,
        });
      }
    });
  }

  // Combine final facts to be used for the session
  const getFinalFacts = (): ExtractedFact[] => {
    if (dataSourceMode === 'profile') return profileFacts;
    if (dataSourceMode === 'document') return currentDocFacts;

    // Both mode: merge with conflict resolutions
    const factMap = new Map<string, ExtractedFact>();

    // Add profile facts first
    profileFacts.forEach((pf) => factMap.set(pf.key, pf));

    // Overlay document facts
    currentDocFacts.forEach((df) => {
      if (factMap.has(df.key)) {
        const choice = conflictChoices[df.key] || 'document'; // default to document if not chosen
        if (choice === 'document') {
          factMap.set(df.key, df);
        }
      } else {
        factMap.set(df.key, df);
      }
    });

    return Array.from(factMap.values());
  };

  const finalFacts = getFinalFacts();

  const handleSelectDocFile = async () => {
    setLocalError(null);
    try {
      const sel = await bridge.selectDocument();
      if (sel.canceled || !sel.filePath) return;

      setUploadedDocName(sel.fileName || 'document.pdf');
      setUploadedDocPath(sel.filePath);
      setUploadedDocSize(sel.fileSize || 0);

      setIsExtractingDoc(true);
      const res = await bridge.extractDocument({
        filePath: sel.filePath,
        documentName: sel.fileName,
      });

      if ('error' in res) {
        setLocalError(res.error);
        setDocFacts([]);
        onSetFacts([]);
      } else {
        const extracted = res.facts || [];
        setDocFacts(extracted);
        onSetFacts(extracted);
      }
    } catch (err: any) {
      setLocalError(err?.message || 'Document selection error');
    } finally {
      setIsExtractingDoc(false);
    }
  };

  const isValidUrl = Boolean(
    targetUrl.trim() && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))
  );

  const isRunning =
    state === 'EXTRACTING_DOC' ||
    state === 'SCANNING_FORM' ||
    state === 'MAPPING_FIELDS' ||
    state === 'CLARIFICATION_REQUIRED' ||
    state === 'FILLING_FORM' ||
    state === 'VERIFYING';

  const canStart = finalFacts.length > 0 && isValidUrl && state === 'IDLE';

  let disabledReason = '';
  if (finalFacts.length === 0) {
    if (dataSourceMode === 'profile' && !selectedProfile) disabledReason = 'No profile selected';
    else if (dataSourceMode === 'document' && !uploadedDocPath) disabledReason = 'Upload a document first';
    else disabledReason = 'Select profile or upload document data first';
  } else if (!isValidUrl) {
    disabledReason = 'Enter a valid http(s) target form URL';
  } else if (state !== 'IDLE') {
    disabledReason = 'Session is already active';
  }

  const handleStart = async () => {
    if (!canStart) return;
    setLocalError(null);

    const docPath = dataSourceMode !== 'profile' ? uploadedDocPath : undefined;
    const docName = dataSourceMode !== 'profile' ? uploadedDocName : undefined;

    const res = await bridge.startSession({
      documentPath: docPath,
      documentName: docName,
      facts: finalFacts,
      targetUrl,
      fillIdFields,
    });

    onSetFacts(finalFacts);

    if (!res.success && res.error) {
      setLocalError(res.error);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Page Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Play size={22} color="#16654E" />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F2E23' }}>New Automation Session</h1>
        </div>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Configure your data source and target web form URL to launch AI form filling under your review.
        </p>
      </div>

      {(propInlineError || localError) && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            color: '#991B1B',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <AlertCircle size={18} />
          <span>{localError || propInlineError}</span>
        </div>
      )}

      {/* Launcher Configuration Card */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
          padding: '28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.02)',
        }}
      >
        {/* Step 1: Data Source Selection */}
        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F2E23', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={18} color="#16654E" />
            <span>1. Select Data Source</span>
          </label>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Choose whether to use saved profile facts, an uploaded document, or combine both.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '14px' }}>
            {[
              { mode: 'profile' as DataSourceMode, title: 'Saved Profile', desc: 'Use facts from your Encrypted Vault profile', icon: <User size={20} /> },
              { mode: 'document' as DataSourceMode, title: 'Upload Document', desc: 'Extract facts directly from a PDF or image', icon: <UploadCloud size={20} /> },
              { mode: 'both' as DataSourceMode, title: 'Both (Merged)', desc: 'Combine Vault profile + Document with conflict resolution', icon: <Layers size={20} /> },
            ].map((option) => {
              const isSelected = dataSourceMode === option.mode;
              return (
                <div
                  key={option.mode}
                  onClick={() => setDataSourceMode(option.mode)}
                  style={{
                    padding: '16px',
                    borderRadius: 'var(--radius-md)',
                    border: `2px solid ${isSelected ? '#16654E' : 'var(--border-subtle)'}`,
                    background: isSelected ? 'rgba(22, 101, 78, 0.05)' : 'var(--bg-app)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: isSelected ? '#16654E' : '#475569' }}>
                    {option.icon}
                    {isSelected && <CheckCircle2 size={18} color="#16654E" />}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: isSelected ? '#0F2E23' : 'var(--text-primary)' }}>
                    {option.title}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {option.desc}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Data Source Configuration Details */}
        {(dataSourceMode === 'profile' || dataSourceMode === 'both') && (
          <div style={{ padding: '16px', background: 'var(--bg-app)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
              Select Active Vault Profile
            </label>
            <select
              value={selectedProfileId}
              onChange={(e) => setSelectedProfileId(e.target.value)}
              style={{
                width: '100%',
                marginTop: '6px',
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-card)',
                fontSize: '0.875rem',
                fontWeight: 600,
              }}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sections.reduce((acc, s) => acc + s.fields.filter((f) => Boolean(f.value)).length, 0)} fields)
                </option>
              ))}
            </select>
          </div>
        )}

        {(dataSourceMode === 'document' || dataSourceMode === 'both') && (
          <div style={{ padding: '16px', background: 'var(--bg-app)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  Uploaded Document
                </div>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px' }}>
                  {uploadedDocName ? `${uploadedDocName} (${(uploadedDocSize / 1024).toFixed(0)} KB)` : 'No document selected'}
                </div>
              </div>
              <button
                onClick={handleSelectDocFile}
                disabled={isExtractingDoc}
                style={{
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid #16654E',
                  background: '#16654E',
                  color: '#FFFFFF',
                  fontSize: '0.8125rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {isExtractingDoc ? <RotateCw size={14} className="animate-spin" /> : <UploadCloud size={14} />}
                <span>{uploadedDocName ? 'Change Document' : 'Choose Document'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Conflicts resolution card (Both mode only) */}
        {dataSourceMode === 'both' && conflicts.length > 0 && (
          <div
            style={{
              padding: '16px',
              background: '#FFFBEB',
              borderRadius: 'var(--radius-md)',
              border: '1px solid #FCD34D',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#B45309' }}>
              <AlertTriangle size={18} />
              <span style={{ fontWeight: 700, fontSize: '0.875rem' }}>
                {conflicts.length} Fact Conflict(s) Detected
              </span>
            </div>
            <p style={{ fontSize: '0.8125rem', color: '#92400E' }}>
              The profile and document contain different values for the following fields. Choose which value to use:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {conflicts.map((c) => {
                const choice = conflictChoices[c.key] || 'document';
                return (
                  <div
                    key={c.key}
                    style={{
                      padding: '10px 12px',
                      background: '#FFFFFF',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid #FDE68A',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                    }}
                  >
                    <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0F2E23' }}>
                      {c.label} ({c.key}):
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setConflictChoices((prev) => ({ ...prev, [c.key]: 'profile' }))}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 'var(--radius-sm)',
                          border: `1px solid ${choice === 'profile' ? '#16654E' : '#CBD5E1'}`,
                          background: choice === 'profile' ? '#F0FDF4' : '#FFFFFF',
                          color: choice === 'profile' ? '#16654E' : '#475569',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Profile: "{c.profileVal}"
                      </button>
                      <button
                        type="button"
                        onClick={() => setConflictChoices((prev) => ({ ...prev, [c.key]: 'document' }))}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 'var(--radius-sm)',
                          border: `1px solid ${choice === 'document' ? '#16654E' : '#CBD5E1'}`,
                          background: choice === 'document' ? '#F0FDF4' : '#FFFFFF',
                          color: choice === 'document' ? '#16654E' : '#475569',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Doc: "{c.docVal}"
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 2: Target Web Form Link */}
        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F2E23', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Globe size={18} color="#16654E" />
            <span>2. Target Web Form URL</span>
          </label>
          <input
            type="url"
            value={targetUrl}
            onChange={(e) => onSetTargetUrl(e.target.value)}
            placeholder="https://example.com/admission-form"
            style={{
              width: '100%',
              marginTop: '8px',
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-app)',
              fontSize: '0.9375rem',
              fontWeight: 600,
            }}
          />
        </div>

        {/* Step 3: Runtime ID Fields Permission Checkbox */}
        <div
          style={{
            padding: '14px 16px',
            background: 'var(--bg-app)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <input
            type="checkbox"
            id="fill_id_permission"
            checked={fillIdFields}
            onChange={(e) => setFillIdFields(e.target.checked)}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
          <div>
            <label htmlFor="fill_id_permission" style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F2E23', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Shield size={16} color="#16654E" />
              <span>Fill these ID fields?</span>
            </label>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Explicitly allow the agent to populate SSN, Aadhaar, Passport, or Tax ID numbers on this form.
            </p>
          </div>
        </div>

        {/* Facts Summary & Action Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '20px' }}>
          <div>
            <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F2E23' }}>
              Ready to Fill: {finalFacts.length} Facts
            </div>
            {!canStart && (
              <div style={{ fontSize: '0.75rem', color: '#DC2626', fontWeight: 600, marginTop: '2px' }}>
                Reason: {disabledReason}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {(isRunning || state === 'REVIEW_READY' || state === 'PAUSED' || state === 'USER_TAKEOVER') && onStopSession && (
              <button
                onClick={onStopSession}
                style={{
                  padding: '12px 20px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid #DC2626',
                  background: '#FEF2F2',
                  color: '#DC2626',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>Stop Session</span>
              </button>
            )}

            <button
              onClick={handleStart}
              disabled={!canStart || isRunning}
              style={{
                padding: '12px 28px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: canStart && !isRunning ? '#16654E' : '#94A3B8',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '0.9375rem',
                cursor: canStart && !isRunning ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: canStart ? '0 4px 14px rgba(22, 101, 78, 0.3)' : 'none',
              }}
            >
              {isRunning ? (
                <>
                  <RotateCw size={18} className="animate-spin" />
                  <span>Session Active...</span>
                </>
              ) : (
                <>
                  <Play size={18} />
                  <span>Start Automation</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
