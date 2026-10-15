import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  HelpCircle,
  History,
  Home,
  Lock,
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
import { HomeView, NewSessionView, HistoryView } from './views/SessionViews';
import { MyDetailsView, SettingsView, HelpView } from './views/ManagementViews';

export const App: React.FC = () => {
  const [activeNav, setActiveNav] = useState<string>('Home');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = (localStorage.getItem('autofiller_theme') as 'light' | 'dark') || 'light';
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', saved);
      if (saved === 'dark') {
        document.documentElement.classList.add('dark');
        document.body.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
        document.body.classList.remove('dark');
      }
    }
    return saved;
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

  // Active Session Navigation Interception state
  const [pendingNav, setPendingNav] = useState<string | null>(null);
  const [showLeaveModal, setShowLeaveModal] = useState<boolean>(false);

  const session = useFormSession();

  useEffect(() => {
    localStorage.setItem('autofiller_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.body.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.body.classList.remove('dark');
    }
  }, [theme]);

  // Check vault status on mount, window focus, and relaxed idle heartbeat (Fixes H-06)
  useEffect(() => {
    checkVaultStatus();
    const handleFocus = () => {
      checkVaultStatus();
    };
    window.addEventListener('focus', handleFocus);
    // Relaxed heartbeat to detect 15-minute auto-lock without aggressive 5s polling
    const interval = setInterval(checkVaultStatus, 60000);
    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
    };
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

  const isAutomationActive = (state: string): boolean => {
    return (
      state === 'SCANNING_FORM' ||
      state === 'MAPPING_FIELDS' ||
      state === 'CLARIFICATION_REQUIRED' ||
      state === 'FILLING_FORM' ||
      state === 'VERIFYING' ||
      state === 'REVIEW_READY' ||
      state === 'PAUSED' ||
      state === 'USER_TAKEOVER'
    );
  };

  const handleNavigate = (targetNav: string) => {
    if (activeNav === 'New Session' && isAutomationActive(session.state)) {
      setPendingNav(targetNav);
      setShowLeaveModal(true);
      return;
    }
    setActiveNav(targetNav);
  };

  const handleStay = () => {
    setShowLeaveModal(false);
    setPendingNav(null);
  };

  const handleLeaveAndStop = async () => {
    const dest = pendingNav;
    setShowLeaveModal(false);
    setPendingNav(null);
    await session.stopSession();
    if (dest) {
      setActiveNav(dest);
    }
  };

  const handleUseDocument = (doc: DocumentRecord) => {
    session.useDocumentRecord(doc);
    handleNavigate('New Session');
  };

  const handleNavClick = (id: string) => {
    handleNavigate(id);
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

  const handleLockVault = async () => {
    try {
      await bridge.vaultLock();
      await checkVaultStatus();
    } catch (err) {
      console.error('Error locking vault', err);
    }
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
        height: '100vh',
        background: 'var(--bg-app)',
        fontFamily: 'var(--font-sans)',
        overflow: 'hidden',
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
            onClick={() => handleNavigate('Home')}
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
              <Sprout size={22} color="var(--text-title)" />
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
                  onClick={() => handleNavigate(item.id)}
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
                color: 'var(--text-title)',
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
          minHeight: 0,
          height: '100vh',
          overflow: 'hidden',
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
            onClick={() => handleNavigate('Home')}
            style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', minWidth: 0 }}
          >
            <Sprout size={22} color="var(--accent-primary)" />
            <span style={{ fontWeight: 800, fontSize: '1.25rem', color: 'var(--text-primary)' }}>
              AutoFiller <span style={{ color: 'var(--accent-primary)' }}>AI</span>
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              From Documents to Opportunities
            </span>
          </div>

          {/* Right Header Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
            {/* Vault Protection Status Pill */}
            <div
              onClick={() => {
                if (vaultState.hasPassphraseSlot && vaultState.unlocked) {
                  void handleLockVault();
                } else if (!vaultState.hasPassphraseSlot) {
                  handleNavigate('Settings');
                }
              }}
              title={
                vaultState.hasPassphraseSlot
                  ? vaultState.unlocked
                    ? 'Extra Protection Active — Click to lock vault'
                    : 'Vault Locked'
                  : 'OS Keychain Protected — Click to configure extra protection'
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: 'var(--radius-full)',
                background: vaultState.unlocked ? 'var(--accent-green-bg)' : 'rgba(239, 68, 68, 0.15)',
                border: `1px solid ${vaultState.unlocked ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.4)'}`,
                color: vaultState.unlocked ? 'var(--accent-green-text)' : '#EF4444',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                userSelect: 'none',
              }}
            >
              <ShieldCheck size={14} />
              <span>
                {vaultState.hasPassphraseSlot
                  ? vaultState.unlocked
                    ? 'Vault Unlocked'
                    : 'Vault Locked'
                  : 'Vault Protected'}
              </span>
              {vaultState.hasPassphraseSlot && vaultState.unlocked && (
                <Lock size={12} style={{ opacity: 0.75, marginLeft: '2px' }} />
              )}
            </div>

            {/* Dark / Light Mode Toggle Pill */}
            <button
              onClick={toggleTheme}
              title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
              aria-label={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: 'var(--radius-full)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-app)',
                color: 'var(--text-primary)',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {theme === 'light' ? (
                <>
                  <Moon size={14} style={{ color: 'var(--text-secondary)' }} />
                  <span>Dark</span>
                </>
              ) : (
                <>
                  <Sun size={14} style={{ color: '#F59E0B' }} />
                  <span>Light</span>
                </>
              )}
            </button>

            {/* Quick Action: New Session */}
            <button
              onClick={() => handleNavigate('New Session')}
              title="Start New Form Filling Session"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--accent-primary)',
                color: '#FFFFFF',
                border: 'none',
                fontSize: '0.8125rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(16, 185, 129, 0.25)',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--accent-primary-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--accent-primary)';
              }}
            >
              <Play size={13} fill="#FFFFFF" />
              <span>New Session</span>
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
                <span style={{ fontSize: '0.75rem', color: 'var(--text-brand)', marginLeft: '8px' }}>Copied!</span>
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
              border: '1px solid var(--badge-green-border)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: 'var(--text-brand)',
              fontSize: '0.84375rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ShieldCheck size={18} />
              <span>
                <strong>Want extra protection?</strong> You can lock your details with a privacy key in Settings. Field labels are sent to AI for matching; your values stay on this device; uploaded documents are processed by Gemini.
              </span>
              <button
                onClick={() => handleNavigate('Settings')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-title)',
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
              style={{ background: 'transparent', border: 'none', color: 'var(--text-brand)', cursor: 'pointer' }}
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
            minHeight: 0,
          }}
        >
          {activeNav === 'Home' && (
            <HomeView
              onNewSession={() => handleNavigate('New Session')}
              onOpenDocuments={() => handleNavigate('My Details')}
              onOpenHistory={() => handleNavigate('History')}
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
              onStopSession={session.stopSession}
              onOpenHistory={() => handleNavigate('History')}
              onResetSession={session.resetSession}
              onConfirmSubmission={() => void bridge.confirmSubmission()}
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
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--status-success)' }} />
              <span style={{ fontWeight: 600, color: 'var(--text-title)' }}>Backend Operational</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--status-success)' }} />
              <span style={{ fontWeight: 600, color: 'var(--text-title)' }}>Playwright Ready</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--status-success)' }} />
              <span style={{ fontWeight: 600, color: 'var(--text-title)' }}>Never-Submit Policy Guard</span>
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
            <span style={{ color: 'var(--text-brand)', fontWeight: 600 }}>Built for Education 🌿</span>
          </div>
        </footer>
      </div>

      {/* Human-in-the-Loop Clarification Modal */}
      <ClarificationModal
        prompt={session.clarificationPrompt}
        onSubmitAnswer={session.handleAnswerClarification}
        onCancel={() => {
          setPendingNav('Home');
          setShowLeaveModal(true);
        }}
        isSubmitting={session.isAnsweringClarification}
        totalClarifications={session.totalClarifications}
        currentClarificationIndex={session.currentClarificationIndex}
      />

      {/* Vault Unlock Modal (shows only when Extra protection is on and vault is locked) */}
      <VaultLockModal
        isOpen={showVaultModal}
        mode="unlock"
        onUnlocked={handleVaultUnlocked}
        onResetVault={handleResetVault}
      />

      {/* Active Session Interruption Confirmation Modal */}
      {showLeaveModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 46, 35, 0.45)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '20px',
          }}
        >
          <div
            style={{
              background: 'var(--bg-card, #FFFFFF)',
              borderRadius: '12px',
              border: '1px solid var(--border-subtle, #E2E8F0)',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              width: '100%',
              maxWidth: '440px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  background: '#FEF3C7',
                  color: '#D97706',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <AlertTriangle size={22} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-title)' }}>
                  Automation is still in progress. Leaving will stop this session.
                </h3>
                <p style={{ margin: '6px 0 0 0', fontSize: '0.875rem', color: '#64748B', lineHeight: '1.4' }}>
                  Your prepared facts will remain available to restart when you return.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={handleStay}
                style={{
                  padding: '8px 18px',
                  borderRadius: '6px',
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  color: '#475569',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Stay
              </button>
              <button
                type="button"
                onClick={handleLeaveAndStop}
                style={{
                  padding: '8px 18px',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#DC2626',
                  color: '#FFFFFF',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Leave & Stop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
