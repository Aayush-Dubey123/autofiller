/**
 * HistoryStore persists past session metadata only as a single JSON file.
 *
 * Per strict privacy guidelines, session history records store metadata ONLY:
 * - id
 * - date
 * - hostAndPath (query string and fragment stripped)
 * - status
 * - fieldsFilled / totalFields
 * - profileName
 * - dataSource
 *
 * NEVER stores values, prompt text, or document file contents.
 */

import fs from 'fs';
import path from 'path';

import type {
  AgentEventPayload,
  SessionRecord,
  WorkflowState,
} from '../shared/types';

const STORE_FILE = 'autofiller-history.json';
const MAX_SESSIONS = 200;

/** States in which a session is still running; found on disk they mean the app quit mid-run. */
const ACTIVE_STATES = new Set<string>([
  'EXTRACTING_DOC',
  'SCANNING_FORM',
  'MAPPING_FIELDS',
  'CLARIFICATION_REQUIRED',
  'FILLING_FORM',
  'VERIFYING',
  'PAUSED',
  'USER_TAKEOVER',
]);

/** States that end a run for display purposes. */
const FINISHED_STATES = new Set<string>(['REVIEW_READY', 'COMPLETED', 'ERROR', 'IDLE']);

/** Tools whose successful completion means one more field was populated. */
const FILL_TOOLS = new Set<string>(['fill_text', 'select_option', 'select_radio', 'set_checkbox']);

/** Helper to strip query parameters and hash fragments from a URL. */
export function cleanHostAndPath(urlStr: string): string {
  if (!urlStr) return 'unknown';
  try {
    const parsed = new URL(urlStr.trim());
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return urlStr.split('?')[0].split('#')[0].replace(/^https?:\/\//i, '');
  }
}

interface StoreData {
  sessions: SessionRecord[];
}

export class HistoryStore {
  private readonly filePath: string;
  private data: StoreData = { sessions: [] };
  private activeId: string | null = null;
  private lastFailure = '';

  constructor(baseDir: string) {
    this.filePath = path.join(baseDir, STORE_FILE);
    this.load();
  }

  /** Newest-first copy of the stored session metadata. */
  public listSessions(): SessionRecord[] {
    return [...this.data.sessions].reverse();
  }

  /** Record the start of a session (metadata only). */
  public beginSession(info: {
    targetUrl: string;
    profileName?: string;
    dataSource?: string;
    totalFields?: number;
  }): SessionRecord {
    const record: SessionRecord = {
      id: `run_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      date: new Date().toISOString(),
      hostAndPath: cleanHostAndPath(info.targetUrl),
      status: 'IDLE',
      fieldsFilled: 0,
      totalFields: info.totalFields || 0,
      profileName: info.profileName || 'Default Profile',
      dataSource: info.dataSource || 'profile',
    };
    this.data.sessions.push(record);
    this.data.sessions = this.data.sessions.slice(-MAX_SESSIONS);
    this.activeId = record.id;
    this.lastFailure = '';
    this.save();
    return record;
  }

  /** Apply a workflow state change to the active session. */
  public noteState(state: WorkflowState): void {
    const record = this.active();
    if (!record) return;
    record.status = state;
    if (FINISHED_STATES.has(state)) {
      if (state === 'ERROR') record.error = this.lastFailure || 'Session failed.';
    }
    this.save();
  }

  /** Apply an agent event (filled field count, failure reason metadata only) to the active session. */
  public noteEvent(event: AgentEventPayload): void {
    const record = this.active();
    if (!record) return;
    if (event.type === 'TOOL_COMPLETED' && event.success === true && FILL_TOOLS.has(event.tool ?? '')) {
      record.fieldsFilled += 1;
      this.save();
    } else if (event.type === 'TOOL_FAILED') {
      // Store descriptive reason without field values
      this.lastFailure = String(event.description || 'Step failed').slice(0, 300);
      if (record.status === 'ERROR') {
        record.error = this.lastFailure;
        this.save();
      }
    }
  }

  /** Delete a single session record by ID. */
  public deleteSession(id: string): void {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id);
    this.save();
  }

  /** Delete multiple session records by ID list. */
  public deleteSessions(ids: string[]): void {
    const set = new Set(ids);
    this.data.sessions = this.data.sessions.filter((s) => !set.has(s.id));
    this.save();
  }

  /** Clear all history records. */
  public clearAllSessions(): void {
    this.data.sessions = [];
    this.save();
  }

  private active(): SessionRecord | undefined {
    return this.data.sessions.find((session) => session.id === this.activeId);
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      const sessions: SessionRecord[] = (Array.isArray(raw?.sessions) ? raw.sessions : []).map(
        (entry: any) => ({
          id: String(entry.id || ''),
          date: String(entry.date || entry.startedAt || new Date().toISOString()),
          hostAndPath: String(entry.hostAndPath || cleanHostAndPath(entry.targetUrl || '')),
          status: ACTIVE_STATES.has(String(entry.status))
            ? 'INTERRUPTED'
            : ((String(entry.status) || 'IDLE') as SessionRecord['status']),
          fieldsFilled: Number(entry.fieldsFilled) || 0,
          totalFields: Number(entry.totalFields) || 0,
          profileName: entry.profileName ? String(entry.profileName) : undefined,
          dataSource: entry.dataSource ? String(entry.dataSource) : undefined,
          error: entry.error ? String(entry.error).slice(0, 300) : undefined,
        })
      );
      this.data = { sessions };
    } catch (error) {
      console.error('Could not read history store; starting empty:', error);
      this.data = { sessions: [] };
    }
  }

  private save(): void {
    try {
      const temp = `${this.filePath}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      fs.renameSync(temp, this.filePath);
    } catch (error) {
      console.error('Could not persist history store:', error);
    }
  }
}
