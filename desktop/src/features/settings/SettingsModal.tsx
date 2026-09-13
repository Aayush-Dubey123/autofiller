import React, { useState, useEffect } from 'react';
import { Settings, Eye, EyeOff, CheckCircle2, AlertTriangle, ExternalLink, Zap, Save, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { bridge } from '../../lib/bridge';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSettingsSaved?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onSettingsSaved,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState('gemini-3.6-flash');
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [maskedKey, setMaskedKey] = useState('');
  const [saveError, setSaveError] = useState('');
  const [headless, setHeadless] = useState(false);
  const [typingDelayMs, setTypingDelayMs] = useState(25);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{
    valid: boolean;
    message: string;
    latency_ms?: number;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      bridge.getSettings().then((settings) => {
        // The stored key is never sent to the renderer; only a masked preview is shown.
        setApiKey('');
        setApiKeyConfigured(Boolean(settings.apiKeyConfigured));
        setMaskedKey(settings.maskedKey || '');
        setModel(settings.geminiModel || 'gemini-3.6-flash');
        setHeadless(Boolean(settings.headless));
        setTypingDelayMs(settings.typingDelayMs || 25);
      });
      setTestResult(null);
      setSaveError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      setTestResult({ valid: false, message: 'Please enter a Gemini API key first.' });
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await bridge.testGemini(apiKey.trim(), model);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({ valid: false, message: err.message || 'Connection failed' });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError('');
    try {
      const result = await bridge.saveSettings({
        // Only send a key when the operator actually typed a new one.
        geminiApiKey: apiKey.trim() || undefined,
        geminiModel: model,
        headless,
        typingDelayMs,
      });
      if (!result.success) {
        setSaveError(result.error || 'Could not save settings.');
        return;
      }
      setApiKeyConfigured(Boolean(result.apiKeyConfigured));
      setMaskedKey(result.maskedKey || '');
      if (onSettingsSaved) onSettingsSaved();
      onClose();
    } catch (err: any) {
      setSaveError(err?.message || 'Could not save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(5, 8, 16, 0.85)',
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
          maxWidth: '560px',
          padding: '28px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          border: '1px solid rgba(99, 102, 241, 0.4)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.7), 0 0 30px rgba(99, 102, 241, 0.2)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(99, 102, 241, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#818cf8',
              }}
            >
              <Settings size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.1875rem', fontWeight: 700, color: '#f8fafc' }}>
                AutoFiller Settings
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Configure Google Gemini AI credentials and browser automation preferences
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Gemini API Key */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Google Gemini API Key
            </label>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: '0.75rem',
                color: '#818cf8',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                textDecoration: 'none',
              }}
            >
              Get Free Key <ExternalLink size={11} />
            </a>
          </div>

          <div style={{ position: 'relative' }}>
            <input
              type={showKey ? 'text' : 'password'}
              placeholder={
                apiKeyConfigured ? `Key configured (${maskedKey}) — type to replace` : 'AIzaSy...'
              }
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setTestResult(null);
              }}
              style={{
                width: '100%',
                padding: '10px 42px 10px 14px',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: '#f8fafc',
                fontSize: '0.875rem',
                fontFamily: 'var(--font-mono)',
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              style={{
                position: 'absolute',
                right: '12px',
                top: '12px',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
            <Button
              size="sm"
              variant="secondary"
              icon={<Zap size={13} />}
              loading={isTesting}
              onClick={handleTestConnection}
            >
              Test Connection
            </Button>

            {testResult && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}>
                {testResult.valid ? (
                  <span className="badge badge-emerald">
                    <CheckCircle2 size={12} /> Connected {testResult.latency_ms ? `(${testResult.latency_ms}ms)` : ''}
                  </span>
                ) : (
                  <span className="badge badge-rose">
                    <AlertTriangle size={12} /> {testResult.message}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Model Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Gemini Reasoning Model
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{
              padding: '10px 14px',
              background: 'rgba(19, 27, 46, 0.9)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: '#f8fafc',
              fontSize: '0.875rem',
              outline: 'none',
            }}
          >
            <option value="gemini-3.6-flash">Gemini 3.6 Flash (Recommended — fast and reliable)</option>
            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
            <option value="gemini-2.5-pro">Gemini 2.5 Pro (Higher reasoning quality)</option>
            <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
            <option value="gemini-1.5-flash">Gemini 1.5 Flash (Legacy)</option>
          </select>
        </div>

        {/* Browser Settings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
          {/* Headless Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#f8fafc' }}>
                Visible Chromium Browser
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Shows browser side-by-side so you can supervise filling live
              </div>
            </div>
            <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!headless}
                onChange={(e) => setHeadless(!e.target.checked)}
                style={{ opacity: 0, width: 0, height: 0 }}
              />
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: !headless ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)',
                  borderRadius: '24px',
                  transition: '0.2s',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    height: '18px',
                    width: '18px',
                    left: !headless ? '22px' : '3px',
                    bottom: '3px',
                    backgroundColor: '#ffffff',
                    borderRadius: '50%',
                    transition: '0.2s',
                  }}
                />
              </span>
            </label>
          </div>

          {/* Typing Delay Slider */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Live Typing Delay</span>
              <span style={{ color: '#818cf8', fontFamily: 'var(--font-mono)' }}>{typingDelayMs} ms/char</span>
            </div>
            <input
              type="range"
              min="5"
              max="80"
              step="5"
              value={typingDelayMs}
              onChange={(e) => setTypingDelayMs(Number(e.target.value))}
              style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
            />
          </div>
        </div>

        {/* Save error */}
        {saveError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}>
            <span className="badge badge-rose">
              <AlertTriangle size={12} /> {saveError}
            </span>
          </div>
        )}

        {/* Footer Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
          <Button variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            icon={<Save size={14} />}
            loading={isSaving}
            onClick={handleSave}
          >
            Save Configuration
          </Button>
        </div>
      </div>
    </div>
  );
};
