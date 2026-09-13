/**
 * Typed HTTP client for the AutoFiller Python backend.
 *
 * Centralizes the base URL, the internal operator token, request timeouts, and error
 * normalization so no other main-process module constructs backend requests directly.
 */

import {
  DocumentExtractResult,
  ExtractedFact,
  FormMapResult,
  FormSnapshot,
  GeminiTestResult,
} from '../shared/types';

/**
 * Normalize a clarification answer into the non-null string the backend requires.
 *
 * Tool results may be objects (for example `{ fieldRef, selectedValue }`). Sending
 * such a value as `selected_value` fails schema validation with a 422, so the value
 * is unwrapped or stringified here rather than rejected at the API boundary.
 *
 * @param value Raw clarification answer from a tool result.
 * @returns A guaranteed non-empty string.
 */
export function coerceClarificationValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['selectedValue', 'selected_value', 'value', 'answer']) {
      const candidate = record[key];
      if (typeof candidate === 'string') {
        return candidate;
      }
      if (candidate !== null && candidate !== undefined && typeof candidate !== 'object') {
        return String(candidate);
      }
    }
    return '';
  }
  return String(value);
}

/** Prefix for the per-install token shared with the Python backend. */
const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';
// Mapping may invoke a provider fallback after a Gemini quota response. Keep the
// local request alive long enough for the backend to finish that bounded work.
const DEFAULT_TIMEOUT_MS = 120000;

/** Error carrying the HTTP status and a UI-safe message. */
export class BackendError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(message: string, status: number = 0, code: string = 'BACKEND_ERROR') {
    super(message);
    this.name = 'BackendError';
    this.status = status;
    this.code = code;
  }
}

export class BackendClient {
  private baseUrl: string;
  private token: string;
  private timeoutMs: number;

  /**
   * Create a backend client bound to a base URL and operator token.
   *
   * @param token Internal operator token issued to this installation.
   * @param baseUrl Backend base URL.
   * @param timeoutMs Per-request timeout in milliseconds.
   */
  constructor(token: string, baseUrl: string = DEFAULT_BASE_URL, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Replace the active authentication token.
   *
   * @param token New internal operator token.
   */
  public setToken(token: string): void {
    this.token = token;
  }

  /**
   * Replace the backend base URL.
   *
   * @param baseUrl New backend base URL.
   */
  public setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Report the active backend base URL.
   *
   * @returns Base URL currently in use.
   */
  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Execute an authenticated JSON request with a hard timeout.
   *
   * @param path Request path beginning with a slash.
   * @param init Fetch options for the request.
   * @returns Parsed JSON response body.
   * @throws BackendError when the request fails, times out, or returns a non-OK status.
   */
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
          ...(init.headers || {}),
        },
      });

      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};

      if (!response.ok) {
        const detail =
          typeof payload?.detail === 'string'
            ? payload.detail
            : `Backend request failed with status ${response.status}`;
        throw new BackendError(detail, response.status, 'BACKEND_HTTP_ERROR');
      }

      return payload as T;
    } catch (error: any) {
      if (error instanceof BackendError) {
        throw error;
      }
      if (error?.name === 'AbortError') {
        throw new BackendError('Backend request timed out', 0, 'BACKEND_TIMEOUT');
      }
      throw new BackendError(
        'Backend is unreachable. Ensure the local service is running.',
        0,
        'BACKEND_UNREACHABLE'
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Check backend health without authentication.
   *
   * @returns True when the backend reports a healthy status.
   */
  public async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      if (!response.ok) return false;
      const payload = (await response.json()) as { status?: string };
      return payload.status === 'HEALTHY';
    } catch {
      return false;
    }
  }

  /**
   * Create a new workflow session.
   *
   * @param documentName Source document name.
   * @param targetUrl Target form URL.
   * @returns Created session identifier.
   */
  public async createSession(documentName: string, targetUrl: string): Promise<{ id: string }> {
    return this.request<{ id: string }>('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify({ document_name: documentName, target_url: targetUrl }),
    });
  }

  /**
   * Extract structured facts from a document.
   *
   * @param payload File path or raw text plus the document name.
   * @returns Extracted document facts.
   */
  public async extractDocument(payload: {
    filePath?: string;
    rawText?: string;
    documentName?: string;
  }): Promise<DocumentExtractResult> {
    return this.request<DocumentExtractResult>('/v1/documents/extract', {
      method: 'POST',
      body: JSON.stringify({
        file_path: payload.filePath,
        raw_text: payload.rawText,
        document_name: payload.documentName,
      }),
    });
  }

  /**
   * Synthesize semantic mappings between form fields and document facts.
   *
   * @param sessionId Active session identifier.
   * @param formSnapshot Structured form observation.
   * @param facts Extracted document facts.
   * @returns Mappings, clarifications, and unmapped fields.
   */
  public async mapForm(
    sessionId: string,
    formSnapshot: FormSnapshot,
    facts: ExtractedFact[]
  ): Promise<FormMapResult> {
    return this.request<FormMapResult>('/v1/forms/map', {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        form_snapshot: formSnapshot,
        facts,
      }),
    });
  }

  /**
   * Persist a single audit event without ever throwing.
   *
   * Event persistence is diagnostics, not workflow control. The backend returns the
   * full session on some event paths, so this reads the body defensively and reports
   * the outcome instead of rejecting an otherwise healthy session.
   *
   * @param sessionId Active session identifier.
   * @param event Structured event payload.
   * @returns True when the backend accepted the event.
   */
  public async appendEventSafe(
    sessionId: string,
    event: Record<string, unknown>
  ): Promise<boolean> {
    try {
      const result = await this.appendEvents(sessionId, [event]);
      return result?.success !== false;
    } catch (error) {
      console.error('Could not persist agent event:', error);
      return false;
    }
  }

  /**
   * Submit a human answer to a clarification prompt.
   *
   * @param sessionId Active session identifier.
   * @param clarificationId Target clarification identifier.
   * @param selectedValue Operator supplied value.
   */
  public async answerClarification(
    sessionId: string,
    clarificationId: string,
    selectedValue: string
  ): Promise<void> {
    await this.request('/v1/clarifications/answer', {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        clarification_id: clarificationId,
        // The backend contract requires a non-null string. Coerce here so a
        // non-string tool result can never be serialized into this field and
        // trigger a 422 that aborts the whole session.
        selected_value: coerceClarificationValue(selectedValue),
      }),
    });
  }

  /**
   * Persist agent execution events to the session audit timeline.
   *
   * @param sessionId Active session identifier.
   * @param events Structured agent events.
   * @returns Count of appended and total events.
   */
  public async appendEvents(
    sessionId: string,
    events: Array<Record<string, unknown>>,
    verifications: Array<Record<string, unknown>> = []
  ): Promise<{ success: boolean; appended: number; event_count: number }> {
    const safeEvents = (events || []).map((evt) => {
      const metadata = evt.metadata;
      return {
        eventId: String(evt.eventId || evt.event_id || `evt_${Date.now()}`),
        timestamp: String(evt.timestamp || new Date().toISOString()),
        type: String(evt.type || 'STATE_CHANGED'),
        tool: evt.tool ? String(evt.tool) : undefined,
        description: String(evt.description || ''),
        success: typeof evt.success === 'boolean' ? evt.success : undefined,
        metadata: typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata) ? metadata : {},
      };
    });

    const safeVerifications = (verifications || []).map((v) => ({
      field_ref: String(v.field_ref || v.fieldRef || ''),
      field_label: String(v.field_label || v.fieldLabel || ''),
      expected_value: String(v.expected_value || v.expectedValue || ''),
      actual_value: String(v.actual_value || v.actualValue || ''),
      verified: Boolean(v.verified),
    }));

    return this.request<{ success: boolean; appended: number; event_count: number }>(
      `/v1/sessions/${sessionId}/events`,
      { method: 'POST', body: JSON.stringify({ events: safeEvents, verifications: safeVerifications }) }
    );
  }

  /**
   * Read the current runtime configuration.
   *
   * @returns Masked configuration summary.
   */
  public async getSettings(): Promise<{ api_key_configured: boolean; masked_key: string; model: string }> {
    return this.request<{ api_key_configured: boolean; masked_key: string; model: string }>(
      '/v1/settings'
    );
  }

  /**
   * Persist updated runtime configuration.
   *
   * @param apiKey Optional replacement Gemini API key.
   * @param model Optional replacement model identifier.
   * @returns Updated configuration summary.
   */
  public async updateSettings(
    apiKey?: string,
    model?: string
  ): Promise<{ success: boolean; model: string; api_key_configured: boolean; masked_key: string }> {
    return this.request('/v1/settings/update', {
      method: 'POST',
      body: JSON.stringify({ gemini_api_key: apiKey, gemini_model: model }),
    });
  }

  /**
   * Validate a candidate Gemini API key without persisting it.
   *
   * @param apiKey Candidate API key.
   * @param model Candidate model identifier.
   * @returns Validation outcome.
   */
  public async testGemini(apiKey: string, model?: string): Promise<GeminiTestResult> {
    return this.request<GeminiTestResult>('/v1/settings/test-gemini', {
      method: 'POST',
      body: JSON.stringify({ api_key: apiKey, model }),
    });
  }
}
