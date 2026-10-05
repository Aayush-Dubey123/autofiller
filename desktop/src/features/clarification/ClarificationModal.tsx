import React, { useEffect, useState } from 'react';
import { CheckCircle2, HelpCircle, Send, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';

export interface ClarificationPrompt {
  clarificationId: string;
  fieldRef: string;
  fieldLabel: string;
  question: string;
  options: string[];
  total?: number;
  currentIndex?: number;
}

interface ClarificationModalProps {
  prompt: ClarificationPrompt | null;
  onSubmitAnswer: (clarificationId: string, answer: string) => Promise<boolean | void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  totalClarifications?: number;
  currentClarificationIndex?: number;
}

export const ClarificationModal: React.FC<ClarificationModalProps> = ({
  prompt,
  onSubmitAnswer,
  onCancel,
  isSubmitting = false,
  totalClarifications,
  currentClarificationIndex,
}) => {
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [customValue, setCustomValue] = useState<string>('');
  const [submittingLocal, setSubmittingLocal] = useState<boolean>(false);

  // When prompt advances to the next question, reset answer selections and unlock submission
  useEffect(() => {
    setSelectedOption('');
    setCustomValue('');
    setSubmittingLocal(false);
  }, [prompt?.clarificationId]);

  if (!prompt) return null;

  const total = prompt.total ?? totalClarifications ?? 1;
  const currentIndex = prompt.currentIndex ?? currentClarificationIndex ?? 1;
  const totalMissingText =
    total === 1 ? '1 piece of information needed' : `${total} pieces of information needed`;
  const remainingCount = Math.max(0, total - currentIndex);

  const isDisabled = isSubmitting || submittingLocal;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDisabled) return;

    const answer = customValue.trim() || selectedOption;
    if (answer) {
      setSubmittingLocal(true);
      try {
        const result = await onSubmitAnswer(prompt.clarificationId, answer);
        if (result === false) {
          setSubmittingLocal(false);
        }
      } catch {
        setSubmittingLocal(false);
      }
    }
  };

  const progressPercent = Math.min(100, Math.max(8, (currentIndex / Math.max(total, 1)) * 100));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(5, 8, 16, 0.88)',
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
          maxWidth: '540px',
          minHeight: '480px',
          padding: '28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          border: '1px solid rgba(245, 158, 11, 0.5)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.7), 0 0 30px rgba(245, 158, 11, 0.2)',
          position: 'relative',
        }}
      >
        {/* Stepper Header */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '50%',
                  background: 'rgba(245, 158, 11, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#f59e0b',
                  flexShrink: 0,
                }}
              >
                <HelpCircle size={24} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="badge badge-amber">Human Clarification</span>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: '#fcd34d',
                      background: 'rgba(245, 158, 11, 0.2)',
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      border: '1px solid rgba(245, 158, 11, 0.35)',
                    }}
                  >
                    Question {currentIndex} of {total}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: '0.8125rem',
                    color: '#f59e0b',
                    fontWeight: 600,
                    marginTop: '2px',
                  }}
                >
                  {totalMissingText}
                </div>
              </div>
            </div>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                title="Stop session"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted, #94a3b8)',
                  cursor: 'pointer',
                  padding: '6px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={20} />
              </button>
            )}
          </div>

          {/* Stepper Progress Bar */}
          <div
            style={{
              width: '100%',
              height: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              borderRadius: 'var(--radius-full)',
              overflow: 'hidden',
              marginTop: '4px',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progressPercent}%`,
                background: 'linear-gradient(90deg, #f59e0b 0%, #10b981 100%)',
                borderRadius: 'var(--radius-full)',
                transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
          </div>

          {/* Step dots (when total is reasonable) */}
          {total > 1 && total <= 10 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              {Array.from({ length: total }).map((_, idx) => {
                const stepNum = idx + 1;
                const isPassed = stepNum < currentIndex;
                const isCurrent = stepNum === currentIndex;
                return (
                  <div
                    key={stepNum}
                    style={{
                      flex: 1,
                      height: '4px',
                      borderRadius: 'var(--radius-full)',
                      backgroundColor: isPassed
                        ? '#10b981'
                        : isCurrent
                        ? '#f59e0b'
                        : 'rgba(255, 255, 255, 0.1)',
                      transition: 'background-color 0.3s ease',
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Dynamic Question Container with Continuous In-Place Transition */}
        <div
          key={prompt.clarificationId}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            flex: 1,
          }}
        >
          <div>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Field Reference: {prompt.fieldRef}
            </span>
            <h3
              style={{
                fontSize: '1.2rem',
                fontWeight: 700,
                color: '#f8fafc',
                marginTop: '2px',
              }}
            >
              {prompt.fieldLabel}
            </h3>
          </div>

          <p style={{ fontSize: '0.875rem', color: '#cbd5e1', lineHeight: 1.6 }}>
            {prompt.question}
          </p>

          <form
            onSubmit={handleSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}
          >
            {/* Suggested Options */}
            {prompt.options.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  Suggested Options:
                </span>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    maxHeight: '180px',
                    overflowY: 'auto',
                    paddingRight: '4px',
                  }}
                >
                  {prompt.options.map((opt) => (
                    <label
                      key={opt}
                      className="glass-card"
                      style={{
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        opacity: isDisabled ? 0.7 : 1,
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
                        disabled={isDisabled}
                        onChange={() => {
                          if (isDisabled) return;
                          setSelectedOption(opt);
                          setCustomValue('');
                        }}
                        style={{ accentColor: 'var(--accent-primary)' }}
                      />
                      <span style={{ fontSize: '0.875rem', color: '#f8fafc' }}>{opt}</span>
                    </label>
                  ))}
                </div>
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
                disabled={isDisabled}
                onChange={(e) => {
                  if (isDisabled) return;
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
                  opacity: isDisabled ? 0.7 : 1,
                }}
              />
            </div>

            {/* Action Bar */}
            <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
              <Button
                type="submit"
                variant="warning"
                size="md"
                icon={<Send size={14} />}
                loading={isDisabled}
                disabled={isDisabled || (!selectedOption && !customValue.trim())}
                style={{ width: '100%' }}
              >
                {isDisabled ? 'Delivering Answer...' : 'Confirm & Resume Agent'}
              </Button>

              <div
                style={{
                  textAlign: 'center',
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginTop: '8px',
                }}
              >
                {remainingCount > 0
                  ? `${remainingCount} more input${remainingCount > 1 ? 's' : ''} to clarify after this`
                  : 'Final missing information needed for form automation'}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
