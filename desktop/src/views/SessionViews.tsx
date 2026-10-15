/**
 * SessionViews: Core automation session & history views for AutoFiller AI.
 *
 * Consolidates HomeView, NewSessionView, and HistoryView into a unified session view module.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle,
  CheckCircle2,
  CheckSquare,
  Clock,
  FileText,
  Globe,
  History,
  Layers,
  Play,
  RefreshCw,
  RotateCw,
  Shield,
  Square,
  Trash2,
  UploadCloud,
  User,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { bridge, hasElectronBridge } from '../lib/bridge';
import { deriveFacts } from '../../electron/shared/profileSchema';
import type {
  AgentEventPayload,
  DocumentExtractionStage,
  DocumentRecord,
  ExtractedFact,
  ProfileRecord,
  SessionRecord,
  WorkflowState,
} from '../types/autofiller';

/* ========================================================================= */
/* 1. HomeView Component                                                     */
/* ========================================================================= */

interface HomeViewProps {
  onNewSession: () => void;
  onOpenDocuments: () => void;
  onOpenHistory: () => void;
  onUseDocument: (doc: DocumentRecord) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onNewSession,
  onOpenDocuments,
  onOpenHistory,
  onUseDocument,
}) => {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);

  useEffect(() => {
    bridge.listSessions().then(setSessions).catch(() => []);
    bridge.listDocuments().then(setDocuments).catch(() => []);
  }, []);

  const completedCount = sessions.filter((s) => s.status === 'REVIEW_READY' || s.status === 'COMPLETED').length;
  const totalFields = sessions.reduce((acc, s) => acc + (s.fieldsFilled || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1040px', margin: '0 auto' }}>
      {/* First-Run / No Details Card */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1.5px solid var(--border-focus)',
          padding: '24px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          boxShadow: '0 4px 16px rgba(22, 101, 78, 0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'var(--badge-green-bg)',
              color: 'var(--text-brand)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <User size={24} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--text-title)' }}>
              Add your details once, reuse them on any form
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Save your personal information, address, and contact details encrypted on this device. Field labels are sent to AI for matching; your values stay on this device; uploaded documents are processed by Gemini.
            </p>
          </div>
        </div>

        <button
          onClick={onOpenDocuments}
          style={{
            background: 'var(--status-success)',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: '10px 20px',
            fontSize: '0.875rem',
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Add Your Details
        </button>
      </div>

      {/* 2-Column Split: Recent Documents & Recent History */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Recent Documents Card */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText size={18} color="var(--text-brand)" />
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-title)' }}>
                Processed Documents
              </h3>
            </div>
            <button
              onClick={onOpenDocuments}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-brand)',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              View All ({documents.length})
            </button>
          </div>

          {documents.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '32px 16px',
                color: 'var(--text-muted)',
                fontSize: '0.875rem',
                background: 'var(--bg-surface-subtle)',
                borderRadius: 'var(--radius-md)',
                border: '1px dashed var(--border-subtle)',
              }}
            >
              <FileText size={32} style={{ margin: '0 auto 8px auto', opacity: 0.4 }} />
              <div>No documents processed yet.</div>
              <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>
                Upload a document in a new session to save it here.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {documents.slice(0, 4).map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-surface-subtle)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-title)' }}>
                      {doc.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {doc.facts.length} facts • {(doc.size / 1024).toFixed(0)} KB
                    </div>
                  </div>
                  <button
                    onClick={() => onUseDocument(doc)}
                    style={{
                      background: 'var(--badge-green-bg)',
                      color: 'var(--text-brand)',
                      border: '1px solid var(--badge-green-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '6px 12px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Use Document
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Session History Card */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <History size={18} color="var(--text-brand)" />
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-title)' }}>
                Recent History
              </h3>
            </div>
            <button
              onClick={onOpenHistory}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-brand)',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              View All ({sessions.length})
            </button>
          </div>

          {sessions.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '32px 16px',
                color: 'var(--text-muted)',
                fontSize: '0.875rem',
                background: 'var(--bg-surface-subtle)',
                borderRadius: 'var(--radius-md)',
                border: '1px dashed var(--border-subtle)',
              }}
            >
              <History size={32} style={{ margin: '0 auto 8px auto', opacity: 0.4 }} />
              <div>No past sessions recorded yet.</div>
              <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>
                Completed form fills will automatically appear here.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {sessions.slice(0, 4).map((session) => (
                <div
                  key={session.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-surface-subtle)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-title)' }}>
                      {session.hostAndPath}
                    </div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        marginTop: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '240px',
                      }}
                    >
                      {session.profileName ? `Profile: ${session.profileName}` : new Date(session.date).toLocaleDateString()}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-full)',
                      background:
                        session.status === 'REVIEW_READY' || session.status === 'COMPLETED'
                          ? 'var(--badge-green-bg)'
                          : session.status === 'ERROR'
                          ? 'var(--badge-red-bg)'
                          : 'var(--badge-amber-bg)',
                      color:
                        session.status === 'REVIEW_READY' || session.status === 'COMPLETED'
                          ? 'var(--badge-green-text)'
                          : session.status === 'ERROR'
                          ? 'var(--badge-red-text)'
                          : 'var(--badge-amber-text)',
                    }}
                  >
                    {session.status === 'COMPLETED'
                      ? 'Submitted'
                      : session.status === 'REVIEW_READY'
                      ? 'Review Ready'
                      : session.status === 'IDLE' || session.status === 'INTERRUPTED'
                      ? 'Interrupted'
                      : session.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ========================================================================= */
/* 2. NewSessionView Component                                              */
/* ========================================================================= */

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
  onOpenHistory?: () => void;
  onResetSession?: () => void;
  onConfirmSubmission?: () => void;
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
  canStart: propCanStart,
  disabledReason: propDisabledReason,
  onSetTargetUrl,
  onSetFacts,
  onStopSession,
  onOpenHistory,
  onResetSession,
  onConfirmSubmission,
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
  const [extractionStage, setExtractionStage] = useState<DocumentExtractionStage>('idle');
  const [extractionStageMessage, setExtractionStageMessage] = useState<string>('');

  // ID fields permission
  const [fillIdFields, setFillIdFields] = useState<boolean>(false);

  // Conflicts resolution state: map of key -> 'profile' | 'document'
  const [conflictChoices, setConflictChoices] = useState<Record<string, 'profile' | 'document'>>({});

  const [localError, setLocalError] = useState<string | null>(null);
  const [recheckStatus, setRecheckStatus] = useState<string | null>(null);
  const [isRechecking, setIsRechecking] = useState<boolean>(false);

  useEffect(() => {
    if (state !== 'USER_TAKEOVER') {
      setRecheckStatus(null);
    }
  }, [state]);

  const handleContinueRecheck = async () => {
    setIsRechecking(true);
    setRecheckStatus(null);
    try {
      const res = await bridge.checkBlockerResume();
      if (!res.resolved) {
        setRecheckStatus(res.message || 'Still on a sign-in page');
      } else {
        setRecheckStatus(null);
      }
    } catch {
      setRecheckStatus('Still on a sign-in page');
    } finally {
      setIsRechecking(false);
    }
  };

  useEffect(() => {
    loadVaultProfiles();
  }, []);

  const lastLoadedDocRef = useRef<string>('');

  useEffect(() => {
    if (propFacts && propFacts.length > 0) {
      const docIdentifier = `${propDocumentName || 'doc'}_${propFacts.length}`;
      if (docIdentifier !== lastLoadedDocRef.current || docFacts.length === 0) {
        lastLoadedDocRef.current = docIdentifier;
        setDocFacts(propFacts);
        if (propDocumentName) setUploadedDocName(propDocumentName);
        if (propDocumentSize) setUploadedDocSize(propDocumentSize);
        setDataSourceMode('document');
      }
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

  // Convert vault profile fields to ExtractedFacts with deriveFacts
  const getProfileFacts = (): ExtractedFact[] => {
    if (!selectedProfile) return [];
    const factMap: Record<string, string> = {};
    const labelMap: Record<string, string> = {};

    selectedProfile.sections.forEach((sec) => {
      sec.fields.forEach((f) => {
        if (!f.value) return;
        const isSensitive = sec.id === 'id_numbers' || sec.id === 'bank' || Boolean(f.sensitive);
        if (isSensitive && !fillIdFields) return; // Omit sensitive ID/bank fields if permission not granted

        factMap[f.key] = f.value;
        labelMap[f.key] = f.label || f.key;
      });
    });

    const derived = deriveFacts(factMap);
    const result: ExtractedFact[] = [];
    for (const [key, val] of Object.entries(derived)) {
      if (!val) continue;
      const isSensitive =
        key.includes('aadhaar') ||
        key.includes('pan_card') ||
        key.includes('passport') ||
        key.includes('bank_account') ||
        key.includes('ifsc');
      if (isSensitive && !fillIdFields) continue;

      result.push({
        key,
        label: labelMap[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        value: val,
        confidence: 1.0,
        source_page: null,
      });
    }
    return result;
  };

  // Get active document facts, filtering ID fields if fillIdFields is false
  const getFilteredDocFacts = (): ExtractedFact[] => {
    const idRegex = /(ssn|passport|aadhaar|tax_id|id_number|national_id|bank|ifsc|account_number)/i;
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
      setExtractionStage('extracting_information');
      setExtractionStageMessage('Reading document and extracting facts with AI...');

      const res = await bridge.extractDocument({
        filePath: sel.filePath,
        documentName: sel.fileName,
      });

      if ('error' in res) {
        setExtractionStage('error');
        setExtractionStageMessage(res.error || 'Failed to extract document facts.');
        setLocalError(res.error);
        setDocFacts([]);
        onSetFacts([]);
      } else {
        const extracted = res.facts || [];
        setDocFacts(extracted);
        onSetFacts(extracted);
        setExtractionStage('completed');
        setExtractionStageMessage(`Extraction complete: ${extracted.length} facts organized.`);
      }
    } catch (err: any) {
      setExtractionStage('error');
      setExtractionStageMessage(err?.message || 'Document selection error');
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

  // Derive completion field counts truthfully from latest events if available
  const completionStats = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const meta = events[i]?.metadata;
      if (typeof meta?.verifiedCount === 'number' && typeof meta?.totalFields === 'number') {
        return {
          verifiedCount: meta.verifiedCount as number,
          totalFields: meta.totalFields as number,
        };
      }
    }
    return null;
  })();

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1040px', margin: '0 auto' }}>
      {/* Page Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Play size={22} color="var(--text-brand)" />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-title)' }}>New Automation Session</h1>
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

      {/* Session Completed Banner */}
      {/* Session Completed Banner */}
      {state === 'COMPLETED' && (
        <div
          style={{
            padding: '24px 28px',
            borderRadius: 'var(--radius-lg)',
            background: '#F0FDF4',
            border: '2px solid #86EFAC',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: '0 4px 16px rgba(22, 101, 78, 0.08)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: '#DCFCE7',
                color: 'var(--text-brand)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <CheckCircle2 size={24} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--text-title)' }}>
                Application Submitted Successfully!
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-brand)', marginTop: '2px' }}>
                {completionStats
                  ? `All ${completionStats.verifiedCount} of ${completionStats.totalFields} form fields were verified and submitted. AutoFiller has saved the metadata record to history.`
                  : 'The web form was reviewed and manually submitted by the operator. AutoFiller has finalized the session and safely saved the metadata record.'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', paddingTop: '4px' }}>
            {onOpenHistory && (
              <button
                onClick={onOpenHistory}
                data-testid="view-history-button"
                style={{
                  padding: '10px 20px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: 'var(--status-success)',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 2px 8px rgba(22, 101, 78, 0.25)',
                }}
              >
                <History size={16} />
                <span>View History</span>
              </button>
            )}
            {onResetSession && (
              <button
                onClick={onResetSession}
                style={{
                  padding: '10px 18px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid #A5DCB4',
                  background: '#FFFFFF',
                  color: 'var(--text-title)',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <RotateCw size={14} />
                <span>Start Another Session</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Review Ready Notification Banner */}
      {state === 'REVIEW_READY' && (
        <div
          style={{
            padding: '20px 24px',
            borderRadius: 'var(--radius-lg)',
            background: '#ECFDF5',
            border: '2px solid #6EE7B7',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <CheckCircle2 size={22} color="#047857" />
            <div>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: '#065F46' }}>
                Form Filled & Verified — Ready for Human Review
              </div>
              <div style={{ fontSize: '0.8125rem', color: '#047857', marginTop: '2px' }}>
                Automation has stopped per the Never-Submit safety policy. Please review the filled fields in the browser window and click Submit on the website when ready. AutoFiller will automatically detect submission, or you can confirm below.
              </div>
            </div>
          </div>
          {onConfirmSubmission && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' }}>
              <button
                onClick={onConfirmSubmission}
                data-testid="confirm-submission-button"
                style={{
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid #059669',
                  background: '#059669',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <CheckCircle2 size={14} />
                <span>I Have Submitted</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Human Takeover / Blocker Inline Banner */}
      {state === 'USER_TAKEOVER' && (() => {
        const latestBlockerEvent = [...events].reverse().find((e) => e.metadata?.blockerType);
        const blockerType = latestBlockerEvent?.metadata?.blockerType as string | undefined;

        let takeoverMessage =
          (latestBlockerEvent?.metadata?.plainDescription as string) ||
          "Your turn: sign in in the AutoFiller browser window. I'll continue when the form appears.";
        if (blockerType === 'otp') {
          takeoverMessage = "Your turn: enter the verification code in the AutoFiller browser window. I'll continue when the form appears.";
        } else if (blockerType === 'captcha') {
          takeoverMessage = "Your turn: complete the security check in the AutoFiller browser window. I'll continue when the form appears.";
        } else if (blockerType === 'no-form') {
          takeoverMessage = "Waiting for the form to appear in the AutoFiller browser window. I'll continue when the form appears.";
        }

        return (
          <div
            data-testid="user-takeover-banner"
            style={{
              padding: '20px 24px',
              borderRadius: 'var(--radius-lg)',
              background: '#FFFBEB',
              border: '2px solid #FCD34D',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              boxShadow: '0 4px 16px rgba(245, 158, 11, 0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: '#FEF3C7',
                  color: '#D97706',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <UserCheck size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#92400E', margin: 0 }}>
                  {takeoverMessage}
                </h3>
                {recheckStatus && (
                  <p style={{ fontSize: '0.8125rem', color: '#B45309', fontWeight: 600, marginTop: '4px', marginBottom: 0 }}>
                    {recheckStatus}
                  </p>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', paddingTop: '2px' }}>
              <button
                onClick={handleContinueRecheck}
                disabled={isRechecking}
                data-testid="blocker-continue-button"
                style={{
                  padding: '9px 18px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: '#D97706',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '0.8125rem',
                  cursor: isRechecking ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 2px 6px rgba(217, 119, 6, 0.25)',
                }}
              >
                <RotateCw size={14} className={isRechecking ? 'animate-spin' : ''} />
                <span>I'm done, continue</span>
              </button>

              {onStopSession && (
                <button
                  onClick={onStopSession}
                  data-testid="blocker-stop-button"
                  style={{
                    padding: '9px 16px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid #F87171',
                    background: '#FEF2F2',
                    color: '#DC2626',
                    fontWeight: 700,
                    fontSize: '0.8125rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Square size={13} fill="currentColor" />
                  <span>Stop</span>
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* 2-Column Responsive Workspace Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.08fr 0.92fr', gap: '20px' }}>
        {/* Left Column: Data Source Configuration (Step 1) */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            padding: '22px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {/* Step 1: Data Source Selection */}
          <div>
            <label style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-title)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={18} color="var(--text-brand)" />
              <span>1. Select Data Source</span>
            </label>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Choose whether to use saved profile facts, an uploaded document, or combine both.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '12px' }}>
              {[
                { mode: 'profile' as DataSourceMode, title: 'Saved Profile', desc: 'Encrypted Vault profile', icon: <User size={18} /> },
                { mode: 'document' as DataSourceMode, title: 'Document', desc: 'PDF or image facts', icon: <UploadCloud size={18} /> },
                { mode: 'both' as DataSourceMode, title: 'Merged', desc: 'Profile + Document', icon: <Layers size={18} /> },
              ].map((option) => {
                const isSelected = dataSourceMode === option.mode;
                return (
                  <div
                    key={option.mode}
                    onClick={() => setDataSourceMode(option.mode)}
                    style={{
                      padding: '12px 10px',
                      borderRadius: 'var(--radius-md)',
                      border: `2px solid ${isSelected ? 'var(--badge-green-text)' : 'var(--border-subtle)'}`,
                      background: isSelected ? 'var(--badge-green-bg)' : 'var(--bg-surface-subtle)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      transition: 'all 0.2s ease',
                      textAlign: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: isSelected ? 'var(--text-brand)' : 'var(--text-secondary)' }}>
                      {option.icon}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '0.8125rem', color: isSelected ? 'var(--text-title)' : 'var(--text-primary)' }}>
                      {option.title}
                    </div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', lineHeight: 1.2 }}>
                      {option.desc}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Data Source Configuration Details */}
          {(dataSourceMode === 'profile' || dataSourceMode === 'both') && (
            <div style={{ padding: '14px', background: 'var(--bg-surface-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                Active Vault Profile
              </label>
              <select
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                style={{
                  width: '100%',
                  marginTop: '6px',
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-card)',
                  fontSize: '0.84375rem',
                  fontWeight: 600,
                  color: 'var(--text-title)',
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
            <div style={{ padding: '14px', background: 'var(--bg-surface-subtle)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                    Uploaded Document
                  </div>
                  <div style={{ fontSize: '0.84375rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px' }}>
                    {uploadedDocName ? `${uploadedDocName} (${(uploadedDocSize / 1024).toFixed(0)} KB)` : 'No document selected'}
                  </div>
                </div>
                <button
                  onClick={handleSelectDocFile}
                  disabled={isExtractingDoc}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-focus)',
                    background: 'var(--status-success)',
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
                  <span>{uploadedDocName ? 'Change' : 'Choose File'}</span>
                </button>
              </div>

              {/* Document Extraction Progress States */}
              {extractionStage !== 'idle' && (
                <div
                  style={{
                    marginTop: '12px',
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    background: extractionStage === 'error' ? '#FEF2F2' : '#F0FDF4',
                    border: `1px solid ${extractionStage === 'error' ? '#FCA5A5' : '#86EFAC'}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {extractionStage === 'completed' && <CheckCircle2 size={16} color="var(--text-brand)" />}
                      {extractionStage === 'error' && <AlertTriangle size={16} color="#DC2626" />}
                      {extractionStage !== 'completed' && extractionStage !== 'error' && (
                        <RotateCw size={16} color="var(--text-brand)" className="animate-spin" />
                      )}
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: '0.8125rem',
                          color: extractionStage === 'error' ? 'var(--status-danger)' : 'var(--text-title)',
                        }}
                      >
                        {extractionStageMessage}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {extractionStage === 'uploading' && '1/4 Uploading'}
                      {extractionStage === 'reading_document' && '2/4 Reading'}
                      {extractionStage === 'extracting_information' && '3/4 Extracting'}
                      {extractionStage === 'organizing_facts' && '4/4 Organizing'}
                      {extractionStage === 'completed' && 'Completed'}
                      {extractionStage === 'error' && 'Error'}
                    </span>
                  </div>

                  {/* Progressive Stage Steps */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                    {[
                      { id: 'uploading', label: '1. Upload' },
                      { id: 'reading_document', label: '2. Read' },
                      { id: 'extracting_information', label: '3. Extract' },
                      { id: 'organizing_facts', label: '4. Organize' },
                    ].map((step, idx) => {
                      const order = ['uploading', 'reading_document', 'extracting_information', 'organizing_facts'];
                      const currentIdx = order.indexOf(extractionStage);
                      const isDone = extractionStage === 'completed' || currentIdx > idx;
                      const isActive = extractionStage === step.id;
                      const isFailed = extractionStage === 'error' && (currentIdx === idx || (currentIdx === -1 && idx === 0));

                      let pillBg = 'rgba(0, 0, 0, 0.04)';
                      let pillColor = 'var(--text-muted)';
                      let pillBorder = 'transparent';

                      if (isDone) {
                        pillBg = '#DCFCE7';
                        pillColor = 'var(--text-brand)';
                        pillBorder = '#86EFAC';
                      } else if (isActive) {
                        pillBg = '#E0F2FE';
                        pillColor = '#0369A1';
                        pillBorder = '#7DD3FC';
                      } else if (isFailed) {
                        pillBg = '#FEE2E2';
                        pillColor = '#991B1B';
                        pillBorder = '#FCA5A5';
                      }

                      return (
                        <div
                          key={step.id}
                          style={{
                            padding: '4px 6px',
                            borderRadius: 'var(--radius-sm)',
                            background: pillBg,
                            color: pillColor,
                            border: `1px solid ${pillBorder}`,
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            textAlign: 'center',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                          }}
                        >
                          {isDone && <CheckCircle2 size={11} />}
                          {isActive && <RotateCw size={11} className="animate-spin" />}
                          <span>{step.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Conflicts resolution card (Both mode only) */}
          {dataSourceMode === 'both' && conflicts.length > 0 && (
            <div
              style={{
                padding: '14px',
                background: '#FFFBEB',
                borderRadius: 'var(--radius-md)',
                border: '1px solid #FCD34D',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#B45309' }}>
                <AlertTriangle size={16} />
                <span style={{ fontWeight: 700, fontSize: '0.8125rem' }}>
                  {conflicts.length} Fact Conflict(s) Detected
                </span>
              </div>
              <p style={{ fontSize: '0.75rem', color: '#92400E' }}>
                Choose which value to use for each conflicting field:
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {conflicts.map((c) => {
                  const choice = conflictChoices[c.key] || 'document';
                  return (
                    <div
                      key={c.key}
                      style={{
                        padding: '8px 10px',
                        background: '#FFFFFF',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid #FDE68A',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                      }}
                    >
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-title)' }}>
                        {c.label}:
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => setConflictChoices((prev) => ({ ...prev, [c.key]: 'profile' }))}
                          style={{
                            padding: '3px 8px',
                            borderRadius: 'var(--radius-sm)',
                            border: `1px solid ${choice === 'profile' ? 'var(--border-focus)' : 'var(--border-subtle)'}`,
                            background: choice === 'profile' ? '#F0FDF4' : '#FFFFFF',
                            color: choice === 'profile' ? 'var(--text-brand)' : 'var(--text-secondary)',
                            fontSize: '0.6875rem',
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
                            padding: '3px 8px',
                            borderRadius: 'var(--radius-sm)',
                            border: `1px solid ${choice === 'document' ? 'var(--border-focus)' : 'var(--border-subtle)'}`,
                            background: choice === 'document' ? '#F0FDF4' : '#FFFFFF',
                            color: choice === 'document' ? 'var(--text-brand)' : 'var(--text-secondary)',
                            fontSize: '0.6875rem',
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
        </div>

        {/* Right Column: Form Target & Launch Execution (Steps 2 & 3) */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            padding: '22px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {/* Step 2: Target Web Form Link */}
          <div>
            <label style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-title)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Globe size={18} color="var(--text-brand)" />
              <span>2. Target Web Form URL</span>
            </label>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Paste the public application or registration form URL.
            </p>
            <input
              type="url"
              value={targetUrl}
              onChange={(e) => onSetTargetUrl(e.target.value)}
              placeholder="https://example.com/admission-form"
              style={{
                width: '100%',
                marginTop: '8px',
                padding: '10px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-surface-subtle)',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: 'var(--text-title)',
              }}
            />
          </div>

          {/* Step 3: Runtime ID Fields Permission Checkbox */}
          <div
            style={{
              padding: '12px 14px',
              background: 'var(--bg-surface-subtle)',
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
              <label htmlFor="fill_id_permission" style={{ fontSize: '0.84375rem', fontWeight: 700, color: 'var(--text-title)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Shield size={15} color="var(--text-brand)" />
                <span>Fill ID & sensitive numbers?</span>
              </label>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                Explicitly permit agent to fill SSN, Aadhaar, Passport, or Tax ID numbers.
              </p>
            </div>
          </div>

          {/* Pre-flight Ready Facts Summary Panel */}
          <div
            style={{
              marginTop: 'auto',
              padding: '14px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-surface-subtle)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                Preflight Facts Check
              </span>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  background: finalFacts.length > 0 ? 'var(--badge-green-bg)' : 'var(--badge-amber-bg)',
                  color: finalFacts.length > 0 ? 'var(--badge-green-text)' : 'var(--badge-amber-text)',
                }}
              >
                {finalFacts.length} Facts Ready
              </span>
            </div>

            {!canStart && (
              <div style={{ fontSize: '0.75rem', color: '#DC2626', fontWeight: 600 }}>
                {disabledReason}
              </div>
            )}
          </div>

          {/* Launch Action Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '4px' }}>
            {(isRunning || state === 'REVIEW_READY' || state === 'PAUSED' || state === 'USER_TAKEOVER') && onStopSession && (
              <button
                onClick={onStopSession}
                style={{
                  padding: '11px 18px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid #DC2626',
                  background: '#FEF2F2',
                  color: '#DC2626',
                  fontWeight: 700,
                  fontSize: '0.84375rem',
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
                flex: 1,
                padding: '11px 22px',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: canStart && !isRunning ? 'var(--accent-primary)' : 'var(--text-muted)',
                color: '#FFFFFF',
                fontWeight: 800,
                fontSize: '0.90625rem',
                cursor: canStart && !isRunning ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: canStart ? '0 4px 14px rgba(22, 101, 78, 0.25)' : 'none',
                transition: 'all 0.2s ease',
              }}
            >
              {isRunning ? (
                <>
                  <RotateCw size={17} className="animate-spin" />
                  <span>Session Active...</span>
                </>
              ) : state === 'COMPLETED' ? (
                <>
                  <CheckCircle2 size={17} />
                  <span>Submitted</span>
                </>
              ) : (
                <>
                  <Play size={17} />
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

/* ========================================================================= */
/* 3. HistoryView Component                                                 */
/* ========================================================================= */

export const HistoryView: React.FC = () => {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const list = await bridge.listSessions();
      setSessions(list);
      setSelectedIds(new Set());
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const toggleSelectAll = () => {
    if (selectedIds.size === sessions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sessions.map((s) => s.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleDeleteOne = async (id: string) => {
    await bridge.deleteHistorySession(id);
    await loadHistory();
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    await bridge.deleteHistorySessions(Array.from(selectedIds));
    await loadHistory();
  };

  const handleClearAll = async () => {
    await bridge.clearAllHistory();
    setShowClearConfirm(false);
    await loadHistory();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#F0FDF4', color: 'var(--text-brand)', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid var(--badge-green-border)' }}>
            <CheckCircle size={12} />
            <span>Submitted</span>
          </span>
        );
      case 'REVIEW_READY':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#ECFDF5', color: '#047857', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid var(--badge-green-border)' }}>
            <CheckCircle size={12} />
            <span>Review Ready</span>
          </span>
        );
      case 'ERROR':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#FEF2F2', color: '#991B1B', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid #FCA5A5' }}>
            <XCircle size={12} />
            <span>Error</span>
          </span>
        );
      case 'INTERRUPTED':
      case 'IDLE':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#FFFBEB', color: '#B45309', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid #FCD34D' }}>
            <Clock size={12} />
            <span>Interrupted</span>
          </span>
        );
      default:
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#F1F5F9', color: '#475569', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid #CBD5E1' }}>
            <span>{status}</span>
          </span>
        );
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1040px', margin: '0 auto' }}>
      {/* Header & Global Actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History size={22} color="var(--text-brand)" />
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-title)' }}>Session History</h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Metadata records of past automation runs (strictly value-free).
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {selectedIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              style={{
                background: '#FEF2F2',
                color: '#DC2626',
                border: '1px solid #FCA5A5',
                borderRadius: 'var(--radius-md)',
                padding: '8px 14px',
                fontSize: '0.8125rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Trash2 size={14} />
              <span>Delete Selected ({selectedIds.size})</span>
            </button>
          )}

          {sessions.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              style={{
                background: 'var(--bg-card)',
                color: '#DC2626',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 14px',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Trash2 size={14} />
              <span>Clear All</span>
            </button>
          )}

          <button
            onClick={loadHistory}
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '8px 14px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'var(--text-title)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading metadata records...
        </div>
      ) : sessions.length === 0 ? (
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '48px 24px',
            textAlign: 'center',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <History size={48} color="var(--text-brand)" style={{ margin: '0 auto 12px auto', opacity: 0.4 }} />
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-title)' }}>No Session History Found</h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Start an automation session to view run metadata here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Select All Bar */}
          <div
            style={{
              padding: '10px 16px',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'var(--text-secondary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={toggleSelectAll}>
              {selectedIds.size === sessions.length ? <CheckSquare size={16} color="var(--text-brand)" /> : <Square size={16} color="#94A3B8" />}
              <span>Select All ({sessions.length} sessions)</span>
            </div>
            <span>Showing Metadata Only (Privacy Safe)</span>
          </div>

          {/* Session Record List */}
          {sessions.map((session) => {
            const isSelected = selectedIds.has(session.id);
            return (
              <div
                key={session.id}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px 20px',
                  border: `1px solid ${isSelected ? '#86EFAC' : 'var(--border-subtle)'}`,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div onClick={() => toggleSelect(session.id)} style={{ cursor: 'pointer', flexShrink: 0 }}>
                    {isSelected ? <CheckSquare size={18} color="var(--text-brand)" /> : <Square size={18} color="#94A3B8" />}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.9375rem', color: 'var(--text-title)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Globe size={15} color="var(--text-brand)" />
                        {session.hostAndPath}
                      </span>
                      {getStatusBadge(session.status)}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '0.75rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Calendar size={13} />
                        {new Date(session.date).toLocaleString()}
                      </span>
                      {session.profileName && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <User size={13} />
                          Profile: {session.profileName}
                        </span>
                      )}
                      {session.dataSource && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Layers size={13} />
                          Source: {session.dataSource}
                        </span>
                      )}
                    </div>

                    {session.error && (
                      <div style={{ fontSize: '0.75rem', color: '#991B1B', marginTop: '2px' }}>
                        Reason: {session.error}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.9375rem', fontWeight: 800, color: 'var(--text-brand)' }}>
                      {session.fieldsFilled} {session.totalFields ? `/ ${session.totalFields}` : ''}
                    </div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Fields Filled</div>
                  </div>

                  <button
                    onClick={() => handleDeleteOne(session.id)}
                    title="Delete session metadata"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#DC2626',
                      cursor: 'pointer',
                      padding: '6px',
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Clear All Confirmation Modal */}
      {showClearConfirm && (
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
          <div
            style={{
              maxWidth: '420px',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#DC2626' }}>
              <AlertTriangle size={24} />
              <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: 'var(--text-title)' }}>Clear All History?</h3>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              This will permanently delete all metadata session records. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button
                onClick={() => setShowClearConfirm(false)}
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
                onClick={handleClearAll}
                style={{
                  padding: '8px 20px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: '#DC2626',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Yes, Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
