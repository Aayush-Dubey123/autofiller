import React, { useEffect, useState } from 'react';
import { HelpCircle, Lock, ShieldAlert, Sparkles } from 'lucide-react';
import { bridge } from '../lib/bridge';

export const HelpView: React.FC = () => {
  const [version, setVersion] = useState<string>('1.0.0');

  useEffect(() => {
    bridge.appVersion().then(setVersion).catch(() => setVersion('1.0.0'));
  }, []);

  const steps = [
    {
      num: 1,
      color: '#16654E',
      title: 'Store Details or Select Document',
      desc: 'Save your profile once under My Details, or extract facts from uploaded PDFs and images on demand.',
    },
    {
      num: 2,
      color: '#0F4C3A',
      title: 'Choose Source & Form URL',
      desc: 'Select your data source (Vault Profile or Uploaded Document) and paste the target web form URL.',
    },
    {
      num: 3,
      color: '#2563EB',
      title: 'Supervise Automation Live',
      desc: 'Start automation. Playwright opens the browser window and maps facts to form fields under your live observation.',
    },
    {
      num: 4,
      color: '#059669',
      title: 'Human Review & Manual Submit',
      desc: 'Form filling strictly halts at REVIEW_READY. You inspect the filled form in the browser and click submit manually.',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1040px', margin: '0 auto' }}>
      {/* Canonical Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <HelpCircle size={22} color="#16654E" />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F2E23' }}>Usage & Privacy Guide</h1>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              background: '#D9EFE0',
              color: '#0F4C3A',
              marginLeft: '4px',
            }}
          >
            v{version}
          </span>
        </div>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Automated document extraction to web form filling with strict human-in-the-loop safety.
        </p>
      </div>

      {/* Workflow Steps Card (Compact 2x2 Grid) */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={18} color="#16654E" />
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F2E23' }}>
              How AutoFiller Works in 4 Steps
            </h3>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            Zero-friction local workflow
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
          {steps.map((s) => (
            <div
              key={s.num}
              style={{
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-start',
                padding: '14px',
                borderRadius: 'var(--radius-md)',
                background: '#F9F8F5',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: s.color,
                  color: '#FFFFFF',
                  fontWeight: 800,
                  fontSize: '0.8125rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {s.num}
              </div>
              <div>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F2E23' }}>
                  {s.title}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '3px', lineHeight: 1.45 }}>
                  {s.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 2-Column Split: Privacy Notice & Never-Submit Guarantee */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Privacy Notice Card */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Lock size={18} color="#16654E" />
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>
              Privacy & Data Processing Policy
            </h3>
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Field labels are sent to AI for matching; your values stay on this device; uploaded documents are processed by Gemini. No personal values are ever logged in traces or persisted without encryption.
          </p>
        </div>

        {/* Safety Guarantee Card */}
        <div
          style={{
            background: '#D9EFE0',
            border: '1.5px solid #16654E',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            boxShadow: 'var(--shadow-card)',
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-start',
          }}
        >
          <ShieldAlert size={22} color="#0F4C3A" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <h3 style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#0F4C3A' }}>
              Never-Submit Safety Guarantee
            </h3>
            <p style={{ fontSize: '0.8125rem', color: '#16654E', marginTop: '4px', lineHeight: 1.5 }}>
              AutoFiller PolicyEngine strictly enforces that form submission is never automated. Automation always stops at <strong>REVIEW_READY</strong> so you retain 100% control over form submission.
            </p>
          </div>
        </div>
      </div>

      {/* Footer Info Bar */}
      <div
        style={{
          paddingTop: '12px',
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
          Safe Local Storage • Human-in-the-Loop Architecture
        </div>
      </div>
    </div>
  );
};
