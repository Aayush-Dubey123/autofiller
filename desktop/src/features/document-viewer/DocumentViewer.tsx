import React, { useState } from 'react';
import { FileText, Upload, CheckCircle, Search, ShieldCheck, Plus, Check } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

export interface ExtractedFact {
  key: string;
  label: string;
  value: string;
  confidence: number;
}

interface DocumentViewerProps {
  documentName?: string;
  documentPath?: string;
  facts: ExtractedFact[];
  onSelectDocument: () => void;
  onAddFact?: (fact: ExtractedFact) => void;
  onFileDrop?: (file: File) => void;
  loading?: boolean;
}

export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  documentName,
  documentPath,
  facts,
  onSelectDocument,
  onAddFact,
  onFileDrop,
  loading = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newValue, setNewValue] = useState('');

  const filteredFacts = facts.filter(
    (f) =>
      f.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.value.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.key.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (onFileDrop) onFileDrop(file);
    }
  };

  const handleCreateFact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabel.trim() || !newValue.trim()) return;

    if (onAddFact) {
      onAddFact({
        key: newLabel.toLowerCase().trim().replace(/\s+/g, '_'),
        label: newLabel.trim(),
        value: newValue.trim(),
        confidence: 1.0,
      });
    }

    setNewLabel('');
    setNewValue('');
    setShowAddForm(false);
  };

  return (
    <Card
      title="Source Document"
      subtitle="Extracted student credentials & verification facts"
      action={
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus size={14} />}
            onClick={() => setShowAddForm(!showAddForm)}
          >
            {showAddForm ? 'Cancel' : 'Add Fact'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Upload size={14} />}
            onClick={onSelectDocument}
            loading={loading}
          >
            {documentName ? 'Change' : 'Select'}
          </Button>
        </div>
      }
    >
      {/* Drag & Drop Card / File Info */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={documentName ? undefined : onSelectDocument}
        className="glass-card"
        style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          border: isDragging
            ? '2px dashed #06b6d4'
            : documentName
            ? '1px solid var(--border-subtle)'
            : '2px dashed rgba(255, 255, 255, 0.14)',
          borderLeft: documentName && !isDragging ? '4px solid var(--accent-primary)' : undefined,
          background: isDragging ? 'rgba(6, 182, 212, 0.08)' : undefined,
          cursor: documentName ? 'default' : 'pointer',
          transition: 'all 0.2s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <FileText size={22} color={isDragging ? '#06b6d4' : '#818cf8'} />
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9375rem', color: '#f1f5f9' }}>
              {isDragging ? 'Drop Document Here' : documentName || 'Drop or Choose Document'}
            </div>
            <div
              style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                maxWidth: '300px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {documentPath || (isDragging ? 'Release to upload' : 'Drag PDF, PNG, JPG, or click to browse')}
            </div>
          </div>
        </div>
        {documentName && (
          <span className="badge badge-indigo">
            <ShieldCheck size={12} /> {facts.length} Facts
          </span>
        )}
      </div>

      {/* Inline Add Custom Fact Form */}
      {showAddForm && (
        <form
          onSubmit={handleCreateFact}
          className="glass-card"
          style={{
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            border: '1px solid rgba(99, 102, 241, 0.3)',
          }}
        >
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#a5b4fc' }}>
            Add Custom Student Fact
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <input
              type="text"
              placeholder="Field Label (e.g. Passport No)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              style={{
                padding: '6px 10px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: '#f8fafc',
                fontSize: '0.8125rem',
                outline: 'none',
              }}
            />
            <input
              type="text"
              placeholder="Value (e.g. A1234567)"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              style={{
                padding: '6px 10px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: '#f8fafc',
                fontSize: '0.8125rem',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              icon={<Check size={12} />}
              disabled={!newLabel.trim() || !newValue.trim()}
            >
              Add Fact
            </Button>
          </div>
        </form>
      )}

      {/* Facts Search and List */}
      {facts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
          <div style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{ position: 'absolute', left: '12px', top: '12px', color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              placeholder="Filter extracted facts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 36px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.8125rem',
                fontFamily: 'var(--font-sans)',
                outline: 'none',
              }}
            />
          </div>

          <div
            style={{
              maxHeight: '260px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              paddingRight: '4px',
            }}
          >
            {filteredFacts.map((fact, i) => (
              <div
                key={`${fact.key}_${i}`}
                className="glass-card"
                style={{
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    {fact.label}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#f8fafc' }}>
                    {fact.value}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="badge badge-emerald">
                    <CheckCircle size={10} /> {Math.round(fact.confidence * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};
