import React, { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, FileText, Play, RefreshCw } from 'lucide-react';
import { bridge } from '../lib/bridge';
import type { DocumentRecord } from '../types/autofiller';

interface DocumentsViewProps {
  onUseDocument: (doc: DocumentRecord) => void;
}

export const DocumentsView: React.FC<DocumentsViewProps> = ({ onUseDocument }) => {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadDocuments = () => {
    setLoading(true);
    bridge
      .listDocuments()
      .then(setDocuments)
      .catch(() => setDocuments([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDocuments();
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0F2E23' }}>
            Processed Documents
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Document facts extracted during earlier runs. Re-use any document in a new session.
          </p>
        </div>
        <button
          onClick={loadDocuments}
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
          Loading processed documents...
        </div>
      ) : documents.length === 0 ? (
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
          <FileText size={48} color="#16654E" style={{ margin: '0 auto 12px auto', opacity: 0.4 }} />
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#0F2E23' }}>
            No Processed Documents Found
          </h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Upload and extract a document in a session to save it here for future use.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {documents.map((doc) => {
            const isExpanded = expandedId === doc.id;
            return (
              <div
                key={doc.id}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-md)',
                  padding: '18px 20px',
                  border: '1px solid var(--border-subtle)',
                  boxShadow: 'var(--shadow-card)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <FileText size={20} color="#16654E" />
                    <div>
                      <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0F2E23' }}>
                        {doc.name}
                      </div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          marginTop: '2px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                        }}
                      >
                        <span>{(doc.size / 1024).toFixed(0)} KB</span>
                        <span>•</span>
                        <span>{doc.facts.length} Extracted Facts</span>
                        <span>•</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Calendar size={12} />
                          {new Date(doc.extractedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : doc.id)}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '6px 12px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      {isExpanded ? 'Hide Facts' : 'View Facts'}
                    </button>
                    <button
                      onClick={() => onUseDocument(doc)}
                      style={{
                        background: '#16654E',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        padding: '6px 14px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      <Play size={13} fill="#FFFFFF" />
                      <span>Use This Document</span>
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div
                    style={{
                      background: '#F9F8F5',
                      borderRadius: 'var(--radius-sm)',
                      padding: '14px',
                      border: '1px solid var(--border-subtle)',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                      gap: '8px',
                      marginTop: '4px',
                    }}
                  >
                    {doc.facts.map((fact, i) => (
                      <div
                        key={i}
                        style={{
                          fontSize: '0.75rem',
                          padding: '6px 8px',
                          background: '#FFFFFF',
                          borderRadius: '4px',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
                          {fact.label}:{' '}
                        </span>
                        <span style={{ fontWeight: 700, color: '#0F2E23' }}>{fact.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
