import React, { useEffect, useRef } from 'react';
import { Terminal, CheckCircle2, Clock, AlertTriangle, ShieldAlert, Zap } from 'lucide-react';
import { Card } from '../../components/ui/Card';

export interface AgentEvent {
  eventId: string;
  timestamp: string;
  type: string;
  tool?: string;
  description: string;
  success?: boolean;
  metadata?: Record<string, any>;
}

interface AgentTimelineProps {
  events: AgentEvent[];
  activeStep?: string;
}

export const AgentTimeline: React.FC<AgentTimelineProps> = ({ events }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const getEventIcon = (event: AgentEvent) => {
    if (event.type === 'POLICY_BLOCKED') {
      return <ShieldAlert size={14} color="#f59e0b" />;
    }
    if (event.type === 'TOOL_FAILED') {
      return <AlertTriangle size={14} color="#f43f5e" />;
    }
    if (event.type === 'TOOL_COMPLETED') {
      return <CheckCircle2 size={14} color="#10b981" />;
    }
    if (event.type === 'TOOL_STARTED') {
      return <Zap size={14} color="#818cf8" />;
    }
    return <Clock size={14} color="#94a3b8" />;
  };

  const getEventBadge = (event: AgentEvent) => {
    if (event.type === 'POLICY_BLOCKED') {
      const isDeniedSubmit =
        event.metadata?.code === 'DENIED_FINAL_SUBMISSION' ||
        event.description.includes('DENIED_FINAL_SUBMISSION');
      return (
        <span className="badge badge-amber">
          {isDeniedSubmit ? 'DENIED_FINAL_SUBMISSION' : 'Policy Guard'}
        </span>
      );
    }
    if (event.tool) {
      return <span className="badge badge-indigo">{event.tool}</span>;
    }
    return <span className="badge badge-cyan">{event.type}</span>;
  };

  return (
    <Card
      title="Agent Execution Timeline"
      subtitle="Observable live events, tool dispatches, and policy checks"
      style={{ flex: 1, minHeight: '380px' }}
    >
      {events.length === 0 ? (
        <div
          style={{
            height: '280px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}
        >
          <Terminal size={32} strokeWidth={1.5} />
          <div style={{ fontSize: '0.875rem' }}>No events recorded yet</div>
          <div style={{ fontSize: '0.75rem' }}>
            Start an automation session to stream observable agent actions.
          </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          style={{
            maxHeight: '380px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            paddingRight: '6px',
          }}
        >
          {events.map((evt, idx) => (
            <div
              key={`${evt.eventId}_${idx}`}
              className="glass-card"
              style={{
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                borderLeft:
                  evt.type === 'POLICY_BLOCKED'
                    ? '3px solid var(--accent-amber)'
                    : evt.type === 'TOOL_FAILED'
                    ? '3px solid var(--accent-rose)'
                    : evt.type === 'TOOL_COMPLETED'
                    ? '3px solid var(--accent-emerald)'
                    : '3px solid var(--accent-primary)',
              }}
            >
              <div style={{ marginTop: '2px', flexShrink: 0 }}>{getEventIcon(evt)}</div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#f1f5f9' }}>
                    {evt.description}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    {getEventBadge(evt)}
                    <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
                {Array.isArray(evt.metadata?.controls) && evt.metadata.controls.length > 0 && (
                  <div style={{ fontSize: '0.75rem', color: '#fbbf24', marginTop: '2px' }}>
                    Protected control(s): {evt.metadata.controls.map((c: any) => c.label || c.selector).join(', ')}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
