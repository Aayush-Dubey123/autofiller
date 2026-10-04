import React, { useEffect, useState } from 'react';
import {
  FileText,
  Globe,
  History,
  Play,
  PlusCircle,
  ShieldCheck,
  Sprout,
  User,
  Zap,
} from 'lucide-react';
import { bridge } from '../lib/bridge';
import type { DocumentRecord, SessionRecord } from '../types/autofiller';

interface HomeViewProps {
  onNewSession: () => void;
  onOpenDocuments: () => void;
  onOpenHistory: () => void;
  onUseDocument: (doc: DocumentRecord) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onNewSession,
  onOpenDocuments,
  onOpenHistory,
  onUseDocument,
}) => {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);

  useEffect(() => {
    bridge.listSessions().then(setSessions).catch(() => []);
    bridge.listDocuments().then(setDocuments).catch(() => []);
  }, []);

  const completedCount = sessions.filter((s) => s.status === 'REVIEW_READY' || s.status === 'COMPLETED').length;
  const totalFields = sessions.reduce((acc, s) => acc + (s.fieldsFilled || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* First-Run / No Details Card */}
      <div
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1.5px solid #A5DCB4',
          padding: '24px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          boxShadow: '0 4px 16px rgba(22, 101, 78, 0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: '#D9EFE0',
              color: '#0F4C3A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <User size={24} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#0F2E23' }}>
              Add your details once, reuse them on any form
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Save your personal information, address, and contact details encrypted on this device. AutoFiller will map and fill them into any form link.
            </p>
          </div>
        </div>

        <button
          onClick={onOpenDocuments}
          style={{
            background: '#16654E',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: '10px 20px',
            fontSize: '0.875rem',
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Add Your Details
        </button>
      </div>

      {/* 2-Column Split: Recent Documents & Recent History */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* Recent Documents Card */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText size={18} color="#16654E" />
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F2E23' }}>
                Processed Documents
              </h3>
            </div>
            <button
              onClick={onOpenDocuments}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#16654E',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              View All ({documents.length})
            </button>
          </div>

          {documents.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '32px 16px',
                color: 'var(--text-muted)',
                fontSize: '0.875rem',
                background: '#F9F8F5',
                borderRadius: 'var(--radius-md)',
                border: '1px dashed var(--border-subtle)',
              }}
            >
              <FileText size={32} style={{ margin: '0 auto 8px auto', opacity: 0.4 }} />
              <div>No documents processed yet.</div>
              <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>
                Upload a document in a new session to save it here.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {documents.slice(0, 4).map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    background: '#F9F8F5',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F2E23' }}>
                      {doc.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {doc.facts.length} facts • {(doc.size / 1024).toFixed(0)} KB
                    </div>
                  </div>
                  <button
                    onClick={() => onUseDocument(doc)}
                    style={{
                      background: '#D9EFE0',
                      color: '#0F4C3A',
                      border: '1px solid #B7E3C4',
                      borderRadius: 'var(--radius-sm)',
                      padding: '6px 12px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Use Document
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Session History Card */}
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <History size={18} color="#16654E" />
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F2E23' }}>
                Recent History
              </h3>
            </div>
            <button
              onClick={onOpenHistory}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#16654E',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              View All ({sessions.length})
            </button>
          </div>

          {sessions.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '32px 16px',
                color: 'var(--text-muted)',
                fontSize: '0.875rem',
                background: '#F9F8F5',
                borderRadius: 'var(--radius-md)',
                border: '1px dashed var(--border-subtle)',
              }}
            >
              <History size={32} style={{ margin: '0 auto 8px auto', opacity: 0.4 }} />
              <div>No past sessions recorded yet.</div>
              <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>
                Completed form fills will automatically appear here.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {sessions.slice(0, 4).map((session) => (
                <div
                  key={session.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px',
                    borderRadius: 'var(--radius-md)',
                    background: '#F9F8F5',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F2E23' }}>
                      {session.hostAndPath}
                    </div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        marginTop: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '240px',
                      }}
                    >
                      {session.profileName ? `Profile: ${session.profileName}` : new Date(session.date).toLocaleDateString()}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      padding: '4px 10px',
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
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
