import React from 'react';
import { Check, Clock, HelpCircle, Layers } from 'lucide-react';
import { Card } from '../../components/ui/Card';

export interface FieldMappingItem {
  field_ref: string;
  field_label: string;
  fact_key?: string;
  fact_value?: string;
  confidence: number;
  status: string;
}

interface FieldMappingTableProps {
  mappings: FieldMappingItem[];
  onUpdateMapping?: (fieldRef: string, newValue: string) => void;
}

export const FieldMappingTable: React.FC<FieldMappingTableProps> = ({
  mappings,
  onUpdateMapping,
}) => {
  return (
    <Card
      title="Semantic Field Mapping"
      subtitle="AI-synthesized correspondence between document facts and web form elements"
    >
      {mappings.length === 0 ? (
        <div
          style={{
            height: '160px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}
        >
          <Layers size={28} strokeWidth={1.5} />
          <div style={{ fontSize: '0.875rem' }}>No field mappings active</div>
          <div style={{ fontSize: '0.75rem' }}>
            Mappings will populate once the form is scanned and analyzed.
          </div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.8125rem',
              textAlign: 'left',
            }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Form Field</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Mapped Document Fact</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Confidence</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => (
                <tr
                  key={m.field_ref}
                  style={{
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    transition: 'background 0.2s',
                  }}
                >
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ fontWeight: 600, color: '#f8fafc' }}>{m.field_label}</div>
                    <code style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                      {m.field_ref}
                    </code>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {onUpdateMapping ? (
                      <input
                        type="text"
                        value={m.fact_value || ''}
                        onChange={(e) => onUpdateMapping(m.field_ref, e.target.value)}
                        placeholder="[Unmapped]"
                        style={{
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '4px 8px',
                          color: '#f8fafc',
                          fontSize: '0.8125rem',
                          fontFamily: 'var(--font-sans)',
                          width: '100%',
                          maxWidth: '260px',
                        }}
                      />
                    ) : (
                      <span style={{ color: m.fact_value ? '#f8fafc' : 'var(--text-muted)' }}>
                        {m.fact_value || '—'}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span
                      className={`badge ${
                        m.confidence >= 0.8
                          ? 'badge-emerald'
                          : m.confidence >= 0.5
                          ? 'badge-amber'
                          : 'badge-rose'
                      }`}
                    >
                      {Math.round(m.confidence * 100)}%
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {m.status === 'VERIFIED' ? (
                      <span className="badge badge-emerald">
                        <Check size={10} /> Verified
                      </span>
                    ) : m.status === 'CLARIFICATION_REQUIRED' ? (
                      <span className="badge badge-amber">
                        <HelpCircle size={10} /> Clarify
                      </span>
                    ) : (
                      <span className="badge badge-indigo">
                        <Clock size={10} /> {m.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};
