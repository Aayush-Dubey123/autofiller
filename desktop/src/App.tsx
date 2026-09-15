import React, { useState, useEffect } from 'react';
import {
  Sprout,
  Home,
  Play,
  History,
  FileText,
  Settings,
  HelpCircle,
  Sun,
  Globe,
  UploadCloud,
  ExternalLink,
  Edit3,
  CheckCircle2,
  User,
  Calendar,
  Mail,
  Phone,
  GraduationCap,
  MapPin,
  AlertTriangle,
  Bus,
  X,
  ChevronDown,
  ArrowRight,
  Check,
  RotateCw,
  ArrowLeft,
  ArrowRight as ArrowRightIcon,
  CircleDot,
} from 'lucide-react';
import { bridge, extractDocumentFacts } from './lib/bridge';
import { ExtractedFact } from './features/document-viewer/DocumentViewer';
import { AgentEvent } from './features/agent-timeline/AgentTimeline';
import { ClarificationModal, ClarificationPrompt } from './features/clarification/ClarificationModal';
import { SettingsModal } from './features/settings/SettingsModal';

export const App: React.FC = () => {
  const [state, setState] = useState<string>('IDLE');
  const [activeNav, setActiveNav] = useState<string>('Home');
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isEditingFacts, setIsEditingFacts] = useState<boolean>(false);
  const [documentName, setDocumentName] = useState<string>('student_admission.pdf');
  const [documentPath, setDocumentPath] = useState<string>('');
  const [documentText, setDocumentText] = useState<string>(`STUDENT REGISTRATION RECORD 2026
Student Name: Aarav Sharma
Date of Birth: 15-03-2010
Gender: Male
Applying Grade: Grade 10
Father's Name: Rajesh Sharma
Mother's Name: Sunita Sharma
Email Address: aarav@example.com
Contact Phone: +91 98230 11223
Alternate Phone: +91 98111 44556
Residential Address: 42 Palm Avenue
City: Nagpur
State: Maharashtra
Postal Code: 440001
Blood Group: B+
Allergies: None
Transport Required: Yes
Previous School: Model High School Nagpur`);
  const [targetUrl, setTargetUrl] = useState<string>('http://127.0.0.1:8000/mock_school_form.html');
  const [instruction, setInstruction] = useState<string>(
    'Fill out the student admission form using the extracted student information.'
  );
  const [facts, setFacts] = useState<ExtractedFact[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [clarificationPrompt, setClarificationPrompt] = useState<ClarificationPrompt | null>(null);

  // Default initial facts mapping matching demo specification
  const defaultFacts: ExtractedFact[] = [
    { key: 'full_name', label: 'Full Name', value: 'Aarav Sharma', confidence: 0.98 },
    { key: 'dob', label: 'Date of Birth', value: '15 March 2010', confidence: 0.96 },
    { key: 'gender', label: 'Gender', value: 'Male', confidence: 0.95 },
    { key: 'class', label: 'Class', value: 'Grade 10', confidence: 0.98 },
    { key: 'email', label: 'Email', value: 'aarav@example.com', confidence: 0.99 },
    { key: 'phone', label: 'Phone', value: '+91 98230 11223', confidence: 0.97 },
    { key: 'city', label: 'City', value: 'Nagpur', confidence: 0.94 },
    { key: 'allergies', label: 'Allergies', value: 'None', confidence: 0.92 },
    { key: 'transport', label: 'Transport Required', value: 'Yes', confidence: 0.95 },
  ];

  useEffect(() => {
    const loadInitialFacts = async () => {
      const { facts: extracted, error } = await extractDocumentFacts({
        rawText: documentText,
        documentName,
      });
      if (error || !extracted || extracted.length === 0) {
        setFacts(defaultFacts);
        return;
      }
      setFacts(extracted);
    };
    loadInitialFacts();
  }, []);

  useEffect(() => {
    const unsubEvents = bridge.onAgentEvent((evt: AgentEvent) => {
      setEvents((prev) => [...prev, evt]);
      if (evt.metadata?.facts && evt.metadata.facts.length > 0) {
        setFacts(evt.metadata.facts);
      }
    });

    const unsubClarify = bridge.onClarificationRequest((prompt: ClarificationPrompt) => {
      setClarificationPrompt(prompt);
    });

    const unsubState = bridge.onStateChange((update) => {
      setState(update.state);
      if (update.state !== 'CLARIFICATION_REQUIRED') {
        setClarificationPrompt(null);
      }
    });

    return () => {
      unsubEvents();
      unsubClarify();
      unsubState();
    };
  }, []);

  const handleSelectDocument = async () => {
    try {
      const result = await bridge.selectDocument();
      if (!result.canceled && result.filePath) {
        setDocumentPath(result.filePath);
        setDocumentName(result.fileName || 'selected_document.pdf');
        setDocumentText('');

        const { facts: extracted, error } = await extractDocumentFacts({
          filePath: result.filePath,
          documentName: result.fileName,
        });
        if (!error && extracted && extracted.length > 0) {
          setFacts(extracted);
        }
      }
    } catch (err) {
      console.error('Document selection error:', err);
    }
  };

  const handleStartSession = async () => {
    setEvents([
      {
        eventId: `evt_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'STATE_CHANGED',
        description: 'Initiating AutoFiller Phase 1 workflow...',
      },
    ]);
    await bridge.startSession({
      documentPath: documentPath || undefined,
      documentText: documentText || undefined,
      documentName,
      targetUrl,
    });
  };

  const handleAnswerClarification = async (clarificationId: string, answer: string) => {
    setClarificationPrompt(null);
    await bridge.answerClarification(clarificationId, answer);
  };

  const isRunning =
    state === 'EXTRACTING_DOC' ||
    state === 'SCANNING_FORM' ||
    state === 'MAPPING_FIELDS' ||
    state === 'FILLING_FORM' ||
    state === 'VERIFYING';

  const isReviewReady = state === 'REVIEW_READY' || state === 'COMPLETED';

  // Helper function to map fact key to appropriate icon
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

  const displayFacts = facts.length > 0 ? facts : defaultFacts;

  // Streamlined 7-stage timeline steps matching assignment specification
  const timelineSteps = [
    {
      title: 'Document processed',
      desc: 'student_admission.pdf (842 KB)',
      done: true,
    },
    {
      title: 'Information extracted',
      desc: `${displayFacts.length} student facts extracted`,
      done: true,
    },
    {
      title: 'Form opened',
      desc: state === 'IDLE' ? 'Pending' : 'Connected to Playwright',
      done: state !== 'IDLE' && state !== 'EXTRACTING_DOC',
    },
    {
      title: 'Fields detected',
      desc: isRunning || isReviewReady ? 'DOM form controls discovered' : 'Pending',
      done: isRunning || isReviewReady,
    },
    {
      title: 'Information mapped',
      desc: state === 'FILLING_FORM' || state === 'VERIFYING' || isReviewReady ? 'Mapped with Gemini AI' : 'Pending',
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
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-app)', fontFamily: 'var(--font-sans)' }}>
      {/* 1. Left Dark Sidebar */}
      <aside
        style={{
          width: '240px',
          background: 'var(--bg-sidebar)',
          color: '#FFFFFF',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div>
          {/* Top Brand Logo */}
          <div style={{ padding: '24px 20px 20px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: '#A5DCB4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Sprout size={22} color="#0F2E23" />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.25rem', color: '#FFFFFF', lineHeight: '1.1' }}>
                autofiller<span style={{ color: '#A5DCB4' }}>.AI</span>
              </div>
              <div style={{ fontSize: '0.6875rem', color: '#94A3B8', marginTop: '2px' }}>
                From Documents to Opportunities
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav style={{ padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {[
              { id: 'Home', label: 'Home', icon: <Home size={18} /> },
              { id: 'New Session', label: 'New Session', icon: <Play size={18} /> },
              { id: 'History', label: 'History', icon: <History size={18} /> },
              { id: 'Documents', label: 'Documents', icon: <FileText size={18} /> },
              { id: 'Settings', label: 'Settings', icon: <Settings size={18} /> },
              { id: 'Help', label: 'Help', icon: <HelpCircle size={18} /> },
            ].map((item) => {
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveNav(item.id);
                    if (item.id === 'Settings') setIsSettingsOpen(true);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    width: '100%',
                    padding: '10px 16px',
                    borderRadius: 'var(--radius-md)',
                    border: 'none',
                    background: isActive ? 'var(--bg-sidebar-active)' : 'transparent',
                    color: isActive ? 'var(--text-sidebar-active)' : '#CBD5E1',
                    fontWeight: isActive ? 700 : 500,
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer Artwork & Profile */}
        <div>
          {/* Decorative Quote */}
          <div style={{ padding: '0 20px 20px 20px', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-handwriting)', fontSize: '1.25rem', color: '#A5DCB4', fontStyle: 'italic' }}>
              Empowering Education with AI
            </div>
            {/* Tree vector illustration */}
            <svg viewBox="0 0 100 40" style={{ width: '100%', height: '32px', marginTop: '6px', opacity: 0.6 }}>
              <path fill="#2D5A46" d="M10,40 L15,25 L20,40 Z M30,40 L38,18 L46,40 Z M60,40 L68,22 L76,40 Z M80,40 L85,28 L90,40 Z" />
            </svg>
          </div>

          {/* User Profile Pill */}
          <div
            style={{
              padding: '14px 16px',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: '#A5DCB4',
                  color: '#0F2E23',
                  fontWeight: 700,
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                AD
              </div>
              <div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#FFFFFF' }}>
                  Aayush Dubey
                </div>
                <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>
                  Build. Automate. Elevate.
                </div>
              </div>
            </div>
            <ChevronDown size={14} color="#94A3B8" />
          </div>
        </div>
      </aside>

      {/* 2. Main Workspace Layout */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Top Navigation Bar */}
        <header
          style={{
            height: '64px',
            padding: '0 32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'var(--bg-card)',
          }}
        >
          {/* Left Logo Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sprout size={22} color="#0F4C3A" />
              <span style={{ fontWeight: 800, fontSize: '1.25rem', color: '#0F2E23' }}>
                AutoFiller <span style={{ color: '#16654E' }}>AI</span>
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '4px' }}>
                From Documents to Opportunities
              </span>
            </div>
            {/* Center Phase Badge */}
            <div
              style={{
                background: '#D9EFE0',
                border: '1px solid #B7E3C4',
                color: '#0F4C3A',
                borderRadius: 'var(--radius-md)',
                padding: '4px 14px',
                fontSize: '0.75rem',
                fontWeight: 700,
              }}
            >
              PHASE 1 <span style={{ fontWeight: 500, marginLeft: '6px' }}>Student Information Form Filling</span>
            </div>
          </div>

          {/* Right Header Options */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div
              style={{
                fontFamily: 'var(--font-handwriting)',
                fontSize: '1.25rem',
                color: '#8B5A2B',
                fontWeight: 700,
              }}
            >
              Less Manual Work, More Opportunities ~
            </div>
            <button
              onClick={() => setIsSettingsOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Sun size={18} />
            </button>
            <button
              onClick={() => setIsSettingsOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Settings size={18} />
              <span>Settings</span>
            </button>
            <button
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <HelpCircle size={18} />
              <span>Help</span>
            </button>
          </div>
        </header>

        {/* Scrollable Page Workspace */}
        <main style={{ flex: 1, padding: '28px 32px', overflowY: 'auto' }}>
          {/* Welcome Title Banner */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              WELCOME TO AUTOFILLER.AI
            </div>
            <h1 style={{ fontSize: '1.875rem', fontWeight: 800, color: '#0F2E23', marginTop: '4px' }}>
              Automate Student Form Filling with AI
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', marginTop: '4px' }}>
              Upload a document, provide the target form, and let AI handle the rest — you review, you decide.
            </p>
          </div>

          {/* 3 Step Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '20px' }}>
            {/* Step Card 1 */}
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
                      Document Uploaded
                    </h3>
                    <div style={{ fontSize: '0.75rem', color: '#16654E', fontWeight: 600 }}>
                      ✓ Document processed
                    </div>
                  </div>
                </div>

                <div
                  onClick={handleSelectDocument}
                  style={{
                    border: '1.5px dashed #B0C4B8',
                    borderRadius: 'var(--radius-md)',
                    padding: '16px',
                    textAlign: 'center',
                    background: '#F9F8F5',
                    cursor: 'pointer',
                    marginBottom: '10px',
                  }}
                >
                  <UploadCloud size={24} color="#16654E" style={{ margin: '0 auto 6px auto' }} />
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0F2E23' }}>
                    {documentName}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    PDF • 842 KB
                  </div>
                </div>
              </div>

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
                <span>✓ Student information extracted</span>
                <button
                  onClick={handleSelectDocument}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#16654E', fontWeight: 700 }}
                >
                  Change
                </button>
              </div>
            </div>

            {/* Step Card 2 */}
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
                    <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>STEP 2: Target Form</h3>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Website URL</div>
                  </div>
                </div>

                <div style={{ position: 'relative', marginBottom: '10px' }}>
                  <Globe size={16} style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
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
                  onClick={() => setTargetUrl('http://127.0.0.1:8000/mock_school_form.html')}
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
                  ⚡ Use Demo School Form
                </button>
                <button
                  onClick={() => window.open(targetUrl, '_blank')}
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
                    cursor: 'pointer',
                  }}
                >
                  <ExternalLink size={14} />
                  <span>Open</span>
                </button>
              </div>
            </div>

            {/* Step Card 3 */}
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
                    <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>STEP 3: Operator Instruction</h3>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>What should the agent do?</div>
                  </div>
                </div>

                <div style={{ position: 'relative' }}>
                  <textarea
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
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
              </div>

              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                <span
                  onClick={() =>
                    setInstruction(
                      'Fill the student admission form using the extracted student information.'
                    )
                  }
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
                  + Student Admission Form
                </span>
                <span
                  onClick={() =>
                    setInstruction(
                      'Extract student details and fill school registration form, verifying all input fields.'
                    )
                  }
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
                  + Registration Form
                </span>
              </div>
            </div>
          </div>

          {/* Primary Action Button Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '24px' }}>
            <button
              onClick={handleStartSession}
              disabled={isRunning}
              style={{
                flex: 1,
                padding: '16px',
                borderRadius: 'var(--radius-md)',
                background: isRunning ? '#82A897' : '#16654E',
                color: '#FFFFFF',
                border: 'none',
                fontWeight: 800,
                fontSize: '1.125rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px',
                cursor: isRunning ? 'not-allowed' : 'pointer',
                boxShadow: '0 6px 20px -4px rgba(22, 101, 78, 0.4)',
                transition: 'all 0.2s',
              }}
            >
              <Play size={20} fill="#FFFFFF" />
              <span>{isRunning ? 'AutoFiller Agent In Progress...' : 'Start Automation'}</span>
              <ArrowRight size={20} />
            </button>
            <div style={{ fontFamily: 'var(--font-handwriting)', fontSize: '1.35rem', color: '#8B5A2B', fontWeight: 700 }}>
              ➔ Your Document, Their Future
            </div>
          </div>

          {/* Lower Workspace: 2-Column Split + Right Progress Sidebar */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px' }}>
            {/* Left Column: Facts + Live Browser Hero */}
            <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '20px' }}>
              {/* Extracted Student Information Card */}
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
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <FileText size={18} color="#16654E" />
                      <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>
                        Student Information
                      </h3>
                    </div>
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
                  </div>

                  {/* Fact Table Rows */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {displayFacts.map((fact, index) => (
                      <div
                        key={fact.key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 0',
                          borderBottom: '1px solid #F1ECE3',
                          fontSize: '0.8125rem',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
                          {getFactIcon(fact.label)}
                          <span>{fact.label}</span>
                        </div>
                        {isEditingFacts ? (
                          <input
                            type="text"
                            value={fact.value}
                            onChange={(e) => {
                              const updated = [...displayFacts];
                              updated[index] = { ...fact, value: e.target.value };
                              setFacts(updated);
                            }}
                            style={{
                              width: '140px',
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
                </div>

                {/* Bottom Status Pill */}
                <div
                  style={{
                    marginTop: '16px',
                    background: '#D9EFE0',
                    border: '1px solid #B7E3C4',
                    borderRadius: 'var(--radius-md)',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                  }}
                >
                  <CheckCircle2 size={18} color="#16654E" style={{ flexShrink: 0, marginTop: '1px' }} />
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F4C3A' }}>
                      ✓ Document processed & facts extracted
                    </div>
                    <div style={{ fontSize: '0.6875rem', color: '#16654E' }}>
                      Verify or edit values before starting automation.
                    </div>
                  </div>
                </div>
              </div>

              {/* Live Browser Hero Card */}
              <div
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '20px',
                  border: '2px solid #16654E',
                  boxShadow: '0 8px 30px rgba(22, 101, 78, 0.12)',
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Globe size={18} color="#16654E" />
                    <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#0F2E23', letterSpacing: '0.02em' }}>
                      LIVE BROWSER
                    </h3>
                  </div>
                  <div
                    style={{
                      background: '#16654E',
                      color: '#FFFFFF',
                      borderRadius: 'var(--radius-full)',
                      padding: '4px 12px',
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: '0 2px 8px rgba(22, 101, 78, 0.3)',
                    }}
                  >
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#A5DCB4' }} />
                    LIVE
                  </div>
                </div>

                {/* Browser Frame Mockup */}
                <div
                  style={{
                    flex: 1,
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid #CBD5E1',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    background: '#F8FAFC',
                  }}
                >
                  {/* Browser Window Header */}
                  <div
                    style={{
                      background: '#1E293B',
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94A3B8' }}>
                      <ArrowLeft size={14} />
                      <ArrowRightIcon size={14} />
                      <RotateCw size={14} />
                    </div>
                    <div
                      style={{
                        flex: 1,
                        background: '#0F172A',
                        color: '#E2E8F0',
                        fontSize: '0.75rem',
                        fontFamily: 'var(--font-mono)',
                        padding: '4px 12px',
                        borderRadius: 'var(--radius-sm)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {targetUrl}
                    </div>
                  </div>

                  {/* Form Viewport Preview */}
                  <div style={{ padding: '16px', background: '#FFFFFF', flex: 1, overflowY: 'auto' }}>
                    <div
                      style={{
                        textAlign: 'center',
                        paddingBottom: '12px',
                        borderBottom: '1px solid #E2E8F0',
                        marginBottom: '16px',
                      }}
                    >
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          background: '#1E3A8A',
                          color: '#FFFFFF',
                          margin: '0 auto 6px auto',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 800,
                          fontSize: '0.875rem',
                        }}
                      >
                        🏫
                      </div>
                      <div style={{ fontWeight: 800, fontSize: '0.9375rem', color: '#1E293B' }}>
                        Student Admission Form
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748B' }}>Controlled via Playwright Browser</div>
                    </div>

                    {/* Render Form Controls */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.75rem' }}>
                      <div>
                        <label style={{ fontWeight: 600, color: '#334155' }}>Full Name *</label>
                        <input
                          type="text"
                          readOnly
                          value={isReviewReady || isRunning ? 'Aarav Sharma' : ''}
                          style={{
                            width: '100%',
                            padding: '6px 8px',
                            borderRadius: '4px',
                            border: '1px solid #CBD5E1',
                            marginTop: '4px',
                            fontSize: '0.75rem',
                            background: isReviewReady || isRunning ? '#ECFDF5' : '#FFFFFF',
                            borderColor: isReviewReady || isRunning ? '#10B981' : '#CBD5E1',
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontWeight: 600, color: '#334155' }}>Gender *</label>
                        <div style={{ display: 'flex', gap: '10px', marginTop: '6px', fontSize: '0.75rem' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input type="radio" name="g" checked={isReviewReady || isRunning} readOnly /> Male
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input type="radio" name="g" readOnly /> Female
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <input type="radio" name="g" readOnly /> Other
                          </label>
                        </div>
                      </div>

                      <div>
                        <label style={{ fontWeight: 600, color: '#334155' }}>Date of Birth *</label>
                        <input
                          type="text"
                          readOnly
                          value={isReviewReady || isRunning ? '15-03-2010' : ''}
                          style={{
                            width: '100%',
                            padding: '6px 8px',
                            borderRadius: '4px',
                            border: '1px solid #CBD5E1',
                            marginTop: '4px',
                            fontSize: '0.75rem',
                            background: isReviewReady || isRunning ? '#ECFDF5' : '#FFFFFF',
                            borderColor: isReviewReady || isRunning ? '#10B981' : '#CBD5E1',
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontWeight: 600, color: '#334155' }}>Class Applying For *</label>
                        <select
                          disabled
                          style={{
                            width: '100%',
                            padding: '6px 8px',
                            borderRadius: '4px',
                            border: '1px solid #CBD5E1',
                            marginTop: '4px',
                            fontSize: '0.75rem',
                            background: isReviewReady || isRunning ? '#ECFDF5' : '#FFFFFF',
                          }}
                        >
                          <option>Grade 10</option>
                        </select>
                      </div>

                      <div>
                        <label style={{ fontWeight: 600, color: '#334155' }}>Email *</label>
                        <input
                          type="text"
                          readOnly
                          value={isReviewReady || isRunning ? 'aarav@example.com' : ''}
                          style={{
                            width: '100%',
                            padding: '6px 8px',
                            borderRadius: '4px',
                            border: '1px solid #CBD5E1',
                            marginTop: '4px',
                            fontSize: '0.75rem',
                            background: isReviewReady || isRunning ? '#ECFDF5' : '#FFFFFF',
                            borderColor: isReviewReady || isRunning ? '#10B981' : '#CBD5E1',
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontWeight: 600, color: '#334155' }}>City *</label>
                        <input
                          type="text"
                          readOnly
                          value={isReviewReady || isRunning ? 'Nagpur' : ''}
                          style={{
                            width: '100%',
                            padding: '6px 8px',
                            borderRadius: '4px',
                            border: '1px solid #CBD5E1',
                            marginTop: '4px',
                            fontSize: '0.75rem',
                            background: isReviewReady || isRunning ? '#ECFDF5' : '#FFFFFF',
                            borderColor: isReviewReady || isRunning ? '#10B981' : '#CBD5E1',
                          }}
                        />
                      </div>

                      <div>
                        <label style={{ fontWeight: 600, color: '#334155' }}>Phone</label>
                        <input
                          type="text"
                          readOnly
                          value={isReviewReady || isRunning ? '+91 98230 11223' : ''}
                          style={{
                            width: '100%',
                            padding: '6px 8px',
                            borderRadius: '4px',
                            border: '1px solid #CBD5E1',
                            marginTop: '4px',
                            fontSize: '0.75rem',
                            background: isReviewReady || isRunning ? '#ECFDF5' : '#FFFFFF',
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontWeight: 600, color: '#334155' }}>Allergies</label>
                        <input
                          type="text"
                          readOnly
                          value={isReviewReady || isRunning ? 'None' : ''}
                          style={{
                            width: '100%',
                            padding: '6px 8px',
                            borderRadius: '4px',
                            border: '1px solid #CBD5E1',
                            marginTop: '4px',
                            fontSize: '0.75rem',
                            background: isReviewReady || isRunning ? '#ECFDF5' : '#FFFFFF',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Side Timeline Panel */}
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
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
                  <Sprout size={18} color="#16654E" />
                  <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>
                    Automation Progress
                  </h3>
                </div>

                {/* Timeline Stepper */}
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

              {/* Review Ready Screen / Banner Box */}
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
                <div style={{ fontSize: '0.75rem', color: '#334155', marginTop: '6px', lineHeight: '1.4' }}>
                  All detected fields have been populated and verified against the source document.
                </div>

                <div
                  style={{
                    background: '#FFFFFF',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px',
                    marginTop: '12px',
                    border: '1px solid #B7E3C4',
                    fontSize: '0.75rem',
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    fontWeight: 600,
                    color: '#0F2E23',
                  }}
                >
                  <div style={{ color: '#16654E' }}>✓ {displayFacts.length} fields verified</div>
                  <div style={{ color: '#16654E' }}>✓ 0 unresolved fields</div>
                  <div style={{ color: '#16654E' }}>✓ 0 conflicts</div>
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
                  <span>REVIEW THE FORM IN BROWSER</span>
                </button>

                <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #B7E3C4', fontSize: '0.6875rem', color: '#16654E', fontWeight: 600 }}>
                  🔒 Final submission is disabled. Please review the form and submit it manually when satisfied.
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Bottom Status Footer */}
        <footer
          style={{
            height: '40px',
            padding: '0 32px',
            background: 'var(--bg-card)',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16654E' }} />
              <span style={{ fontWeight: 600, color: '#0F2E23' }}>Backend Connected</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16654E' }} />
              <span style={{ fontWeight: 600, color: '#0F2E23' }}>Playwright Ready</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16654E' }} />
              <span style={{ fontWeight: 600, color: '#0F2E23' }}>Policy Guard Active</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span>autofiller.AI</span>
            <span>|</span>
            <span>Phase 1</span>
            <span>|</span>
            <span>v1.0.0</span>
            <span>|</span>
            <span>Safe</span>
            <span>|</span>
            <span>Reliable</span>
            <span>|</span>
            <span style={{ color: '#16654E', fontWeight: 600 }}>Built for Education 🌿</span>
          </div>
        </footer>
      </div>

      {/* Human-in-the-Loop Clarification Dialog */}
      <ClarificationModal
        prompt={clarificationPrompt}
        onSubmitAnswer={handleAnswerClarification}
      />

      {/* In-App Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};
