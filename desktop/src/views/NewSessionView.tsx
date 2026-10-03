import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bus,
  Calendar,
  Check,
  CheckCircle2,
  CircleDot,
  Edit3,
  ExternalLink,
  FileText,
  Globe,
  GraduationCap,
  Mail,
  MapPin,
  Phone,
  Play,
  RotateCw,
  UploadCloud,
  User,
} from 'lucide-react';
import { hasElectronBridge } from '../lib/bridge';
import type { AgentEventPayload, ExtractedFact, WorkflowState } from '../types/autofiller';

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
}

export const NewSessionView: React.FC<NewSessionViewProps> = ({
  state,
  documentName,
  documentSize,
  facts,
  targetUrl,
  instruction,
  events,
  inlineError,
  isExtracting,
  canStart,
  disabledReason,
  onSelectDocument,
  onStartSession,
  onSetFacts,
  onSetTargetUrl,
  onSetInstruction,
}) => {
  const [isEditingFacts, setIsEditingFacts] = useState<boolean>(false);

  const isRunning =
    state === 'EXTRACTING_DOC' ||
    state === 'SCANNING_FORM' ||
    state === 'MAPPING_FIELDS' ||
    state === 'FILLING_FORM' ||
    state === 'VERIFYING';

  const isReviewReady = state === 'REVIEW_READY' || state === 'COMPLETED';

  // Count filled fields from events
  const fieldsFilledCount = events.filter(
    (e) =>
      e.type === 'TOOL_COMPLETED' &&
      e.success === true &&
      ['fill_text', 'select_option', 'select_radio', 'set_checkbox'].includes(e.tool || '')
  ).length;

  const getFactIcon = (label: string) => {
    const l = label.toLowerCase();
    if (l.includes('name')) return <User size={15} color="#475569" />;
    if (l.includes('birth') || l.includes('dob')) return <Calendar size={15} color="#475569" />;
    if (l.includes('email')) return <Mail size={15} color="#475569" />;
    if (l.includes('phone') || l.includes('contact')) return <Phone size={15} color="#475569" />;
    if (l.includes('gender')) return <User size={15} color="#475569" />;
    if (l.includes('class') || l.includes('grade')) return <GraduationCap size={15} color="#475569" />;
    if (l.includes('city') || l.includes('address')) return <MapPin size={15} color="#475569" />;
    if (l.includes('allerg')) return <AlertTriangle size={15} color="#475569" />;
    if (l.includes('transport')) return <Bus size={15} color="#475569" />;
    return <FileText size={15} color="#475569" />;
  };

  const timelineSteps = [
    {
      title: 'Document processed',
      desc: documentName ? `${documentName} (${(documentSize / 1024).toFixed(0)} KB)` : 'Pending upload',
      done: Boolean(documentName && facts.length > 0),
    },
    {
      title: 'Information extracted',
      desc: facts.length > 0 ? `${facts.length} facts extracted` : 'Pending extraction',
      done: facts.length > 0,
    },
    {
      title: 'Form opened',
      desc: state === 'IDLE' ? 'Pending' : 'Browser connected',
      done: state !== 'IDLE' && state !== 'EXTRACTING_DOC',
    },
    {
      title: 'Fields detected',
      desc: isRunning || isReviewReady ? 'DOM form fields discovered' : 'Pending',
      done: isRunning || isReviewReady,
    },
    {
      title: 'Information mapped',
      desc:
        state === 'FILLING_FORM' || state === 'VERIFYING' || isReviewReady
          ? 'Mapped with Gemini AI'
          : 'Pending',
      done: state === 'FILLING_FORM' || state === 'VERIFYING' || isReviewReady,
    },
    {
      title: 'Form filled',
      desc: isReviewReady ? 'Completed' : state === 'FILLING_FORM' ? 'In progress...' : 'Pending',
      done: isReviewReady,
    },
    {
      title: 'Values verified',
      desc: isReviewReady ? 'Verified against document' : state === 'VERIFYING' ? 'In progress...' : 'Pending',
      done: isReviewReady,
    },
    {
      title: 'REVIEW READY',
      desc: isReviewReady ? 'Ready for human review' : 'Pending',
      done: isReviewReady,
      active: isReviewReady,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Desktop Bridge Unavailable Banner */}
      {!hasElectronBridge && (
        <div
          style={{
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            borderRadius: 'var(--radius-md)',
            padding: '14px 20px',
            color: '#991B1B',
            fontWeight: 700,
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <AlertCircle size={20} />
          <span>Desktop bridge unavailable. Run the app through Electron to automate forms.</span>
        </div>
      )}

      {/* Inline Real Error Alert */}
      {inlineError && (
        <div
          style={{
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            borderRadius: 'var(--radius-md)',
            padding: '12px 18px',
            color: '#991B1B',
            fontSize: '0.875rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={18} />
            <span>{inlineError}</span>
          </div>
        </div>
      )}

      {/* 3 Step Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '20px',
        }}
      >
        {/* Step Card 1: Document Upload */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minWidth: 0,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: '#16654E',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                1
              </div>
              <div>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>
                  Document Upload
                </h3>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {documentName ? '✓ File selected' : 'Upload student document'}
                </div>
              </div>
            </div>

            <div
              onClick={onSelectDocument}
              style={{
                border: '1.5px dashed #B0C4B8',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                textAlign: 'center',
                background: '#F9F8F5',
                cursor: 'pointer',
                marginBottom: '10px',
                transition: 'all 0.2s',
              }}
            >
              <UploadCloud size={24} color="#16654E" style={{ margin: '0 auto 6px auto' }} />
              <div
                style={{
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: '#0F2E23',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {documentName || 'Click to select PDF or image...'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                {documentSize > 0
                  ? `${(documentSize / 1024).toFixed(0)} KB`
                  : 'PDF, PNG, JPG, WebP'}
              </div>
            </div>
          </div>

          {facts.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#D9EFE0',
                border: '1px solid #B7E3C4',
                borderRadius: 'var(--radius-md)',
                padding: '8px 12px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#0F4C3A',
              }}
            >
              <span>✓ {facts.length} facts extracted</span>
              <button
                onClick={onSelectDocument}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#16654E',
                  fontWeight: 700,
                }}
              >
                Change
              </button>
            </div>
          )}
        </div>

        {/* Step Card 2: Target Form */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minWidth: 0,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: '#8B5A2B',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                2
              </div>
              <div>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>
                  Target Form
                </h3>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Website URL</div>
              </div>
            </div>

            <div style={{ position: 'relative', marginBottom: '10px' }}>
              <Globe
                size={16}
                style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-muted)' }}
              />
              <input
                type="text"
                value={targetUrl}
                onChange={(e) => onSetTargetUrl(e.target.value)}
                placeholder="http://127.0.0.1:8000/mock_school_form.html"
                style={{
                  width: '100%',
                  padding: '9px 12px 9px 36px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  background: '#F9F8F5',
                  fontSize: '0.8125rem',
                  fontFamily: 'var(--font-mono)',
                  color: '#0F2E23',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => onSetTargetUrl('http://127.0.0.1:8000/mock_school_form.html')}
              style={{
                flex: 1,
                padding: '8px 10px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid #16654E',
                background: '#D9EFE0',
                color: '#0F4C3A',
                fontWeight: 700,
                fontSize: '0.75rem',
                cursor: 'pointer',
              }}
            >
              ⚡ Use Demo Form
            </button>
            <button
              onClick={() => window.open(targetUrl, '_blank')}
              disabled={!targetUrl}
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid #DED8CB',
                background: 'var(--accent-tan-bg)',
                color: '#0F2E23',
                fontWeight: 600,
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: targetUrl ? 'pointer' : 'not-allowed',
              }}
            >
              <ExternalLink size={14} />
              <span>Open</span>
            </button>
          </div>
        </div>

        {/* Step Card 3: Instruction */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minWidth: 0,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: '#2563EB',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                3
              </div>
              <div>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>
                  Operator Instruction
                </h3>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  What should the agent do?
                </div>
              </div>
            </div>

            <textarea
              value={instruction}
              onChange={(e) => onSetInstruction(e.target.value)}
              rows={3}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                background: '#F9F8F5',
                fontSize: '0.8125rem',
                color: '#0F2E23',
                outline: 'none',
                resize: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
            <span
              onClick={() => onSetInstruction('Fill student admission form with extracted facts.')}
              style={{
                fontSize: '0.6875rem',
                background: '#EFF6FF',
                color: '#1D4ED8',
                padding: '3px 8px',
                borderRadius: '12px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              + Student Admission
            </span>
            <span
              onClick={() => onSetInstruction('Extract details and fill school registration form.')}
              style={{
                fontSize: '0.6875rem',
                background: '#F5F3FF',
                color: '#6D28D9',
                padding: '3px 8px',
                borderRadius: '12px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              + School Registration
            </span>
          </div>
        </div>
      </div>

      {/* Primary Action Button Bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <button
          onClick={onStartSession}
          disabled={!canStart}
          style={{
            width: '100%',
            padding: '16px',
            borderRadius: 'var(--radius-md)',
            background: canStart ? '#16654E' : '#94A3B8',
            color: '#FFFFFF',
            border: 'none',
            fontWeight: 800,
            fontSize: '1.125rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            cursor: canStart ? 'pointer' : 'not-allowed',
            boxShadow: canStart ? '0 6px 20px -4px rgba(22, 101, 78, 0.4)' : 'none',
            transition: 'all 0.2s',
          }}
        >
          <Play size={20} fill="#FFFFFF" />
          <span>{isRunning ? 'AutoFiller Agent In Progress...' : 'Start Automation'}</span>
          <ArrowRight size={20} />
        </button>

        {!canStart && disabledReason && (
          <div
            style={{
              fontSize: '0.75rem',
              color: '#991B1B',
              textAlign: 'center',
              fontWeight: 600,
            }}
          >
            ⚠️ {disabledReason}
          </div>
        )}
      </div>

      {/* Lower Workspace Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '24px',
        }}
      >
        {/* Left Column: Facts + Honest Status Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Extracted Facts Card */}
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px',
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-card)',
              minWidth: 0,
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
                <FileText size={18} color="#16654E" />
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>
                  Extracted Document Facts
                </h3>
              </div>
              {facts.length > 0 && (
                <button
                  onClick={() => setIsEditingFacts(!isEditingFacts)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid #DED8CB',
                    background: isEditingFacts ? '#16654E' : '#F4F1EA',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: isEditingFacts ? '#FFFFFF' : '#0F2E23',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    cursor: 'pointer',
                  }}
                >
                  <Edit3 size={13} />
                  <span>{isEditingFacts ? 'Done' : 'Edit'}</span>
                </button>
              )}
            </div>

            {isExtracting ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '32px 16px',
                  color: '#16654E',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                }}
              >
                <RotateCw size={24} className="spinning" style={{ margin: '0 auto 8px auto' }} />
                <div>Extracting facts from document...</div>
              </div>
            ) : facts.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '32px 16px',
                  color: 'var(--text-muted)',
                  fontSize: '0.8125rem',
                  background: '#F9F8F5',
                  borderRadius: 'var(--radius-md)',
                  border: '1px dashed var(--border-subtle)',
                }}
              >
                No document facts loaded. Select a document above to extract its facts.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {facts.map((fact, index) => (
                  <div
                    key={fact.key || index}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                      borderBottom: '1px solid #F1ECE3',
                      fontSize: '0.8125rem',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {getFactIcon(fact.label)}
                      <span>{fact.label}</span>
                    </div>
                    {isEditingFacts ? (
                      <input
                        type="text"
                        value={fact.value}
                        onChange={(e) => {
                          const updated = [...facts];
                          updated[index] = { ...fact, value: e.target.value };
                          onSetFacts(updated);
                        }}
                        style={{
                          width: '160px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          border: '1px solid #16654E',
                          fontSize: '0.75rem',
                          color: '#0F2E23',
                          outline: 'none',
                        }}
                      />
                    ) : (
                      <div style={{ fontWeight: 600, color: '#0F2E23' }}>{fact.value}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Honest Status Panel (replaces decorative live browser hero) */}
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px',
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Globe size={18} color="#16654E" />
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>
                  Automation Status & Target Browser
                </h3>
              </div>
              <span
                style={{
                  background: isRunning ? '#FEF3C7' : isReviewReady ? '#D9EFE0' : '#E2E8F0',
                  color: isRunning ? '#92400E' : isReviewReady ? '#0F4C3A' : '#475569',
                  borderRadius: 'var(--radius-full)',
                  padding: '3px 10px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                }}
              >
                {state}
              </span>
            </div>

            <div
              style={{
                background: '#F9F8F5',
                borderRadius: 'var(--radius-md)',
                padding: '14px',
                border: '1px solid var(--border-subtle)',
                fontSize: '0.8125rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Target URL: </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#0F2E23' }}>
                  {targetUrl || '(None)'}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Workflow State: </span>
                <span style={{ fontWeight: 700, color: '#16654E' }}>{state}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Fields Populated: </span>
                <span style={{ fontWeight: 700, color: '#0F2E23' }}>
                  {fieldsFilledCount} / {facts.length}
                </span>
              </div>
            </div>

            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.4,
                background: '#EFF6FF',
                border: '1px solid #BFDBFE',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
              }}
            >
              ℹ️ <strong>Live Browser Note:</strong> Playwright launches a separate Chromium window on your screen to interact with the target form. You can observe the agent as it fills out fields in real time.
            </div>
          </div>
        </div>

        {/* Right Column: Timeline Panel */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minWidth: 0,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
              <CircleDot size={18} color="#16654E" />
              <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>
                Automation Progress
              </h3>
            </div>

            {/* Stepper */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {timelineSteps.map((step, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      background: step.done ? '#16654E' : step.active ? '#2563EB' : '#E2E8F0',
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {step.done ? <Check size={13} strokeWidth={3} /> : <CircleDot size={13} />}
                  </div>
                  <div>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F2E23' }}>
                      {step.title}
                    </div>
                    <div
                      style={{
                        fontSize: '0.6875rem',
                        color: step.done ? '#16654E' : step.active ? '#2563EB' : 'var(--text-muted)',
                        fontWeight: 500,
                      }}
                    >
                      {step.done ? '✓ Completed' : step.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Review Ready Box */}
          {isReviewReady && (
            <div
              style={{
                marginTop: '20px',
                background: '#D9EFE0',
                border: '1.5px solid #16654E',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: '#16654E',
                  color: '#FFFFFF',
                  fontSize: '1.25rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 10px auto',
                }}
              >
                ✓
              </div>
              <div style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#0F4C3A' }}>
                FORM FILLED & VERIFIED
              </div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#16654E', marginTop: '2px' }}>
                Ready for human review.
              </div>

              <button
                onClick={() => window.open(targetUrl, '_blank')}
                style={{
                  width: '100%',
                  marginTop: '14px',
                  padding: '10px',
                  borderRadius: 'var(--radius-md)',
                  background: '#16654E',
                  color: '#FFFFFF',
                  border: 'none',
                  fontWeight: 700,
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <ExternalLink size={14} />
                <span>REVIEW FORM IN BROWSER</span>
              </button>

              <div
                style={{
                  marginTop: '12px',
                  paddingTop: '10px',
                  borderTop: '1px solid #B7E3C4',
                  fontSize: '0.6875rem',
                  color: '#16654E',
                  fontWeight: 600,
                }}
              >
                🔒 Final submission is user-controlled. Review the browser window and submit manually when satisfied.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
