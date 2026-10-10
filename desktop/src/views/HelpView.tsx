import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { bridge } from '../lib/bridge';

export const HelpView: React.FC = () => {
  const [version, setVersion] = useState<string>('1.0.0');

  useEffect(() => {
    bridge.appVersion().then(setVersion).catch(() => setVersion('1.0.0'));
  }, []);

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
                Store Details in My Details or Upload Document
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Manage your personal data under <strong>My Details</strong>, or extract facts from uploaded PDFs and images.
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
                Choose your data source (Saved Profile or Uploaded Document) and enter the target web form URL.
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
                Click <strong>Start Automation</strong>. Playwright opens the browser window and maps facts to fields under your supervision.
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
                Once form filling is verified, the agent stops at <strong>REVIEW_READY</strong>. AutoFiller never submits forms automatically. You review the filled form in the browser window and submit manually.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Honest Privacy Notice Card */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F2E23' }}>
          Privacy & Data Processing Policy
        </h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Field labels are sent to AI for matching; your values stay on this device; uploaded documents are processed by Gemini.
        </p>
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
          Built for Education & Safety
        </div>
      </div>
    </div>
  );
};
