import React from 'react';
import { Pause, Play, UserCheck, Square, Activity, CheckCircle2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';

interface ControlBarProps {
  state: string;
  onPause: () => void;
  onResume: () => void;
  onTakeOver: () => void;
  onStop: () => void;
  onSubmitForm?: () => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  state,
  onPause,
  onResume,
  onTakeOver,
  onStop,
  onSubmitForm,
}) => {
  const isRunning =
    state === 'EXTRACTING_DOC' ||
    state === 'SCANNING_FORM' ||
    state === 'MAPPING_FIELDS' ||
    state === 'FILLING_FORM' ||
    state === 'VERIFYING';
  const isPaused = state === 'PAUSED';
  const isTakeover = state === 'USER_TAKEOVER';
  const isReviewReady = state === 'REVIEW_READY';
  const isCompleted = state === 'COMPLETED';

  const getStateBadge = () => {
    switch (state) {
      case 'IDLE':
        return <span className="badge badge-cyan">Ready</span>;
      case 'EXTRACTING_DOC':
        return <span className="badge badge-indigo pulsing-indicator">Reading Doc</span>;
      case 'SCANNING_FORM':
        return <span className="badge badge-indigo pulsing-indicator">Scanning Form</span>;
      case 'MAPPING_FIELDS':
        return <span className="badge badge-indigo pulsing-indicator">Mapping Fields</span>;
      case 'CLARIFICATION_REQUIRED':
        return <span className="badge badge-amber pulsing-indicator">Clarification Required</span>;
      case 'FILLING_FORM':
        return <span className="badge badge-indigo pulsing-indicator">Filling Form</span>;
      case 'VERIFYING':
        return <span className="badge badge-cyan pulsing-indicator">Verifying</span>;
      case 'REVIEW_READY':
        return (
          <span className="badge badge-emerald">
            <CheckCircle2 size={12} /> Review Ready
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="badge badge-emerald">
            <CheckCircle2 size={12} /> Application Submitted
          </span>
        );
      case 'PAUSED':
        return <span className="badge badge-amber">Paused</span>;
      case 'USER_TAKEOVER':
        return <span className="badge badge-rose">Human Takeover Active</span>;
      case 'ERROR':
        return <span className="badge badge-rose">Error</span>;
      default:
        return <span className="badge badge-cyan">{state}</span>;
    }
  };

  return (
    <div
      className="glass-card"
      style={{
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        border: isReviewReady
          ? '1px solid rgba(16, 185, 129, 0.4)'
          : isPaused || isTakeover
          ? '1px solid rgba(245, 158, 11, 0.4)'
          : '1px solid var(--border-subtle)',
        background: isReviewReady
          ? 'rgba(16, 185, 129, 0.06)'
          : 'var(--bg-glass)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={18} color="#818cf8" />
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Status:
          </span>
        </div>
        {getStateBadge()}
        {isReviewReady && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginLeft: '8px' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#10b981' }}>
              Form filled and verified — ready for human review.
            </span>
            <span style={{ fontSize: '0.75rem', color: '#a7f3d0' }}>
              Final submission is disabled. The user must review and submit manually.
            </span>
          </div>
        )}
        {isCompleted && (
          <span style={{ fontSize: '0.8125rem', color: '#10b981', marginLeft: '8px' }}>
            Form reviewed and manually submitted by operator. Workflow complete.
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Operator Submit Application */}
        {(isReviewReady || isTakeover) && onSubmitForm && (
          <Button
            size="sm"
            variant="primary"
            style={{
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              border: 'none',
              boxShadow: '0 0 14px rgba(16, 185, 129, 0.4)',
              fontWeight: 700,
              padding: '6px 16px',
            }}
            icon={<CheckCircle2 size={15} />}
            onClick={onSubmitForm}
          >
            Submit Application
          </Button>
        )}

        {/* Pause / Resume */}
        {isRunning && (
          <Button
            size="sm"
            variant="warning"
            icon={<Pause size={14} />}
            onClick={onPause}
          >
            Pause
          </Button>
        )}
        {isPaused && (
          <Button
            size="sm"
            variant="primary"
            icon={<Play size={14} fill="currentColor" />}
            onClick={onResume}
          >
            Resume
          </Button>
        )}

        {/* Take Over */}
        {(isRunning || isPaused) && (
          <Button
            size="sm"
            variant="secondary"
            icon={<UserCheck size={14} />}
            onClick={onTakeOver}
          >
            Take Over
          </Button>
        )}
        {isTakeover && (
          <Button
            size="sm"
            variant="primary"
            icon={<Play size={14} fill="currentColor" />}
            onClick={onResume}
          >
            Hand Back to Agent
          </Button>
        )}

        {/* Stop */}
        {(isRunning || isPaused || isTakeover || isReviewReady) && (
          <Button
            size="sm"
            variant="danger"
            icon={<Square size={14} fill="currentColor" />}
            onClick={onStop}
          >
            Stop
          </Button>
        )}
      </div>
    </div>
  );
};
