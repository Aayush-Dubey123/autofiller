# AutoFiller AI — Development Progress Report

> **Generated:** 2026-10-01 · **Author:** Aayush Dubey  
> **Repository:** [github.com/Aayush-Dubey123/autofiller](https://github.com/Aayush-Dubey123/autofiller)

---

## 1. Project Overview

**AutoFiller AI** is an intelligent Electron desktop application that automates web-based school admission and registration form filling using data extracted directly from uploaded documents (PDFs, images, Word docs, etc.). The application targets school staff who repeatedly copy student data between physical/digital records and school management portals.

### Core Value Proposition
- Upload a student document → specify a target form URL → the AI agent reads, maps, fills, verifies, and **halts at the final review step** — never submitting autonomously.

---

## 2. Technology Stack

| Layer | Technology |
|---|---|
| **Desktop Shell** | Electron 34.0.2 |
| **Frontend UI** | React 18.3.1, TypeScript 5.7.3 |
| **Bundler** | Vite 6.1.0 |
| **Browser Automation** | Playwright 1.50.1 (Chromium, visible mode) |
| **UI Icons** | Lucide React 0.474.0 |
| **AI Backend** | Python 3.13, FastAPI 0.115.8, Uvicorn 0.34.0 |
| **AI Model** | Google Gemini (google-genai SDK 1.2.0) — default gemini-3.5-flash |
| **Data Validation** | Pydantic v2 (2.10.6) |
| **PDF Parsing** | PyMuPDF 1.25.3 |
| **Database** | MongoDB via Motor 3.7.0 (async) — graceful in-memory fallback |
| **Styling** | Vanilla CSS (index.css) |
| **Packaging** | electron-builder 25.1.8 |

---

## 3. Git Commit History

| # | Hash | Date | Commit Message |
|---|---|---|---|
| 1 | `e6aa427` | 2026-09-13 | `feat: initialize AutoFiller AI desktop application with Electron, Python backend, and agent framework` |
| 2 | `debe3be` | 2026-09-15 | `feat: implement main App component and add agent operational guidelines` |

**Total lines of code added across 63 files: ~21,769 insertions**

---

## 4. Development Done — Feature Breakdown

### 4.1 Backend (Python · FastAPI)

#### 4.1.1 Application Entrypoint and Configuration
- **`backend/main.py`** — Uvicorn ASGI entrypoint; reads `HOST`, `PORT`, and `ENV` from environment; enables hot-reload in development mode.
- **`backend/core/apis/api.py`** — Central FastAPI app factory:
  - Explicit CORS allowlist (`localhost:5173`, `app://autofiller`, `app://formpilot`). No wildcard origins.
  - Async `lifespan` hook: validates security on startup, initializes and shuts down the database connection pool.
  - Global unhandled exception handler returning `500` without leaking internals.
  - Two routers registered: `session_router` (automation) and `settings_router` (credentials).
  - `GET /health` — public endpoint polled by the Electron shell during startup.
  - `GET /mock_school_form.html` — serves a bundled demo admission form over HTTP.

#### 4.1.2 Authentication and Security (`backend/commons/auth.py`)
- **Dual-token authentication bridge**: Every protected endpoint requires a `Bearer` token compared using `hmac.compare_digest` (constant-time, timing-attack safe).
- Per-install token lifecycle: if no `AUTOFILLER_INTERNAL_KEY` env var is set, a cryptographically random 64-hex token is generated on first run, written to `.autofiller_token` with `chmod 600`, and re-read on subsequent runs.
- `validate_startup_security()` — refuses to boot if `AUTOFILLER_ALLOW_ANONYMOUS=true` is set, preventing authentication regressions.
- `require_operator` — FastAPI `Depends` guard applied to every protected route; cannot be accidentally forgotten.

#### 4.1.3 Data Models (`backend/core/models/session_model.py`)
Rich Pydantic v2 domain model hierarchy:

| Model | Purpose |
|---|---|
| `FormFieldType` (enum) | 10 supported control types: text, number, email, tel, select, radio, checkbox, date, textarea, password, other |
| `SessionStatus` (enum) | Full lifecycle: IDLE to EXTRACTING_DOC to SCANNING_FORM to MAPPING_FIELDS to CLARIFICATION_REQUIRED to FILLING_FORM to VERIFYING to REVIEW_READY to PAUSED/USER_TAKEOVER/COMPLETED/ERROR |
| `ExtractedFact` | Key, label, value, confidence score, source page number |
| `FormFieldSnapshot` | DOM form field: ref, ARIA role, label, type, required, current value, options list, disabled/visible flags |
| `FormSnapshot` | Page-level form observation: URL, title, list of FormFieldSnapshots |
| `FieldMapping` | Semantic link between a form field and an extracted fact with confidence score and status |
| `ClarificationRequest` | Human-in-the-loop prompt with question text and candidate options |
| `VerificationRecord` | Audit record comparing expected vs actual DOM value after form filling |
| `AgentEvent` | Timestamped observable event in the execution timeline |
| `SessionModel` | Full session state aggregating all above models |

#### 4.1.4 API Routes

**Session Router (`/v1/...`)**:

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/sessions` | POST | Create a new automation session |
| `/v1/sessions/{id}` | GET | Retrieve session state |
| `/v1/documents/extract` | POST | Extract structured facts from a document file path |
| `/v1/sessions/{id}/map-form` | POST | Semantically map form snapshot fields to extracted facts |
| `/v1/sessions/{id}/clarifications/{cid}` | POST | Submit a human clarification answer |
| `/v1/sessions/{id}/events` | POST | Append audit events to a session timeline |

**Settings Router (`/v1/settings/...`)**:

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/settings` | GET | Retrieve current settings (masked API key, model, flags) |
| `/v1/settings/update` | POST | Save Gemini API key and model preferences |
| `/v1/settings/test-gemini` | POST | Live Gemini API round-trip test with latency measurement |

#### 4.1.5 Services

**Document Service (`backend/core/services/document_service.py` — 523 lines)**
- PDF text extraction via **PyMuPDF** with per-page processing.
- **Direct image vision** support (PNG, JPG, JPEG, WEBP, BMP) via Gemini multimodal API.
- Comprehensive `KEY_ALIASES` dictionary normalizing 30+ educational field name variants (e.g. `candidate_name` to `student_name`, `birth_date` to `dob`).
- **Path containment security**: documents must reside in allowed roots; absolute paths outside project scope return HTTP 403.
- Hard limits: 25 MB max file size, 400,000 character text cap.

**Gemini Service (`backend/core/services/gemini_service.py` — 955 lines)**
- Async Google GenAI SDK integration with configurable default model (`gemini-3.5-flash`) and automatic fallback sequence (`gemini-3.5-flash-lite`, `gemini-3.6-flash`) on rate-limit (429) or model unavailability.
- 45-second timeout budget; 2 maximum retry attempts per call.
- `format_to_strict_dd_mm_yyyy()` — robust date normalizer handling YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, and month-name formats.
- `_strip_code_fences()` — cleans Markdown code fences from model JSON responses.
- Semantic field mapping: given a `FormSnapshot` and a list of `ExtractedFact`s, produces a `FieldMapping` list with confidence scores and flags unmappable fields for clarification.

**Secrets Service (`backend/core/services/secrets_service.py` — 248 lines)**
- Encrypted Gemini API key storage: key is encrypted at rest, never written in plaintext to disk, masked in API responses.
- Model preference persistence (default: `gemini-3.5-flash`).
- `GET /v1/settings` response returns only a masked preview (e.g. `****...xyz`).

#### 4.1.6 Database Layer (`backend/core/database/database.py`)
- Async **Motor** (MongoDB) client with a 5-second server selection timeout.
- `init_database()` — pings MongoDB on startup; **gracefully falls back to in-memory session storage** if MongoDB is unavailable (zero-downtime for development).
- Auto-creates indexes: `idx_session_id` (unique) and `idx_session_updated_at`.
- `close_database()` — clean shutdown in the FastAPI lifespan.

**Session CRUD (`backend/core/cruds/session_crud.py` — 253 lines)**
- Transparent MongoDB / in-memory dual-mode persistence.
- Full CRUD: create, read, update (partial), delete sessions.
- Thread-safe in-memory store using a Python `dict` with session ID keys.

#### 4.1.7 Testing (`backend/tests/test_backend.py` — 795 lines)
- **pytest + pytest-asyncio** test suite.
- Covers: session creation, document extraction, Gemini field mapping, clarification flow, verification records, event appending, settings CRUD, and authentication (token missing / wrong / correct).
- Wire-contract script (`backend/scripts/check_wire_contract.py`): validates request/response schema shapes match the frontend TypeScript contract.

---

### 4.2 Electron Desktop Shell (TypeScript)

#### 4.2.1 Main Process (`desktop/electron/main.ts` — 259 lines)
- Creates the main `BrowserWindow` (1440x900, dark `#090d16` background, `titleBarStyle: 'hiddenInset'`).
- **Strict security hardening**:
  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
  - Strict Content Security Policy applied via `onHeadersReceived` hook: blocks remote scripts, inline scripts, external frames, `form-action`, `base-uri`.
  - All outbound renderer navigation and new window creation blocked.
- **Backend supervision**: spawns the Python backend process directly (no shell) with `windowsHide: true`; supports packaged `.exe` in production or `venv/Scripts/python.exe` in development.
- **Health polling**: waits up to 20 seconds for the backend `/health` endpoint before declaring the session ready.
- **Token resolution chain**: env var → OS-encrypted `SecretStore` → on-disk `.autofiller_token` file.
- Clean shutdown: `AgentController.cleanup()` + backend process termination on all close/quit events.

#### 4.2.2 Agent Layer

**`AgentController.ts` (854 lines)** — Central orchestrator for the end-to-end FormPilot workflow:
- **Bounded step loop** (max 50 steps) with cooperative cancellation via `AbortController`.
- Truthful event reporting: a failed tool is always reported as `TOOL_FAILED` — never silently swallowed.
- Human-in-the-loop controls: `pause()`, `resume()`, `takeOver()`, `stop()`.
- **REVIEW_READY terminal state enforced**: the agent will never advance past `REVIEW_READY` autonomously.
- Clarification promise map: pending human answers are keyed by `clarificationId`; a 10-minute timeout per clarification prevents orphaned waiters.
- Serialized persistence queue: audit event writes never race each other.
- Settings management: `headless` mode and `typingDelayMs` configurable at runtime.

**`StateMachine.ts` (57 lines)** — Simple state transition guard for the workflow lifecycle enum.

**`ToolRegistry.ts` (351 lines)** — Declares and executes all agent tools:

| Tool | Permission | Action |
|---|---|---|
| `inspect_document` | READ_ONLY | Parse document facts via backend |
| `extract_document_facts` | READ_ONLY | Call backend document extraction |
| `inspect_form` | READ_ONLY | Scan current page for form fields |
| `inspect_current_form_state` | READ_ONLY | Re-scan form to check current values |
| `verify_field` | READ_ONLY | Read a field's DOM value for verification |
| `scroll_to_field` | READ_ONLY | Scroll to a form field for visibility |
| `fill_text` | MUTATING | Type into a text/email/number/date input |
| `select_option` | MUTATING | Choose a select dropdown option |
| `select_radio` | MUTATING | Check a radio button group option |
| `set_checkbox` | MUTATING | Toggle a checkbox to the target state |
| `request_clarification` | READ_ONLY | Prompt the human operator for a missing value |

#### 4.2.3 Browser Layer

**`BrowserManager.ts` (765 lines)** — Playwright Chromium lifecycle and controlled DOM interaction:
- Visible browser (non-headless by default) so the operator can supervise.
- `withCancellation()` — races every browser operation against an `AbortSignal`; a Stop press interrupts even a slow navigation mid-keystroke via `OperationCancelledError`.
- `cancellableDelay()` — typing delay is also cancellable.
- **Group-scoped radio selection**: finds all `<input type="radio">` in the same `name` group, highlights the target, and clicks it.
- **Normalized date input**: parses various date string formats before typing into `<input type="date">` fields.
- Scrolls to each field and highlights it briefly before interaction (operator supervision UX).
- Integrates with `FormScanner` (scan) and `PolicyEngine` (guard every action).

**`FormScanner.ts` (319 lines)** — Playwright-based DOM scanner:
- Extracts all form fields from the live page: inputs, selects, radios, checkboxes, textareas.
- Assigns stable `field_NNN` reference IDs.
- Reads ARIA labels, `<label for>` associations, placeholder text, and current values.
- Enumerates `<select>` option lists and radio group options.
- Identifies submission-capable controls (`type="submit"`, button text matching) for the PolicyEngine.

#### 4.2.4 Policy Engine (`desktop/electron/policy/PolicyEngine.ts` — 242 lines)
The single gate every tool invocation and browser action must pass through:
- **Tool permission tiers**: `READ_ONLY`, `MUTATING`, `FORBIDDEN`. Unknown tools are refused outright with `TOOL_NOT_PERMITTED`.
- **Mutating tool validation**: requires a valid `field_NNN` reference format — prevents arbitrary DOM targeting.
- **Final submission guard** (`DENIED_FINAL_SUBMISSION`): blocks any `click` on controls matching submit/register/apply/finish patterns, or `type="submit"` structural controls. This is non-bypassable — the LLM is never the security boundary.
- **Pagination allowlist**: `next`, `continue`, `save & continue`, `proceed`, `step N` buttons are permitted for multi-page form navigation.
- **Navigation guard**: cross-origin navigation (different host) is denied with `EXTERNAL_NAVIGATION_DENIED`.
- `evaluateSubmissionControls()` — inspects the full set of discovered page buttons and flags any blocked ones in the audit trail.

#### 4.2.5 IPC Bridge (`desktop/electron/ipc/ipcHandlers.ts` — 194 lines)
Narrow typed channels between the renderer and privileged main-process capabilities:

| Channel | Direction | Purpose |
|---|---|---|
| `formpilot:select-document` | Renderer → Main | Native OS file open dialog |
| `formpilot:start-session` | Renderer → Main | Start automation (refuses concurrent runs) |
| `formpilot:pause` | Renderer → Main | Pause the running agent loop |
| `formpilot:resume` | Renderer → Main | Resume a paused agent |
| `formpilot:stop` | Renderer → Main | Abort and reset |
| `formpilot:takeover` | Renderer → Main | Transfer browser control to the operator |
| `formpilot:answer-clarification` | Renderer → Main | Submit a human answer to a clarification prompt |
| `formpilot:get-settings` | Renderer → Main | Load current settings (masked API key) |
| `formpilot:save-settings` | Renderer → Main | Persist API key and preferences |
| `formpilot:test-gemini` | Renderer → Main | Live Gemini API connectivity test |
| `formpilot:event` | Main → Renderer | Push agent execution events to the UI timeline |
| `formpilot:clarification-prompt` | Main → Renderer | Push a clarification question to the UI |

#### 4.2.6 Services

**`BackendClient.ts` (368 lines)** — Typed HTTP client for all backend API calls:
- Automatically injects the operator `Bearer` token on every request.
- Implements all session, document, settings, and health endpoints.

**`SecretStore.ts` (135 lines)** — OS-level encrypted secret storage:
- Stores the operator token and user preferences using Electron's `safeStorage` API (OS keychain).
- Falls back to plaintext when encryption is unavailable (logs a warning).

**`preload.ts` (94 lines)** — Exposes the `window.formpilot` API surface via `contextBridge`:
- All renderer access to IPC is funneled through this typed surface — no `ipcRenderer` is directly accessible.
- No Node.js capability is leaked to the renderer.

---

### 4.3 Frontend React UI (`desktop/src/`)

#### 4.3.1 Main App Component (`App.tsx` — ~1,249 lines)
The monolithic application shell managing all UI state:
- React hooks for session state, workflow phase, extracted facts, field mappings, agent events, clarification modals, and settings modal visibility.
- Listens to `formpilot:event` and `formpilot:clarification-prompt` IPC channels from the main process.
- Renders all feature panels based on current `WorkflowState`.

#### 4.3.2 Feature Components

| Component | File | Purpose |
|---|---|---|
| `SessionLauncher` | `features/form-session/SessionLauncher.tsx` (162 lines) | Document upload + URL input; triggers session start |
| `DocumentViewer` | `features/document-viewer/DocumentViewer.tsx` (290 lines) | Displays extracted facts from the uploaded document |
| `FieldMappingTable` | `features/field-mapping/FieldMappingTable.tsx` (141 lines) | Shows form field → extracted fact mapping with confidence scores |
| `AgentTimeline` | `features/agent-timeline/AgentTimeline.tsx` (143 lines) | Live scrolling feed of agent execution events |
| `ControlBar` | `features/controls/ControlBar.tsx` (193 lines) | Pause / Resume / Stop / Takeover action buttons |
| `ClarificationModal` | `features/clarification/ClarificationModal.tsx` (177 lines) | Human-in-the-loop question dialog with candidate value options |
| `SettingsModal` | `features/settings/SettingsModal.tsx` (367 lines) | Gemini API key, model selector, headless toggle, typing delay, live API test |

#### 4.3.3 Shared UI Components

| Component | Purpose |
|---|---|
| `Button.tsx` | Reusable button with variants (primary, secondary, danger, ghost) and loading spinner |
| `Card.tsx` | Styled panel container |

#### 4.3.4 Library and Types
- **`lib/bridge.ts`** — Typed wrapper over `window.formpilot` IPC surface with Promise types.
- **`types/formpilot.ts`** — Complete renderer-side TypeScript contract: all domain types.
- **`styles/index.css`** — Global dark theme CSS custom properties and utilities.

---

### 4.4 Testing Suite

#### Backend Tests (`backend/tests/test_backend.py` — 795 lines)
- **pytest + pytest-asyncio** async test suite.
- Covers: session lifecycle, document extraction (PDF, text, image), Gemini field mapping, clarification resolution, verification records, event append, settings CRUD, and comprehensive auth attack scenarios.

#### Desktop Tests (`desktop/tests/`)

| Test File | Lines | Scope |
|---|---|---|
| `policy_test.js` | 161 | PolicyEngine: tool permission, submission guard, pagination allowlist, navigation guard |
| `tool_registry_test.js` | 154 | ToolRegistry: all 11 tools, argument validation, execution results |
| `scanner_test.js` | 60 | FormScanner: field ID generation, label extraction, option enumeration |
| `e2e_integration_test.js` | 392 | Full end-to-end workflow against the live backend + mock school form |
| `live_automated_demo.js` | 237 | Live Playwright demo against the mock admission form |

#### Security Verification (`verify_security_live.py` — 181 lines)
- Spawns a real backend instance on port 8123 and probes all security boundaries:
  - Unauthenticated requests → 401.
  - Wrong token → 401.
  - Valid token succeeds.
  - Settings response never leaks the raw API key.
  - Path traversal attempts (`../../backend/.env`) → 403.
  - Absolute paths outside allowed roots → 403.
  - `/health` remains public.

---

### 4.5 Operational Scripts and Launchers

| File | Purpose |
|---|---|
| `start.ps1` | PowerShell all-in-one launcher: activates venv, starts backend, opens Electron |
| `start.bat` | Command Prompt equivalent launcher |
| `backend/scripts/check_wire_contract.py` | Validates Python request/response schemas match TypeScript frontend contract |
| `AGENTS.md` | AI agent operational rules for the codebase (senior engineer guidelines) |
| `.agents/rules/senior_software_engineer.md` | Workspace-scoped agent rules |

---

## 5. Security Architecture Summary

```
+---------------------------------------------------------------------+
|                         Security Layers                             |
+---------------------------------------------------------------------+
|  1. Electron Renderer Sandbox                                       |
|     - contextIsolation=true, nodeIntegration=false, sandbox=true    |
|     - Strict CSP: no remote scripts, no inline scripts              |
|     - window.formpilot preload bridge: only typed IPC exposed       |
+---------------------------------------------------------------------+
|  2. IPC Layer                                                        |
|     - Narrow named channels, no raw ipcRenderer to renderer         |
|     - Token/backend URL never sent to renderer                      |
+---------------------------------------------------------------------+
|  3. Policy Engine (TypeScript, main process)                        |
|     - Explicit tool allowlist (permission tier per tool)            |
|     - DENIED_FINAL_SUBMISSION: form submit ALWAYS blocked           |
|     - field_NNN ref format required for mutating tools              |
|     - Cross-origin navigation denied                                |
+---------------------------------------------------------------------+
|  4. FastAPI Backend Auth                                            |
|     - hmac.compare_digest bearer token (timing-attack safe)         |
|     - Per-install random token, chmod 600                           |
|     - validate_startup_security() on every boot                     |
|     - require_operator Depends on every protected route             |
+---------------------------------------------------------------------+
|  5. Document Access Control                                         |
|     - Path containment: only allowed roots readable                 |
|     - 25 MB size cap, 400 KB text cap                               |
|     - Traversal attempts -> HTTP 403                                |
+---------------------------------------------------------------------+
|  6. Secret Management                                               |
|     - API key encrypted at rest (OS safeStorage)                   |
|     - Key masked in all API responses, never logged                 |
+---------------------------------------------------------------------+
```

---

## 6. File Structure Diagram

```
autofiller/
|
+-- AGENTS.md                          # AI agent operational rules (senior engineer guidelines)
+-- README.md                          # Project overview, setup, and quick-start guide
+-- start.ps1                          # PowerShell all-in-one launcher (backend + Electron)
+-- start.bat                          # CMD equivalent launcher
+-- verify_security_live.py            # Live end-to-end security boundary verification script
+-- backend.log                        # Runtime backend log output
+-- backend_err.log                    # Runtime backend error log
+-- .gitignore                         # Root-level Git ignore rules
|
+-- .agents/                           # Workspace-scoped AI agent customizations
|   +-- rules/
|       +-- senior_software_engineer.md
|
+-- .codex/                            # Codex configuration (AI tooling)
|
+-- venv/                              # Python virtual environment (not committed)
|
+-- backend/                           # Python FastAPI AI backend
|   +-- main.py                        # Uvicorn ASGI entrypoint
|   +-- requirements.txt               # Pinned Python dependencies
|   +-- pytest.ini                     # pytest configuration
|   +-- .env                           # Local environment variables (not committed)
|   +-- .formpilot_token               # Per-install internal auth token (auto-generated)
|   +-- .gitignore                     # Backend-specific Git ignore rules
|   |
|   +-- commons/                       # Shared backend utilities
|   |   +-- auth.py                    # Dual-token auth: verify_internal_token, require_operator
|   |   +-- logger.py                  # Structured logging factory
|   |
|   +-- core/                          # Domain application layer
|   |   |
|   |   +-- apis/                      # HTTP API surface
|   |   |   +-- api.py                 # FastAPI app factory: CORS, lifespan, routers
|   |   |   +-- routes/
|   |   |   |   +-- session_router.py  # /v1/sessions, /v1/documents/extract, mapping, clarifications
|   |   |   |   +-- settings_router.py # /v1/settings, update, test-gemini
|   |   |   +-- schemas/
|   |   |       +-- requests/
|   |   |       |   +-- session_request.py  # Pydantic request bodies
|   |   |       +-- responses/
|   |   |           +-- session_response.py # Pydantic response models
|   |   |
|   |   +-- controllers/               # Business logic layer
|   |   |   +-- session_controller.py  # Session lifecycle, document extraction, field mapping
|   |   |   +-- settings_controller.py # Gemini API key storage, model config, test endpoint
|   |   |
|   |   +-- cruds/                     # Data access layer
|   |   |   +-- session_crud.py        # MongoDB / in-memory dual-mode session CRUD
|   |   |
|   |   +-- database/                  # Database lifecycle
|   |   |   +-- database.py            # Motor async MongoDB init, index creation, graceful fallback
|   |   |
|   |   +-- models/                    # Domain entity definitions
|   |   |   +-- session_model.py       # SessionModel, ExtractedFact, FormSnapshot, FieldMapping, AgentEvent, etc.
|   |   |
|   |   +-- services/                  # External integration services
|   |       +-- document_service.py    # PDF/image parsing (PyMuPDF), path containment, key normalization
|   |       +-- gemini_service.py      # Google Gemini AI: field mapping, fact extraction, date formatting
|   |       +-- secrets_service.py     # Encrypted API key storage, masked responses
|   |
|   +-- scripts/
|   |   +-- check_wire_contract.py     # Validates Python schemas <-> TypeScript frontend contract
|   |
|   +-- tests/
|       +-- test_backend.py            # pytest suite (795 lines): auth, session, extraction, mapping, settings
|
+-- desktop/                           # Electron + React desktop application
    +-- index.html                     # Root HTML shell
    +-- package.json                   # npm manifest: scripts, dependencies, electron-builder config
    +-- package-lock.json              # Locked dependency tree
    +-- vite.config.ts                 # Vite bundler configuration
    +-- tsconfig.json                  # TypeScript config for the React renderer
    +-- tsconfig.electron.json         # TypeScript config for the Electron main process
    +-- .gitignore                     # Desktop-specific Git ignore rules
    |
    +-- public/                        # Static assets served by Vite
    |   +-- mock_school_form.html      # Demo school admission form (1,038 lines HTML)
    |   +-- student_admission.pdf      # Sample student document for testing
    |
    +-- electron/                      # Electron main-process source (TypeScript)
    |   +-- main.ts                    # App lifecycle, window creation, CSP, backend supervision
    |   +-- preload.ts                 # contextBridge: exposes window.formpilot to renderer
    |   |
    |   +-- agent/                     # AI agent orchestration layer
    |   |   +-- AgentController.ts     # Bounded agent loop, pause/resume/stop, REVIEW_READY guard
    |   |   +-- StateMachine.ts        # Workflow state transition guard
    |   |   +-- ToolRegistry.ts        # 11 registered tools with argument schemas and executors
    |   |
    |   +-- browser/                   # Playwright browser automation
    |   |   +-- BrowserManager.ts      # Chromium lifecycle, cancellable form interactions, radio/date helpers
    |   |   +-- FormScanner.ts         # DOM form field scanner: label extraction, option enumeration
    |   |
    |   +-- ipc/
    |   |   +-- ipcHandlers.ts         # 12 IPC channels: session control, file dialog, settings, events
    |   |
    |   +-- policy/
    |   |   +-- PolicyEngine.ts        # Tool permission tiers, submission guard, navigation guard
    |   |
    |   +-- services/
    |   |   +-- BackendClient.ts       # Typed HTTP client for all backend REST calls
    |   |   +-- SecretStore.ts         # OS safeStorage encrypted token + preference persistence
    |   |
    |   +-- shared/
    |       +-- types.ts               # Shared TypeScript types (main <-> renderer contract)
    |
    +-- src/                           # React renderer source (TypeScript + CSS)
    |   +-- main.tsx                   # React DOM entry point
    |   +-- App.tsx                    # Root application shell (~1,249 lines), all state management
    |   |
    |   +-- components/
    |   |   +-- ui/
    |   |       +-- Button.tsx         # Reusable button: variants, loading state
    |   |       +-- Card.tsx           # Styled panel container
    |   |
    |   +-- features/                  # Feature-sliced React components
    |   |   +-- agent-timeline/
    |   |   |   +-- AgentTimeline.tsx  # Live scrolling agent event feed
    |   |   +-- clarification/
    |   |   |   +-- ClarificationModal.tsx  # Human-in-the-loop question dialog
    |   |   +-- controls/
    |   |   |   +-- ControlBar.tsx     # Pause / Resume / Stop / Takeover controls
    |   |   +-- document-viewer/
    |   |   |   +-- DocumentViewer.tsx # Extracted facts display panel
    |   |   +-- field-mapping/
    |   |   |   +-- FieldMappingTable.tsx  # Field to fact mapping table with confidence scores
    |   |   +-- form-session/
    |   |   |   +-- SessionLauncher.tsx    # Document upload + URL input launcher
    |   |   +-- settings/
    |   |       +-- SettingsModal.tsx  # Gemini API key, model, headless, typing delay settings
    |   |
    |   +-- lib/
    |   |   +-- bridge.ts              # Typed Promise wrapper over window.formpilot IPC surface
    |   |
    |   +-- styles/
    |   |   +-- index.css              # Global dark theme CSS custom properties and utilities
    |   |
    |   +-- types/
    |       +-- formpilot.ts           # Renderer-side TypeScript domain types
    |
    +-- tests/                         # Desktop test suite
    |   +-- policy_test.js             # PolicyEngine unit tests (161 lines)
    |   +-- tool_registry_test.js      # ToolRegistry unit tests (154 lines)
    |   +-- scanner_test.js            # FormScanner unit tests (60 lines)
    |   +-- e2e_integration_test.js    # Full end-to-end workflow tests (392 lines)
    |   +-- live_automated_demo.js     # Live Playwright demo against mock form (237 lines)
    |
    +-- dist/                          # Compiled React renderer bundle (generated)
    +-- dist-electron/                 # Compiled Electron main process (generated)
```

---

## 7. Workflow State Machine

```
IDLE
 |  (user uploads document + enters URL, start session)
 v
EXTRACTING_DOC
 |  (Gemini/PyMuPDF extracts structured facts from document)
 v
SCANNING_FORM
 |  (FormScanner reads all DOM fields from the target URL)
 v
MAPPING_FIELDS
 |  (Gemini maps extracted facts to form fields with confidence scores)
 v
CLARIFICATION_REQUIRED <--- (when a field has low confidence / missing data)
 |  (user answers ClarificationModal)                   |
 +-------------------------------------------------------+
 v
FILLING_FORM
 |  (BrowserManager + ToolRegistry fill each field, policy-gated)
 v
VERIFYING
 |  (agent re-reads DOM values to verify against expected values)
 v
REVIEW_READY  <-- TERMINAL: user inspects and submits manually
 |
 +-- PAUSED        (user pressed Pause mid-fill)
 +-- USER_TAKEOVER (user clicked Takeover, browser handed over)
 +-- COMPLETED     (session successfully concluded after user review)
 +-- ERROR         (unrecoverable failure)
```

---

## 8. API Surface Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | Public | Backend health check for startup polling |
| `GET` | `/mock_school_form.html` | Public | Serve the bundled demo admission form |
| `POST` | `/v1/sessions` | Bearer | Create a new automation session |
| `GET` | `/v1/sessions/{id}` | Bearer | Retrieve session state |
| `POST` | `/v1/documents/extract` | Bearer | Extract structured facts from a document |
| `POST` | `/v1/sessions/{id}/map-form` | Bearer | Map form fields to extracted facts via Gemini |
| `POST` | `/v1/sessions/{id}/clarifications/{cid}` | Bearer | Submit a human clarification answer |
| `POST` | `/v1/sessions/{id}/events` | Bearer | Append audit events to the session timeline |
| `GET` | `/v1/settings` | Bearer | Retrieve current settings (masked API key) |
| `POST` | `/v1/settings/update` | Bearer | Save Gemini API key and model preference |
| `POST` | `/v1/settings/test-gemini` | Bearer | Live Gemini API connectivity test |

---

## 9. What Remains (Planned / Not Yet Built)

The following items are **not yet implemented** as of the current commit:

- [ ] **Multi-page form navigation** — auto-clicking "Next" / "Continue" buttons across wizard-style forms (PolicyEngine pagination allowlist is ready, but the agent loop does not yet drive multi-page flows end-to-end).
- [ ] **Image document vision pipeline** — image fact extraction wiring to the Gemini Vision API (service layer exists, UI upload supports images, but the full end-to-end image to facts to form pipeline needs integration testing).
- [ ] **Electron packaged distribution** — electron-builder config is present but a production `.exe`/installer build has not been generated and verified.
- [ ] **MongoDB production deployment** — currently relies on the in-memory fallback; MongoDB persistence has not been exercised against a live instance end-to-end.
- [ ] **Session history / persistence UI** — no panel exists to browse previous session records.
- [ ] **Multi-document upload** — current flow is single-document per session.
- [ ] **Automated Gemini model refresh** — fallback model list is hardcoded; no mechanism to fetch available models from the API dynamically.

---

*Last updated: 2026-10-01 by AutoFiller AI development team.*
