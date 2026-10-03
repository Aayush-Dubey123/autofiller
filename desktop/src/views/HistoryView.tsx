import React, { useEffect, useState } from 'react';
import { Calendar, ExternalLink, FileText, Globe, History, RefreshCw } from 'lucide-react';
import { bridge } from '../lib/bridge';
import type { SessionRecord } from '../types/autofiller';

export const HistoryView: React.FC = () => {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const loadHistory = () => {
    setLoading(true);
    bridge
      .listSessions()
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadHistory();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F2E23' }}>
            Session History
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Past automation runs persisted across restarts in Electron userData JSON storage.
          </p>
        </div>
        <button
          onClick={loadHistory}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 14px',
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: '#0F2E23',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer',
          }}
        >
          <RefreshCw size={14} className={loading ? 'spinning' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading session history...
        </div>
      ) : sessions.length === 0 ? (
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '48px 24px',
            textAlign: 'center',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <History size={48} color="#16654E" style={{ margin: '0 auto 12px auto', opacity: 0.4 }} />
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F2E23' }}>
            No Session History Found
          </h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Start an automation session to record runs here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {sessions.map((session) => (
            <div
              key={session.id}
              style={{
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius-md)',
                padding: '16px 20px',
                border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-card)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <FileText size={16} color="#16654E" />
                  <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#0F2E23' }}>
                    {session.documentName}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Calendar size={13} />
                    {new Date(session.startedAt).toLocaleString()}
                  </span>
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '300px',
                    }}
                  >
                    <Globe size={13} />
                    {session.targetUrl}
                  </span>
                </div>

                {session.error && (
                  <div style={{ fontSize: '0.75rem', color: '#991B1B', marginTop: '4px' }}>
                    Error: {session.error}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 800, color: '#16654E' }}>
                    {session.fieldsFilled}
                  </div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                    Fields Filled
                  </div>
                </div>

                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-full)',
                    background:
                      session.status === 'REVIEW_READY' || session.status === 'COMPLETED'
                        ? '#D9EFE0'
                        : session.status === 'ERROR'
                        ? '#FEE2E2'
                        : '#FEF3C7',
                    color:
                      session.status === 'REVIEW_READY' || session.status === 'COMPLETED'
                        ? '#0F4C3A'
                        : session.status === 'ERROR'
                        ? '#991B1B'
                        : '#92400E',
                  }}
                >
                  {session.status}
                </span>

                <button
                  onClick={() => window.open(session.targetUrl, '_blank')}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 10px',
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <ExternalLink size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
