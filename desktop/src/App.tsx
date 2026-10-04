import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronRight,
  HelpCircle,
  History,
  Home,
  Moon,
  Play,
  Settings,
  ShieldCheck,
  Sprout,
  Sun,
  User,
  X,
} from 'lucide-react';
import { ClarificationModal } from './features/clarification/ClarificationModal';
import { VaultLockModal } from './features/vault/VaultLockModal';
import { useFormSession } from './hooks/useFormSession';
import { bridge } from './lib/bridge';
import type { DocumentRecord, VaultStatus } from './types/autofiller';
import { HelpView } from './views/HelpView';
import { HistoryView } from './views/HistoryView';
import { HomeView } from './views/HomeView';
import { MyDetailsView } from './views/MyDetailsView';
import { NewSessionView } from './views/NewSessionView';
import { SettingsView } from './views/SettingsView';

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

  // Tip banner state
  const [showExtraTip, setShowExtraTip] = useState<boolean>(false);

  // Vault Lock state
  const [vaultState, setVaultState] = useState<VaultStatus>({
    exists: false,
    unlocked: true,
    hasOsSlot: true,
    hasPassphraseSlot: false,
    hasRecoverySlot: false,
    recoveryAvailable: false,
  });
  const [showVaultModal, setShowVaultModal] = useState<boolean>(false);

  const session = useFormSession();

  useEffect(() => {
    localStorage.setItem('autofiller_theme', theme);
  }, [theme]);

  // Check vault status periodically to detect auto-lock
  useEffect(() => {
    checkVaultStatus();
    const interval = setInterval(checkVaultStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkVaultStatus = async () => {
    try {
      const st = await bridge.vaultStatus();
      setVaultState(st);

      // Only show unlock modal if Extra Protection is enabled (hasPassphraseSlot) and vault is locked
      if (st.hasPassphraseSlot && !st.unlocked) {
        setShowVaultModal(true);
      } else {
        setShowVaultModal(false);
      }

      // Check one-time extra protection tip
      const tipDismissed = localStorage.getItem('autofiller_tip_dismissed') === 'true';
      if (!st.hasPassphraseSlot && !tipDismissed && st.exists) {
        setShowExtraTip(true);
      } else {
        setShowExtraTip(false);
      }
    } catch (err) {
      console.error('Error checking vault status', err);
    }
  };

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

  const handleVaultUnlocked = () => {
    setShowVaultModal(false);
    checkVaultStatus();
  };

  const handleResetVault = async () => {
    if (confirm('Are you sure you want to erase all vault data and reset? This cannot be undone.')) {
      await bridge.vaultEraseAll();
      setShowVaultModal(false);
      await checkVaultStatus();
    }
  };

  const handleDismissTip = () => {
    localStorage.setItem('autofiller_tip_dismissed', 'true');
    setShowExtraTip(false);
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
          {/* Top Brand Logo -> Opens Home */}
          <div
            onClick={() => setActiveNav('Home')}
            style={{
              padding: '24px 20px 20px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              cursor: 'pointer',
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

          {/* Navigation Links: Home, New Session, My Details, History, Settings, Help */}
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
              { id: 'My Details', label: 'My Details', icon: <User size={18} /> },
              { id: 'History', label: 'History', icon: <History size={18} /> },
              { id: 'Settings', label: 'Settings', icon: <Settings size={18} /> },
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

        {/* Sidebar Footer */}
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
          </div>

          <div
            style={{
              padding: '14px 16px',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
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
                AutoFiller AI
              </div>
              <div style={{ fontSize: '0.65rem', color: '#94A3B8' }}>
                Safe Local Storage
              </div>
            </div>
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
        {/* Top Header */}
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
          {/* Left Logo / Title -> Opens Home */}
          <div
            onClick={() => setActiveNav('Home')}
            style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', minWidth: 0 }}
          >
            <Sprout size={22} color="#0F4C3A" />
            <span style={{ fontWeight: 800, fontSize: '1.25rem', color: '#0F2E23' }}>
              AutoFiller <span style={{ color: '#16654E' }}>AI</span>
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              From Documents to Opportunities
            </span>
          </div>

          {/* Right Header Options */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
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
              onClick={() => setActiveNav('Settings')}
              title="Settings"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'transparent',
                border: 'none',
                color: activeNav === 'Settings' ? '#16654E' : 'var(--text-secondary)',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Settings size={18} />
              <span>Settings</span>
            </button>

            <button
              onClick={() => setActiveNav('Help')}
              title="Help"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'transparent',
                border: 'none',
                color: activeNav === 'Help' ? '#16654E' : 'var(--text-secondary)',
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
                <span style={{ fontSize: '0.75rem', color: '#16654E', marginLeft: '8px' }}>Copied!</span>
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
              style={{ background: 'transparent', border: 'none', color: '#991B1B', cursor: 'pointer', padding: '4px' }}
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/* One-Time Extra Protection Tip Banner */}
        {showExtraTip && (
          <div
            style={{
              margin: '16px 32px 0 32px',
              padding: '12px 20px',
              background: '#F0FDF4',
              border: '1px solid #86EFAC',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: '#16654E',
              fontSize: '0.84375rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ShieldCheck size={18} />
              <span>
                <strong>Want extra protection?</strong> You can lock your details with a privacy key in Settings.
              </span>
              <button
                onClick={() => setActiveNav('Settings')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#0F2E23',
                  fontWeight: 700,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  marginLeft: '4px',
                }}
              >
                Go to Settings
              </button>
            </div>
            <button
              onClick={handleDismissTip}
              style={{ background: 'transparent', border: 'none', color: '#16654E', cursor: 'pointer' }}
            >
              <X size={16} />
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
              onOpenDocuments={() => setActiveNav('My Details')}
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

          {activeNav === 'My Details' && <MyDetailsView onProfileSaved={checkVaultStatus} />}

          {activeNav === 'History' && <HistoryView />}

          {activeNav === 'Settings' && (
            <SettingsView
              theme={theme}
              onToggleTheme={toggleTheme}
              onLockVault={checkVaultStatus}
            />
          )}

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
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16654E' }} />
              <span style={{ fontWeight: 600, color: '#0F2E23' }}>Backend Operational</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16654E' }} />
              <span style={{ fontWeight: 600, color: '#0F2E23' }}>Playwright Ready</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16654E' }} />
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

      {/* Vault Unlock Modal (shows only when Extra protection is on and vault is locked) */}
      <VaultLockModal
        isOpen={showVaultModal}
        mode="unlock"
        onUnlocked={handleVaultUnlocked}
        onResetVault={handleResetVault}
      />
    </div>
  );
};
