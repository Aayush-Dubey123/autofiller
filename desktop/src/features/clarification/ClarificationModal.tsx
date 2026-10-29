import React, { useEffect, useState } from 'react';
import { HelpCircle, Send, X } from 'lucide-react';

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
        backgroundColor: 'rgba(5, 8, 16, 0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '540px',
          minHeight: '460px',
          padding: '28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '2px solid rgba(245, 158, 11, 0.5)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35), 0 0 24px rgba(245, 158, 11, 0.15)',
          position: 'relative',
          color: 'var(--text-primary)',
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
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 800,
                      color: '#92400E',
                      background: '#FEF3C7',
                      padding: '3px 10px',
                      borderRadius: 'var(--radius-full)',
                      border: '1px solid #FCD34D',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Human Clarification
                  </span>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: 'var(--text-title)',
                      background: 'var(--bg-surface-subtle)',
                      padding: '3px 10px',
                      borderRadius: 'var(--radius-full)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    Question {currentIndex} of {total}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: '0.8125rem',
                    color: 'var(--text-secondary)',
                    fontWeight: 600,
                    marginTop: '4px',
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
                  background: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '6px',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <X size={18} />
              </button>
            )}
          </div>

          {/* Stepper Progress Bar */}
          <div
            style={{
              width: '100%',
              height: '6px',
              backgroundColor: 'var(--bg-surface-hover, #E2DDD3)',
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
                        ? 'var(--status-success, #10B981)'
                        : isCurrent
                        ? '#F59E0B'
                        : 'var(--border-subtle, #CBD5E1)',
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
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Field Reference: {prompt.fieldRef}
            </span>
            <h3
              style={{
                fontSize: '1.25rem',
                fontWeight: 800,
                color: 'var(--text-title)',
                marginTop: '3px',
                marginBottom: '4px',
              }}
            >
              {prompt.fieldLabel}
            </h3>
          </div>

          <p style={{ fontSize: '0.9375rem', color: 'var(--text-primary)', lineHeight: 1.6, fontWeight: 500, margin: 0 }}>
            {prompt.question}
          </p>
          <form
            onSubmit={handleSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}
          >
            {/* Suggested Options */}
            {prompt.options.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '0.78125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
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
                      style={{
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        borderRadius: 'var(--radius-md)',
                        border:
                          selectedOption === opt
                            ? '2px solid var(--status-success, #16654E)'
                            : '1px solid var(--border-subtle)',
                        background:
                          selectedOption === opt
                            ? 'rgba(22, 101, 78, 0.08)'
                            : 'var(--bg-surface-subtle)',
                        transition: 'all 0.15s ease',
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
                        style={{ accentColor: 'var(--status-success, #16654E)' }}
                      />
                      <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: selectedOption === opt ? 700 : 500 }}>
                        {opt}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Custom Input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '0.78125rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
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
                  background: 'var(--bg-surface-subtle)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  outline: 'none',
                }}
              />
            </div>

            {/* Action Bar */}
            <div style={{ marginTop: 'auto', paddingTop: '10px' }}>
              <button
                type="submit"
                disabled={isDisabled || (!selectedOption && !customValue.trim())}
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background:
                    isDisabled || (!selectedOption && !customValue.trim())
                      ? 'var(--bg-surface-hover, #E2DDD3)'
                      : 'var(--status-success, #16654E)',
                  color:
                    isDisabled || (!selectedOption && !customValue.trim())
                      ? 'var(--text-muted, #64748B)'
                      : '#FFFFFF',
                  fontWeight: 800,
                  fontSize: '0.90625rem',
                  cursor:
                    isDisabled || (!selectedOption && !customValue.trim())
                      ? 'not-allowed'
                      : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow:
                    isDisabled || (!selectedOption && !customValue.trim())
                      ? 'none'
                      : '0 4px 14px rgba(22, 101, 78, 0.3)',
                  transition: 'all 0.2s ease',
                }}
              >
                <Send size={15} />
                <span>{isDisabled ? 'Delivering Answer...' : 'Confirm & Resume Agent'}</span>
              </button>
              <div
                style={{
                  textAlign: 'center',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
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
