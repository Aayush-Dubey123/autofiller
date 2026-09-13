import React from 'react';
import { Globe, Play, Sparkles, AlertCircle } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

interface SessionLauncherProps {
  targetUrl: string;
  onUrlChange: (url: string) => void;
  instruction: string;
  onInstructionChange: (instruction: string) => void;
  onStart: () => void;
  isRunning: boolean;
  canStart: boolean;
  mockFormFilePath?: string;
}

export const SessionLauncher: React.FC<SessionLauncherProps> = ({
  targetUrl,
  onUrlChange,
  instruction,
  onInstructionChange,
  onStart,
  isRunning,
  canStart,
  mockFormFilePath,
}) => {
  const presets = [
    {
      label: '🏫 Local School Admission Form',
      url: mockFormFilePath || 'http://127.0.0.1:8000/mock_school_form.html',
      instruction: 'Fill out Grade 10 student admission form using extracted student details',
    },
  ];

  return (
    <Card
      title="Target Web Form & Operator Instruction"
      subtitle="Configure target form URL and automation guidance for Phase 1"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Target Form Web Address (URL)
          </label>
          <div style={{ position: 'relative' }}>
            <Globe
              size={16}
              style={{ position: 'absolute', left: '12px', top: '13px', color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              value={targetUrl}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="https://admissions.school.edu/register"
              disabled={isRunning}
              style={{
                width: '100%',
                padding: '10px 14px 10px 38px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '0.875rem',
                fontFamily: 'var(--font-mono)',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Instruction Field */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Operator Instruction
          </label>
          <input
            type="text"
            value={instruction}
            onChange={(e) => onInstructionChange(e.target.value)}
            placeholder="e.g. Fill school application form using student document"
            disabled={isRunning}
            style={{
              width: '100%',
              padding: '10px 14px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              fontSize: '0.875rem',
              outline: 'none',
            }}
          />
        </div>

        {/* Preset chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Quick Selector:</span>
          {presets.map((preset) => (
            <button
              key={preset.label}
              disabled={isRunning}
              onClick={() => {
                onUrlChange(preset.url);
                if (preset.instruction) onInstructionChange(preset.instruction);
              }}
              style={{
                background: targetUrl === preset.url ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                border:
                  targetUrl === preset.url
                    ? '1px solid var(--accent-primary)'
                    : '1px solid var(--border-subtle)',
                color: targetUrl === preset.url ? '#a5b4fc' : 'var(--text-secondary)',
                borderRadius: 'var(--radius-full)',
                padding: '4px 10px',
                fontSize: '0.75rem',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Security Policy Reminder */}
        <div
          style={{
            background: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            borderRadius: 'var(--radius-sm)',
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            fontSize: '0.75rem',
            color: '#c7d2fe',
          }}
        >
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>Phase 1 Policy Enforcement:</strong> Automated final form submission is disabled by policy
            (<code>DENIED_FINAL_SUBMISSION</code>). AutoFiller populates, verifies, and halts cleanly at{' '}
            <strong>REVIEW_READY</strong> for mandatory human review.
          </div>
        </div>

        {/* Start Button */}
        <Button
          size="lg"
          variant="primary"
          icon={isRunning ? undefined : <Play size={16} fill="currentColor" />}
          loading={isRunning}
          disabled={!canStart || isRunning}
          onClick={onStart}
          style={{ width: '100%', marginTop: '4px' }}
        >
          {isRunning ? 'AutoFiller Agent In Progress...' : 'Start Phase 1 Automation'}
        </Button>
      </div>
    </Card>
  );
};
