import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Globe,
  History,
  RefreshCw,
  Trash2,
  CheckSquare,
  Square,
  AlertTriangle,
  User,
  Layers,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react';
import { bridge } from '../lib/bridge';
import type { SessionRecord } from '../types/autofiller';

export const HistoryView: React.FC = () => {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const list = await bridge.listSessions();
      setSessions(list);
      setSelectedIds(new Set());
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const toggleSelectAll = () => {
    if (selectedIds.size === sessions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sessions.map((s) => s.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleDeleteOne = async (id: string) => {
    await bridge.deleteHistorySession(id);
    await loadHistory();
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    await bridge.deleteHistorySessions(Array.from(selectedIds));
    await loadHistory();
  };

  const handleClearAll = async () => {
    await bridge.clearAllHistory();
    setShowClearConfirm(false);
    await loadHistory();
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'REVIEW_READY':
      case 'COMPLETED':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#F0FDF4', color: '#16654E', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid #86EFAC' }}>
            <CheckCircle size={12} />
            <span>Ready / Complete</span>
          </span>
        );
      case 'ERROR':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#FEF2F2', color: '#991B1B', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid #FCA5A5' }}>
            <XCircle size={12} />
            <span>Error</span>
          </span>
        );
      case 'INTERRUPTED':
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#FFFBEB', color: '#B45309', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid #FCD34D' }}>
            <Clock size={12} />
            <span>Interrupted</span>
          </span>
        );
      default:
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#F1F5F9', color: '#475569', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, border: '1px solid #CBD5E1' }}>
            <span>{status}</span>
          </span>
        );
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Header & Global Actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History size={22} color="#16654E" />
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F2E23' }}>Session History</h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Metadata records of past automation runs (strictly value-free).
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {selectedIds.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              style={{
                background: '#FEF2F2',
                color: '#DC2626',
                border: '1px solid #FCA5A5',
                borderRadius: 'var(--radius-md)',
                padding: '8px 14px',
                fontSize: '0.8125rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Trash2 size={14} />
              <span>Delete Selected ({selectedIds.size})</span>
            </button>
          )}

          {sessions.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              style={{
                background: 'var(--bg-card)',
                color: '#DC2626',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 14px',
                fontSize: '0.8125rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <Trash2 size={14} />
              <span>Clear All</span>
            </button>
          )}

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
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading metadata records...
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
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F2E23' }}>No Session History Found</h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Start an automation session to view run metadata here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Select All Bar */}
          <div
            style={{
              padding: '10px 16px',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'var(--text-secondary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={toggleSelectAll}>
              {selectedIds.size === sessions.length ? <CheckSquare size={16} color="#16654E" /> : <Square size={16} color="#94A3B8" />}
              <span>Select All ({sessions.length} sessions)</span>
            </div>
            <span>Showing Metadata Only (Privacy Safe)</span>
          </div>

          {/* Session Record List */}
          {sessions.map((session) => {
            const isSelected = selectedIds.has(session.id);
            return (
              <div
                key={session.id}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px 20px',
                  border: `1px solid ${isSelected ? '#86EFAC' : 'var(--border-subtle)'}`,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div onClick={() => toggleSelect(session.id)} style={{ cursor: 'pointer', flexShrink: 0 }}>
                    {isSelected ? <CheckSquare size={18} color="#16654E" /> : <Square size={18} color="#94A3B8" />}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.9375rem', color: '#0F2E23', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Globe size={15} color="#16654E" />
                        {session.hostAndPath}
                      </span>
                      {getStatusBadge(session.status)}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '0.75rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Calendar size={13} />
                        {new Date(session.date).toLocaleString()}
                      </span>
                      {session.profileName && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <User size={13} />
                          Profile: {session.profileName}
                        </span>
                      )}
                      {session.dataSource && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Layers size={13} />
                          Source: {session.dataSource}
                        </span>
                      )}
                    </div>

                    {session.error && (
                      <div style={{ fontSize: '0.75rem', color: '#991B1B', marginTop: '2px' }}>
                        Reason: {session.error}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.9375rem', fontWeight: 800, color: '#16654E' }}>
                      {session.fieldsFilled} {session.totalFields ? `/ ${session.totalFields}` : ''}
                    </div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Fields Filled</div>
                  </div>

                  <button
                    onClick={() => handleDeleteOne(session.id)}
                    title="Delete session metadata"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#DC2626',
                      cursor: 'pointer',
                      padding: '6px',
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Clear All Confirmation Modal */}
      {showClearConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div
            style={{
              maxWidth: '420px',
              width: '100%',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#DC2626' }}>
              <AlertTriangle size={24} />
              <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0F2E23' }}>Clear All History?</h3>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              This will permanently delete all metadata session records. This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button
                onClick={() => setShowClearConfirm(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleClearAll}
                style={{
                  padding: '8px 20px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: '#DC2626',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Yes, Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
