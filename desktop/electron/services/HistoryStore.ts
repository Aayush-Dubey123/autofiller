/**
 * HistoryStore persists past sessions and processed documents as one JSON file.
 *
 * The file lives in Electron's userData directory and is written only by the main
 * process. Every record is rebuilt from a fixed whitelist of fields, so neither the
 * Gemini key nor the backend operator token can ever end up in it.
 */

import fs from 'fs';
import path from 'path';

import type {
  AgentEventPayload,
  DocumentRecord,
  ExtractedFact,
  SessionRecord,
  WorkflowState,
} from '../shared/types';

const STORE_FILE = 'autofiller-store.json';
const MAX_SESSIONS = 200;
const MAX_DOCUMENTS = 100;
const MAX_FACTS = 200;
const MAX_TEXT = 2000;

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

interface StoreData {
  sessions: SessionRecord[];
  documents: DocumentRecord[];
}

const text = (value: unknown, max = MAX_TEXT): string => String(value ?? '').slice(0, max);

/** Rebuild a fact from the whitelist of known fields. */
function sanitizeFacts(facts: unknown): ExtractedFact[] {
  if (!Array.isArray(facts)) return [];
  return facts.slice(0, MAX_FACTS).map((fact) => ({
    key: text(fact?.key, 120),
    label: text(fact?.label, 200),
    value: text(fact?.value),
    confidence: Number.isFinite(Number(fact?.confidence)) ? Number(fact.confidence) : 0,
  }));
}

export class HistoryStore {
  private readonly filePath: string;
  private data: StoreData = { sessions: [], documents: [] };
  private activeId: string | null = null;
  private lastFailure = '';

  /**
   * @param baseDir Directory that holds the store file (Electron's userData path).
   */
  constructor(baseDir: string) {
    this.filePath = path.join(baseDir, STORE_FILE);
    this.load();
  }

  /** Newest-first copy of the stored sessions. */
  public listSessions(): SessionRecord[] {
    return [...this.data.sessions].reverse();
  }

  /** Newest-first copy of the stored documents. */
  public listDocuments(): DocumentRecord[] {
    return [...this.data.documents].reverse();
  }

  /**
   * Record the start of a session and make it the one that agent events update.
   *
   * @param info Document name and target URL of the new session.
   * @returns The new session record.
   */
  public beginSession(info: { documentName: string; targetUrl: string }): SessionRecord {
    const record: SessionRecord = {
      id: `run_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      startedAt: new Date().toISOString(),
      documentName: text(info.documentName, 260) || 'Untitled document',
      targetUrl: text(info.targetUrl, 2048),
      status: 'IDLE',
      fieldsFilled: 0,
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
      record.finishedAt = new Date().toISOString();
      if (state === 'ERROR') record.error = this.lastFailure || 'Session failed.';
    } else {
      delete record.finishedAt;
    }
    this.save();
  }

  /** Apply an agent event (filled-field count, failure reason) to the active session. */
  public noteEvent(event: AgentEventPayload): void {
    const record = this.active();
    if (!record) return;
    if (event.type === 'TOOL_COMPLETED' && event.success === true && FILL_TOOLS.has(event.tool ?? '')) {
      record.fieldsFilled += 1;
      this.save();
    } else if (event.type === 'TOOL_FAILED') {
      this.lastFailure = text(event.description, 500);
      // The ERROR transition can land before its explanatory event; keep the reason current.
      if (record.status === 'ERROR') {
        record.error = this.lastFailure;
        this.save();
      }
    }
  }

  /**
   * Store a processed document, replacing an earlier entry for the same file path.
   *
   * @param input Document metadata and its extracted facts.
   * @returns The stored record.
   */
  public upsertDocument(input: { name: string; size: number; path: string; facts: unknown }): DocumentRecord {
    const record: DocumentRecord = {
      id: `doc_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      name: text(input.name, 260),
      size: Number.isFinite(input.size) ? input.size : 0,
      path: text(input.path, 2048),
      extractedAt: new Date().toISOString(),
      facts: sanitizeFacts(input.facts),
    };
    this.data.documents = this.data.documents.filter((doc) => doc.path !== record.path);
    this.data.documents.push(record);
    this.data.documents = this.data.documents.slice(-MAX_DOCUMENTS);
    this.save();
    return record;
  }

  private active(): SessionRecord | undefined {
    return this.data.sessions.find((session) => session.id === this.activeId);
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      const sessions: SessionRecord[] = (Array.isArray(raw?.sessions) ? raw.sessions : []).map(
        (entry: Partial<SessionRecord>) => ({
          id: text(entry.id, 80),
          startedAt: text(entry.startedAt, 40),
          finishedAt: entry.finishedAt ? text(entry.finishedAt, 40) : undefined,
          documentName: text(entry.documentName, 260),
          targetUrl: text(entry.targetUrl, 2048),
          status: ACTIVE_STATES.has(String(entry.status))
            ? 'INTERRUPTED'
            : ((text(entry.status, 40) || 'IDLE') as SessionRecord['status']),
          fieldsFilled: Number(entry.fieldsFilled) || 0,
          error: entry.error ? text(entry.error, 500) : undefined,
        })
      );
      const documents: DocumentRecord[] = (Array.isArray(raw?.documents) ? raw.documents : []).map(
        (entry: Partial<DocumentRecord>) => ({
          id: text(entry.id, 80),
          name: text(entry.name, 260),
          size: Number(entry.size) || 0,
          path: text(entry.path, 2048),
          extractedAt: text(entry.extractedAt, 40),
          facts: sanitizeFacts(entry.facts),
        })
      );
      this.data = { sessions, documents };
    } catch (error) {
      console.error('Could not read history store; starting empty:', error);
    }
  }

  /** Write atomically so a crash mid-write cannot leave a truncated file. */
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
