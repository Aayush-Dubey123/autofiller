import React, { useEffect, useState } from 'react';
import { ShieldAlert, Trash2, AlertTriangle, RefreshCw } from 'lucide-react';
import { bridge } from '../lib/bridge';

export const HelpView: React.FC = () => {
  const [version, setVersion] = useState<string>('1.0.0');
  const [showEraseConfirm, setShowEraseConfirm] = useState<boolean>(false);
  const [isErasing, setIsErasing] = useState<boolean>(false);
  const [eraseError, setEraseError] = useState<string | null>(null);

  useEffect(() => {
    bridge.appVersion().then(setVersion).catch(() => setVersion('1.0.0'));
  }, []);

  const handleEraseAllData = async () => {
    setIsErasing(true);
    setEraseError(null);
    try {
      const res = await bridge.eraseAllData();
      if (!res.success && res.error) {
        setEraseError(res.error);
        setIsErasing(false);
      }
    } catch (err: any) {
      setEraseError(err?.message || 'Data erasure error');
      setIsErasing(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F2E23' }}>
          AutoFiller AI — Usage & Privacy Guide
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
          Automated document extraction to web form filling with human-in-the-loop safety.
        </p>
      </div>

      {/* Workflow Steps Card */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F2E23' }}>
          How AutoFiller Works in 4 Steps
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: '#16654E',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '0.9375rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              1
            </div>
            <div>
              <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>
                Store Profiles in Encrypted Vault or Upload Document
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Manage your personal data in the AES-256-GCM encrypted vault under <strong>My Details</strong>, or extract facts from uploaded PDFs/images.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: '#8B5A2B',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '0.9375rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              2
            </div>
            <div>
              <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>
                Select Data Source & Form URL
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Choose your data source (Vault Profile, Uploaded Document, or Both with conflict resolution) and specify the target web form URL.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: '#2563EB',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '0.9375rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              3
            </div>
            <div>
              <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>
                Start Automation & Observe Live Browser
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Click <strong>Start Automation</strong>. Playwright opens a separate browser window and maps facts to DOM fields under your supervision.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: '#0F4C3A',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '0.9375rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              4
            </div>
            <div>
              <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>
                Human Review & Final Submission
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Once form filling is verified, the agent stops at <strong>REVIEW_READY</strong>. AutoFiller never auto-submits forms. You review the filled form in the browser window and press submit yourself.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Safety Guarantee Card */}
      <div
        style={{
          background: '#D9EFE0',
          border: '1.5px solid #16654E',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          display: 'flex',
          gap: '14px',
          alignItems: 'flex-start',
        }}
      >
        <ShieldAlert size={24} color="#0F4C3A" style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          <h4 style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#0F4C3A' }}>
            Never-Submit Safety Guarantee
          </h4>
          <p style={{ fontSize: '0.8125rem', color: '#16654E', marginTop: '4px', lineHeight: 1.5 }}>
            AutoFiller PolicyEngine strictly enforces that form submission is never automated. The automation loop terminates when fields are filled and verified. You retain 100% control over form submission.
          </p>
        </div>
      </div>

      {/* Complete Data Erasure Card */}
      <div
        style={{
          background: '#FEF2F2',
          border: '1.5px solid #FCA5A5',
          borderRadius: 'var(--radius-lg)',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h4 style={{ fontSize: '1rem', fontWeight: 800, color: '#991B1B', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Trash2 size={20} color="#DC2626" />
              <span>Erase All My Data</span>
            </h4>
            <p style={{ fontSize: '0.8125rem', color: '#7F1D1D', marginTop: '4px', lineHeight: 1.4 }}>
              Permanently delete your Encrypted Vault, session history, logs, and backend session data. The app will restart to the first-run state.
            </p>
          </div>

          <button
            onClick={() => setShowEraseConfirm(true)}
            style={{
              background: '#DC2626',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: '10px 18px',
              fontWeight: 800,
              fontSize: '0.875rem',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Erase All Data
          </button>
        </div>
      </div>

      {/* Footer info */}
      <div
        style={{
          marginTop: '10px',
          paddingTop: '16px',
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
        <div style={{ fontWeight: 600, color: '#0F2E23' }}>
          Built for Education & Privacy Security
        </div>
      </div>

      {/* Erase All Confirmation Modal */}
      {showEraseConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(6px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            style={{
              maxWidth: '460px',
              width: '100%',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1.5px solid #FCA5A5',
              padding: '28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '18px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#DC2626' }}>
              <AlertTriangle size={28} />
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#991B1B' }}>
                Erase All Data & Reset App?
              </h3>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
              This will permanently delete:
            </p>
            <ul style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', paddingLeft: '20px', margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <li>Encrypted Vault file and all saved profiles</li>
              <li>Session history metadata store</li>
              <li>Local application logs</li>
              <li>Backend session states</li>
            </ul>

            <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#991B1B', margin: 0 }}>
              The application will automatically restart to the first-run welcome setup screen.
            </p>

            {eraseError && (
              <div style={{ fontSize: '0.8125rem', color: '#DC2626', fontWeight: 600 }}>
                Error: {eraseError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button
                disabled={isErasing}
                onClick={() => setShowEraseConfirm(false)}
                style={{
                  padding: '10px 18px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  fontWeight: 600,
                  cursor: isErasing ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                disabled={isErasing}
                onClick={handleEraseAllData}
                style={{
                  padding: '10px 22px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: '#DC2626',
                  color: '#FFFFFF',
                  fontWeight: 800,
                  cursor: isErasing ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                {isErasing ? <RefreshCw size={16} className="animate-spin" /> : <Trash2 size={16} />}
                <span>Yes, Erase Everything</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
