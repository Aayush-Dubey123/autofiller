import React, { useState } from 'react';
import { HelpCircle, Send } from 'lucide-react';
import { Button } from '../../components/ui/Button';

export interface ClarificationPrompt {
  clarificationId: string;
  fieldRef: string;
  fieldLabel: string;
  question: string;
  options: string[];
}

interface ClarificationModalProps {
  prompt: ClarificationPrompt | null;
  onSubmitAnswer: (clarificationId: string, answer: string) => void;
}

export const ClarificationModal: React.FC<ClarificationModalProps> = ({
  prompt,
  onSubmitAnswer,
}) => {
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [customValue, setCustomValue] = useState<string>('');

  if (!prompt) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const answer = customValue.trim() || selectedOption;
    if (answer) {
      onSubmitAnswer(prompt.clarificationId, answer);
      setSelectedOption('');
      setCustomValue('');
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(5, 8, 16, 0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px',
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: '100%',
          maxWidth: '520px',
          padding: '28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          border: '1px solid rgba(245, 158, 11, 0.5)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.7), 0 0 30px rgba(245, 158, 11, 0.2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: 'rgba(245, 158, 11, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#f59e0b',
            }}
          >
            <HelpCircle size={24} />
          </div>
          <div>
            <span className="badge badge-amber" style={{ marginBottom: '4px' }}>
              Human Clarification Required
            </span>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#f8fafc' }}>
              {prompt.fieldLabel}
            </h3>
          </div>
        </div>

        <p style={{ fontSize: '0.875rem', color: '#cbd5e1', lineHeight: 1.6 }}>
          {prompt.question}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Candidate Options */}
          {prompt.options.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                Suggested Options:
              </span>
              {prompt.options.map((opt) => (
                <label
                  key={opt}
                  className="glass-card"
                  style={{
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: 'pointer',
                    border:
                      selectedOption === opt
                        ? '1px solid var(--accent-primary)'
                        : '1px solid var(--border-subtle)',
                    background:
                      selectedOption === opt
                        ? 'rgba(99, 102, 241, 0.15)'
                        : 'rgba(255, 255, 255, 0.03)',
                  }}
                >
                  <input
                    type="radio"
                    name="clarification_option"
                    value={opt}
                    checked={selectedOption === opt}
                    onChange={() => {
                      setSelectedOption(opt);
                      setCustomValue('');
                    }}
                    style={{ accentColor: 'var(--accent-primary)' }}
                  />
                  <span style={{ fontSize: '0.875rem', color: '#f8fafc' }}>{opt}</span>
                </label>
              ))}
            </div>
          )}

          {/* Custom Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              Or type custom answer:
            </span>
            <input
              type="text"
              placeholder="Enter value directly..."
              value={customValue}
              onChange={(e) => {
                setCustomValue(e.target.value);
                setSelectedOption('');
              }}
              style={{
                width: '100%',
                padding: '10px 14px',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: '#f8fafc',
                fontSize: '0.875rem',
                outline: 'none',
              }}
            />
          </div>

          <Button
            type="submit"
            variant="warning"
            size="md"
            icon={<Send size={14} />}
            disabled={!selectedOption && !customValue.trim()}
            style={{ marginTop: '8px' }}
          >
            Confirm & Resume Agent
          </Button>
        </form>
      </div>
    </div>
  );
};
