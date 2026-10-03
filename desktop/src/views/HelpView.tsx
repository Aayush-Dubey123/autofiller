import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { bridge } from '../lib/bridge';

export const HelpView: React.FC = () => {
  const [version, setVersion] = useState<string>('1.0.0');

  useEffect(() => {
    bridge.appVersion().then(setVersion).catch(() => setVersion('1.0.0'));
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '800px' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F2E23' }}>
          AutoFiller AI — Usage Guide
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
                Upload Student Document
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Select a PDF, PNG, JPG, or text document. AutoFiller uses Gemini AI to extract facts (Name, DOB, Email, Address, etc.). You can view and edit the extracted facts before starting.
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
                Specify Target Form URL
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Enter the web form URL. You can also test with the built-in Demo School Form endpoint (<code style={{ background: '#F9F8F5', padding: '2px 4px', borderRadius: '4px' }}>http://127.0.0.1:8000/mock_school_form.html</code>).
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
                Click <strong>Start Automation</strong>. Playwright opens a separate browser window on your screen and maps document facts to DOM fields using Gemini AI.
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

      {/* Help View Footer */}
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
          AutoFiller never submits forms. You review and submit.
        </div>
      </div>
    </div>
  );
};
