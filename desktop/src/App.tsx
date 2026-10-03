import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  FileText,
  HelpCircle,
  History,
  Home,
  Moon,
  Play,
  Sprout,
  Sun,
  X,
} from 'lucide-react';
import { ClarificationModal } from './features/clarification/ClarificationModal';
import { useFormSession } from './hooks/useFormSession';
import { bridge } from './lib/bridge';
import type { DocumentRecord } from './types/autofiller';
import { DocumentsView } from './views/DocumentsView';
import { HelpView } from './views/HelpView';
import { HistoryView } from './views/HistoryView';
import { HomeView } from './views/HomeView';
import { NewSessionView } from './views/NewSessionView';

export const App: React.FC = () => {
  const [activeNav, setActiveNav] = useState<string>('Home');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('autofiller_theme') as 'light' | 'dark') || 'light';
  });
  const [engineError, setEngineError] = useState<{ show: boolean; detail: string }>({
    show: false,
    detail: '',
  });
  const [copiedDetails, setCopiedDetails] = useState<boolean>(false);

  const session = useFormSession();

  useEffect(() => {
    localStorage.setItem('autofiller_theme', theme);
  }, [theme]);

  useEffect(() => {
    bridge.getEngineStatus().then((status) => {
      if (!status.ready) {
        setEngineError({ show: true, detail: status.errorDetail || 'Engine startup error' });
      }
    });

    const unsubscribe = bridge.onEngineError((status) => {
      if (!status.ready) {
        setEngineError({ show: true, detail: status.errorDetail || 'Engine error' });
      }
    });

    return unsubscribe;
  }, []);

  const handleUseDocument = (doc: DocumentRecord) => {
    session.useDocumentRecord(doc);
    setActiveNav('New Session');
  };

  const handleNavClick = (id: string) => {
    if (id === 'New Session') {
      session.resetSession();
      setActiveNav('New Session');
    } else {
      setActiveNav(id);
    }
  };

  const handleCopyErrorDetails = () => {
    if (engineError.detail) {
      void navigator.clipboard.writeText(engineError.detail);
      setCopiedDetails(true);
      setTimeout(() => setCopiedDetails(false), 3000);
    }
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--bg-app)',
        fontFamily: 'var(--font-sans)',
        overflowX: 'hidden',
      }}
    >
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
          <div
            style={{
              padding: '24px 20px 20px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
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
              <div
                style={{
                  fontWeight: 800,
                  fontSize: '1.25rem',
                  color: '#FFFFFF',
                  lineHeight: '1.1',
                }}
              >
                autofiller<span style={{ color: '#A5DCB4' }}>.AI</span>
              </div>
              <div style={{ fontSize: '0.6875rem', color: '#94A3B8', marginTop: '2px' }}>
                From Documents to Opportunities
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav
            style={{
              padding: '16px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {[
              { id: 'Home', label: 'Home', icon: <Home size={18} /> },
              { id: 'New Session', label: 'New Session', icon: <Play size={18} /> },
              { id: 'History', label: 'History', icon: <History size={18} /> },
              { id: 'Documents', label: 'Documents', icon: <FileText size={18} /> },
              { id: 'Help', label: 'Help', icon: <HelpCircle size={18} /> },
            ].map((item) => {
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
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
          <div style={{ padding: '0 20px 20px 20px', textAlign: 'center' }}>
            <div
              style={{
                fontFamily: 'var(--font-handwriting)',
                fontSize: '1.25rem',
                color: '#A5DCB4',
                fontStyle: 'italic',
              }}
            >
              Empowering Education with AI
            </div>
            <svg
              viewBox="0 0 100 40"
              style={{ width: '100%', height: '32px', marginTop: '6px', opacity: 0.6 }}
            >
              <path
                fill="#2D5A46"
                d="M10,40 L15,25 L20,40 Z M30,40 L38,18 L46,40 Z M60,40 L68,22 L76,40 Z M80,40 L85,28 L90,40 Z"
              />
            </svg>
          </div>

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
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflowX: 'hidden',
        }}
      >
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
            minWidth: 0,
          }}
        >
          {/* Left Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sprout size={22} color="#0F4C3A" />
              <span style={{ fontWeight: 800, fontSize: '1.25rem', color: '#0F2E23' }}>
                AutoFiller <span style={{ color: '#16654E' }}>AI</span>
              </span>
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginLeft: '4px',
                  display: 'inline-block',
                }}
              >
                From Documents to Opportunities
              </span>
            </div>
          </div>

          {/* Right Options */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexShrink: 0 }}>
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
              onClick={toggleTheme}
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
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
                padding: '6px',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {theme === 'light' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              onClick={() => setActiveNav('Help')}
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

        {/* Engine Error Banner */}
        {engineError.show && (
          <div
            style={{
              margin: '16px 32px 0 32px',
              padding: '14px 20px',
              background: '#FEF2F2',
              border: '1.5px solid #FCA5A5',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: '#991B1B',
              fontSize: '0.875rem',
              fontWeight: 600,
              boxShadow: '0 4px 12px rgba(220, 38, 38, 0.1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <AlertTriangle size={20} color="#DC2626" />
              <span>AutoFiller couldn't start its AI engine. Restart the app.</span>
              {copiedDetails ? (
                <span style={{ fontSize: '0.75rem', color: '#16654E', marginLeft: '8px' }}>
                  Copied!
                </span>
              ) : (
                <button
                  onClick={handleCopyErrorDetails}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#B91C1C',
                    textDecoration: 'underline',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    marginLeft: '8px',
                  }}
                >
                  Copy details
                </button>
              )}
            </div>
            <button
              onClick={() => setEngineError((prev) => ({ ...prev, show: false }))}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#991B1B',
                cursor: 'pointer',
                padding: '4px',
              }}
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* Scrollable Page Workspace */}
        <main
          style={{
            flex: 1,
            padding: '28px 32px',
            overflowY: 'auto',
            minWidth: 0,
          }}
        >
          {activeNav === 'Home' && (
            <HomeView
              onNewSession={() => {
                session.resetSession();
                setActiveNav('New Session');
              }}
              onOpenDocuments={() => setActiveNav('Documents')}
              onOpenHistory={() => setActiveNav('History')}
              onUseDocument={handleUseDocument}
            />
          )}

          {activeNav === 'New Session' && (
            <NewSessionView
              state={session.state}
              documentName={session.documentName}
              documentSize={session.documentSize}
              facts={session.facts}
              targetUrl={session.targetUrl}
              instruction={session.instruction}
              events={session.events}
              inlineError={session.inlineError}
              isExtracting={session.isExtracting}
              canStart={session.canStart}
              disabledReason={session.disabledReason}
              onSelectDocument={session.handleSelectDocument}
              onStartSession={session.handleStartSession}
              onSetFacts={session.setFacts}
              onSetTargetUrl={session.setTargetUrl}
              onSetInstruction={session.setInstruction}
            />
          )}

          {activeNav === 'History' && <HistoryView />}

          {activeNav === 'Documents' && <DocumentsView onUseDocument={handleUseDocument} />}

          {activeNav === 'Help' && <HelpView />}
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
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#16654E',
                }}
              />
              <span style={{ fontWeight: 600, color: '#0F2E23' }}>Backend Operational</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#16654E',
                }}
              />
              <span style={{ fontWeight: 600, color: '#0F2E23' }}>Playwright Ready</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: '#16654E',
                }}
              />
              <span style={{ fontWeight: 600, color: '#0F2E23' }}>Never-Submit Policy Guard</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span>autofiller.AI</span>
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

      {/* Human-in-the-Loop Clarification Modal */}
      <ClarificationModal
        prompt={session.clarificationPrompt}
        onSubmitAnswer={session.handleAnswerClarification}
      />
    </div>
  );
};
