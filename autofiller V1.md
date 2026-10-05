# AutoFiller AI — Comprehensive Independent QA Audit Report (Version 1)

**Audit Date:** October 4, 2026  
**Auditor:** Independent QA Tester & Security Auditor  
**Scope:** `backend/` and `desktop/` source trees, configuration, live execution, and test suites.  
**Git Policy Adherence:** Zero code modifications made; zero commits/pushes; all findings documented with exact evidence and reproducible steps.

---

## Executive Summary

The AutoFiller AI codebase demonstrates an exceptionally robust architecture in local cryptographic vault storage, desktop IPC sandboxing, and autonomous submission policy enforcement. The state machine rigorously enforces the `REVIEW_READY` safety boundary, with zero autonomous pathways capable of executing final form submission. The V2 VaultService crypto path (AES-256-GCM, PBKDF2/scrypt, OS safeStorage key-wrapping, recovery code single-use re-keying, and atomic writes) is mathematically and operationally solid, cleanly rejecting ciphertext and authentication tag tampering. However, the audit uncovered **1 Critical**, **2 High**, **2 Medium**, and **3 Low** severity issues. The most significant vulnerabilities are:
1. **Critical:** A path containment bypass in `backend/core/services/document_service.py` where `Path.home()` is included in `_allowed_roots()`, allowing document extraction to read arbitrary files anywhere in the user's home directory (e.g., `.env`, SSH private keys, token files).
2. **High:** Execution event payloads emitted over IPC and persisted to the backend audit log leak raw sensitive field values within their `metadata` objects (e.g., `mappings[].fact_value`, `actualValue`, `expectedValue`), violating the zero-value audit persistence contract.
3. **High:** A gap in `PolicyEngine.ts` submission button regex matching that allows non-standard but prevalent submission button labels (such as `"Place Order"`, `"Finish Application"`, `"Register Now"`, and `"Continue to Payment"`) to bypass submission blocking.

Overall, the core desktop orchestration, browser automation, and vault encryption are **solid**, while the backend document containment and audit event sanitization are **fragile** and require immediate remediation.

---

## Audit Breakdown by Module

### Part 1: Backend (`backend/`)

| Area | What Was Tested | Method | Result | Evidence (file:line or output) | Severity if Failed |
|---|---|---|---|---|---|
| **1.1 Startup & Lifecycle** | Startup with GEMINI_API_KEY present, empty, malformed; CORS allowlist; lifespan DB init/close; 500 error leak prevention | White-box & Black-box | **PASS / MINOR GAP** | `api.py:111` allow_methods lacks `"DELETE"`. 500 handler returns `{"detail": "Internal server error"}` with zero traceback leak. | Medium (`api.py:111`) |
| **1.2 Auth Bridge** | `hmac.compare_digest` timing-safe check; token file permissions (`0o600`); `.formpilot_token` migration; startup refusal on `ALLOW_ANONYMOUS`; empty/malformed/whitespace Bearer headers | White-box & Black-box | **PASS** | `auth.py:18` uses `hmac.compare_digest`. Anonymous flag raises `RuntimeError`. Malformed/whitespace tokens rejected with 401. | Solid |
| **1.3 Pydantic Data Models** | `FormFieldType`, `SessionStatus`, `ExtractedFact`, `FieldMapping`, `SessionModel` validation, invalid enums, out-of-range confidence scores (<0.0 or >1.0) | White-box & Black-box | **PASS** | `session_model.py:46,67` Pydantic v2 rejects invalid enums and out-of-range scores with `ValidationError`. | Solid |
| **1.4 Session Router** | POST `/v1/sessions` (201), GET (200/404), DELETE `/v1/sessions/{id}` (200), idempotent delete (200), DELETE `/v1/sessions` (purge all), unauthenticated requests (401) | White-box & Black-box | **PASS** | `session_router.py:126-174` returns correct status codes. Unauthenticated requests return 401. | Solid |
| **1.5 Document Service** | `KEY_ALIASES` coverage vs 16 demo fields; path containment checks; 25MB file & 100k char caps; corrupt/encrypted/empty PDFs; unsupported file extensions | White-box & Black-box | **FAIL (CRITICAL)** | `document_service.py:127` includes `Path.home()`, permitting extraction of arbitrary user files like `backend/.env`. Corrupt/unsupported files raise unhandled exceptions. | **Critical** (`document_service.py:127`) |
| **1.6 Gemini Service** | Fallback model chain (`gemini-3.5-flash` -> `lite` -> `3.6-flash`); heuristic fallback engagement; `format_to_strict_dd_mm_yyyy`; `_strip_code_fences`; raw prompt privacy audit | White-box & Black-box | **CONFIRMED** | `gemini_service.py:112` raw prompt sends `json.dumps([f.model_dump() for f in facts])`, confirming field values ARE sent to Gemini. Date normalizer handles ambiguous dates; two-digit years unexpanded. | Informational / Privacy Confirmation |
| **1.7 Database & In-Memory Store** | In-memory fallback on bad Mongo URL; race condition under 50 concurrent updates; session delete & purge in both modes | White-box & Black-box | **PASS** | `database.py:65` seamlessly falls back to `InMemorySessionDatabase`. 50 concurrent async updates executed with zero race conditions. | Solid |
| **1.8 Security Scripts** | Live execution of `verify_security_live.py` and `check_wire_contract.py` | Black-box | **PASS (WITH CAVEAT)** | `verify_security_live.py` tested `../../backend/.env` (outside home dir), which passed, giving false sense of containment security. Wire contract passed 100%. | Informational |
| **1.9 Backend Test Suite** | Full execution of `pytest tests/test_backend.py -v` | Black-box | **PASS** | 25 passed in 0.98s. | Solid |

---

### Part 2: Electron Main Process (`desktop/electron/`)

| Area | What Was Tested | Method | Result | Evidence (file:line or output) | Severity if Failed |
|---|---|---|---|---|---|
| **2.1 Window & Process Security** | `contextIsolation`, `sandbox`, `nodeIntegration`, `webSecurity`; CSP headers; backend spawn error handling; 20s health poll timeout | White-box & Black-box | **PASS** | `main.ts:88-93` all 4 flags set to secure values. CSP blocks inline scripts. Backend health probe retries 40 times (20s) before alerting. | Solid |
| **2.2 VaultService Cryptography** | Full crypto path: create, lock, unlock, wrong key exponential backoff, tampered ciphertext (1 hex char flip), tampered authTag, corrupt JSON, V1 scrypt params, recovery code re-keying, atomic write `.tmp` -> `.bak` | White-box & Black-box | **PASS** | `VaultService.ts:384-512` GCM rejects tampered ciphertext and authTag with `Unsupported state or unable to authenticate data`. Recovery unlock forces key rotation. | Solid |
| **2.3 Agent Controller** | 50-step loop bound; AbortController cancellation; REVIEW_READY never auto-submits; clarification 10m timeout; FIFO persistence queue; event value leak inspection | White-box & Black-box | **FAIL (HIGH)** | 50-step bound halts at step 50. Loop halts strictly at REVIEW_READY. But `AgentController.ts:445,719` leaks raw values in `metadata` of `STATE_CHANGED`, `fill_text`, and `verify_field`. | **High** (`AgentController.ts:445,719`) |
| **2.4 Tool Registry** | Tool dispatch with malformed args (missing fieldRef, wrong type, non-`field_NNN` format); unregistered tool refusal | White-box & Black-box | **PASS** | `ToolRegistry.ts:334` throws `TOOL_NOT_REGISTERED`. Mutating tools missing fieldRef or using invalid format reject with `INVALID_FIELD_REFERENCE`. | Solid |
| **2.5 Policy Engine** | Submission guard regex against button labels; pagination allowlist against demo form; cross-origin navigation guard; `field_NNN` format check | White-box & Black-box | **FAIL (HIGH)** | `PolicyEngine.ts:51` blocks `"Submit & Pay"` and `"Submit"`, but misses `"Place Order"`, `"finish Application"`, `"Continue to Payment"`, and `"Register Now"`. Navigation guard allows `javascript:` URIs. | **High** (`PolicyEngine.ts:51`) |
| **2.6 Form Scanner & Browser Manager** | Mock form scan (16 fields, 3 visible, 13 hidden across 5 sections, 2 collapsed radio groups); date normalization variants; cancellation mid-delay and mid-navigation | White-box & Black-box | **PASS** | Playwright detects 16 fields, collapses radio groups, detects 4 Continue buttons and 1 Submit control. Date normalizer converts formats to YYYY-MM-DD. Cancellations trigger `OperationCancelledError`. | Solid |
| **2.7 IPC Bridge & Preload** | Enumeration of all 28 exposed channels; input validation; verification that no raw Node/Electron APIs are exposed | White-box | **PASS** | `preload.ts:28-156` contextBridge exposes only typed API. `targetUrl` validated for `http:`/`https:`. No raw `ipcRenderer` or Node modules leaked. | Solid |

---

### Part 3: Renderer UI (`desktop/src/`)

| Area | What Was Tested | Method | Result | Evidence (file:line or output) | Severity if Failed |
|---|---|---|---|---|---|
| **3.1 First Run & Home CTA** | Launch with empty userData: no key prompt on start; HomeView "Add your details once" banner; save in MyDetails persists to encrypted disk file | Black-box & White-box | **PASS** | `App.tsx:72` only prompts for unlock if passphrase slot exists and vault is locked. Details save persists across app restarts. | Solid |
| **3.2 Settings Wizard** | Step 1 -> Step 2 -> Step 3 navigation; cancel mid-wizard; re-open; passphrase strength meter; mismatch between passphrase and confirm passphrase | Black-box & White-box | **PASS** | `SettingsView.tsx:105-167` wizard validates length (>=10 chars), prevents submission on mismatch, presents Copy/Download on Step 3 with no auto-close timers. | Solid |
| **3.3 History Management** | Single delete, multi-select delete, Clear All; disk inspection of `autofiller-history.json` for value leaks | Black-box & White-box | **PASS** | `HistoryStore.ts:47-99` records only `id`, `date`, `hostAndPath`, `status`, `fieldsFilled`, `totalFields`, `profileName`. Zero field values saved to disk. | Solid |
| **3.4 Theme Persistence** | Theme toggle between light and dark modes across application restart | Black-box & White-box | **PASS** | `App.tsx:31,57` persists theme to `localStorage.autofiller_theme` and reloads on startup. | Solid |
| **3.5 DevTools & Console** | Console warning and error audit during standard operation and form stepping | Black-box | **PASS** | Zero unhandled rejections or runtime syntax errors observed during normal execution. | Solid |

---

### Part 4: Integration & Automated Test Suite Outputs

#### 4.1 Automated Suite Raw Outputs

##### A. Backend Pytest (`pytest tests/test_backend.py -v`)
```
============================= test session starts =============================
platform win32 -- Python 3.13.2, pytest-8.3.4, pluggy-1.5.0 -- C:\Users\aayus\autofiller\venv\Scripts\python.exe
cachedir: .pytest_cache
rootdir: C:\Users\aayus\autofiller
configfile: pytest.ini
plugins: anyio-4.8.0, asyncio-0.25.3
asyncio: mode=Mode.STRICT, default_loop_scope=None
collecting ... collected 25 items

tests/test_backend.py::test_auth_missing_header PASSED                   [  4%]
tests/test_backend.py::test_auth_invalid_token PASSED                    [  8%]
tests/test_backend.py::test_auth_valid_token PASSED                      [ 12%]
tests/test_backend.py::test_auth_dual_token_both_accepted PASSED         [ 16%]
tests/test_backend.py::test_create_session PASSED                        [ 20%]
tests/test_backend.py::test_create_session_defaults PASSED               [ 24%]
tests/test_backend.py::test_get_session PASSED                           [ 28%]
tests/test_backend.py::test_get_session_not_found PASSED                 [ 32%]
tests/test_backend.py::test_append_events PASSED                         [ 36%]
tests/test_backend.py::test_append_events_with_verifications PASSED      [ 40%]
tests/test_backend.py::test_map_form_endpoint PASSED                     [ 44%]
tests/test_backend.py::test_answer_clarification PASSED                  [ 48%]
tests/test_backend.py::test_extract_document_facts_text PASSED           [ 52%]
tests/test_backend.py::test_extract_document_path_containment PASSED     [ 56%]
tests/test_backend.py::test_extract_document_size_cap PASSED             [ 60%]
tests/test_backend.py::test_heuristic_mapping_fallback PASSED           [ 64%]
tests/test_backend.py::test_security_headers_present PASSED              [ 68%]
tests/test_backend.py::test_health_endpoint PASSED                       [ 72%]
tests/test_backend.py::test_session_model_validation PASSED              [ 76%]
tests/test_backend.py::test_session_status_transitions PASSED            [ 80%]
tests/test_backend.py::test_event_value_sanitization PASSED              [ 84%]
tests/test_backend.py::test_delete_session_endpoint PASSED               [ 88%]
tests/test_backend.py::test_delete_session_not_found PASSED              [ 92%]
tests/test_backend.py::test_purge_all_sessions_endpoint PASSED           [ 96%]
tests/test_backend.py::test_purge_requires_auth PASSED                   [100%]

============================= 25 passed in 0.98s ==============================
```

##### B. Wire Contract Test (`python check_wire_contract.py`)
```
============================================================
CHECKING DESKTOP <-> BACKEND WIRE CONTRACT
============================================================
1. Checking POST /v1/sessions contract...
   [OK] matches {document_name, target_url} -> {id, ...}
2. Checking POST /v1/sessions/{session_id}/events contract...
   [OK] matches {events: [...], verifications: [...]}
3. Checking POST /v1/documents/extract contract...
   [OK] matches {filePath, rawText, documentName} -> {facts, ...}
4. Checking POST /v1/sessions/{session_id}/map contract...
   [OK] matches {form_snapshot, facts} -> {mappings, clarifications_required}
5. Checking POST /v1/sessions/{session_id}/clarifications/{id} contract...
   [OK] matches {answer: string}
6. Checking GET /health and /v1/sessions/{session_id} contract...
   [OK] GET endpoints match expected shapes.

[SUCCESS] All desktop requests match backend FastAPI route expectations!
```

##### C. Desktop Test Suite (`npm test`)
```
> autofiller-desktop@1.0.0 test
> npm run build && node tests/policy_test.js && node tests/tool_registry_test.js && node tests/scanner_test.js && node tests/vault_test.js && node tests/e2e_integration_test.js


> autofiller-desktop@1.0.0 build
> npm run typecheck && vite build && tsc -p tsconfig.electron.json


> autofiller-desktop@1.0.0 typecheck
> tsc --noEmit && tsc --noEmit -p tsconfig.electron.json

vite v6.1.0 building for production...
transforming...
✓ 1595 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   1.05 kB │ gzip:  0.57 kB
dist/assets/index-DDmWhSG2.css    2.71 kB │ gzip:  1.14 kB
dist/assets/index-BQkZ2R0Z.js   255.86 kB │ gzip: 69.55 kB
✓ built in 2.08s
Running AutoFiller PolicyEngine tests against dist-electron...
  ok - blocks Submit Application
  ok - blocks Submit
  ok - blocks Apply Now
  ok - blocks any structural submit control
  ok - allows wizard pagination buttons
  ok - never treats a submission control as pagination
  ok - refuses unregistered and shell-like tools
  ok - permits registered read-only tools
  ok - refuses mutating tools without a validated field reference
  ok - derives submission detection from real page controls
  ok - treats buttons without explicit type as submit controls
  ok - does NOT treat type="button" and type="reset" as final submission controls
  ok - treats input[type="submit"] and input[type="image"] as submit controls
  ok - denies cross-host navigation

All 14 PolicyEngine assertions passed.
Running AutoFiller ToolRegistry dispatch tests...
  ok - refuses an unregistered tool without touching the browser
  ok - refuses a mutating tool with no field reference
  ok - refuses a crafted selector passed as a field reference
  ok - executes a valid fill_text through to the browser
  ok - executes typed mutating tools with the correct browser call
  ok - rejects malformed arguments before executing

All 6 ToolRegistry assertions passed.
Running FormScanner & BrowserManager submission controls Playwright test...
Discovered 16 form fields in FormSnapshot (3 visible, 13 hidden).
Discovered 5 submission control(s): [
  {
    label: 'Continue',
    selector: 'button:nth-of-type(1)',
    isSubmitType: false,
    type: 'button'
  },
  {
    label: 'Continue',
    selector: 'button:nth-of-type(2)',
    isSubmitType: false,
    type: 'button'
  },
  {
    label: 'Continue',
    selector: 'button:nth-of-type(3)',
    isSubmitType: false,
    type: 'button'
  },
  {
    label: 'Continue',
    selector: 'button:nth-of-type(4)',
    isSubmitType: false,
    type: 'button'
  },
  {
    label: 'Submit Application',
    selector: '#submitBtn',
    isSubmitType: true,
    type: 'submit'
  }
]
✓ FormScanner & submission controls test passed successfully!
=== Running VaultService Encryption & Security Tests (V2 Key Slots) ===
✓ All VaultService V2 encryption, key slots, and security tests passed cleanly!
=== AutoFiller End-to-End AgentController Verification ===
  ok - FormScanner collapses radio groups into descriptive scoped fields
  ok - the real agent fills fields and halts at REVIEW_READY
  ok - field fills are verified and reported truthfully
  ok - the agent never clicks a submission control
  ok - real submit controls are detected separately from fillable fields
  ok - agent events are persisted to the session audit timeline
  ok - concurrent session starts are refused

All 7 end-to-end assertions passed.
```

---

## Detailed Findings

### Finding 1: Path Containment Bypass Allows Reading Arbitrary User Files
- **Severity:** Critical (Security Vulnerability)
- **Location:** `backend/core/services/document_service.py:127`
- **Reproduction Steps:**
  1. Make a POST request to `/v1/documents/extract` with payload:
     `{"filePath": "C:/Users/aayus/autofiller/backend/.env"}`.
  2. Because `_allowed_roots()` includes `Path.home().resolve()` (`C:\Users\aayus`), `_is_contained()` returns `True`.
  3. The backend extracts text and sensitive facts from `.env`, `.autofiller_token`, SSH keys, or browser histories located anywhere under the user's home folder.
- **Suggested Fix:** Restrict `_allowed_roots()` strictly to user-designated document upload folders (e.g. `Downloads`, `Documents`, `Desktop`, or temporary application directories) rather than the broad user root `Path.home()`.

---

### Finding 2: Sensitive Field Values Leak into Event Objects and Persisted Audit Logs
- **Severity:** High (Privacy & Data Leakage)
- **Location:** `desktop/electron/agent/AgentController.ts:445, 703, 719`
- **Reproduction Steps:**
  1. Start an automation session with sensitive facts (e.g., student name, email, parent contact).
  2. Inspect the `AgentEventPayload` objects emitted to IPC and queued in `persistenceQueue` for backend storage:
     - `STATE_CHANGED` event includes `metadata.mappings`, containing raw `fact_value` for all mapped fields.
     - `TOOL_COMPLETED` for `fill_text` includes `metadata.actualValue` and `metadata.expectedValue`.
     - `TOOL_COMPLETED` for `verify_field` includes `metadata.actualValue` and `metadata.expectedValue`.
- **Suggested Fix:** Sanitize the tool result objects and mapping lists before assigning them to `AgentEventPayload.metadata`, removing all instances of `actualValue`, `expectedValue`, and `fact_value`.

---

### Finding 3: Final Submission Guard Regex Misses Prevalent Checkout and Application Buttons
- **Severity:** High (Safety Boundary Gap)
- **Location:** `desktop/electron/policy/PolicyEngine.ts:51-52, 126-129`
- **Reproduction Steps:**
  1. Invoke `policyEngine.validateBrowserAction('click', 'Place Order', false)`.
  2. Invoke `policyEngine.validateBrowserAction('click', 'finish Application', false)`.
  3. Invoke `policyEngine.validateBrowserAction('click', 'Continue to Payment', false)`.
  4. Invoke `policyEngine.validateBrowserAction('click', 'Register Now', false)`.
  5. All calls return `{ allowed: true, code: 'ACTION_ALLOWED' }` instead of `DENIED_FINAL_SUBMISSION`.
- **Suggested Fix:** Expand `forbiddenButtonTerms` regex to match `place\s+order`, `finish(\s+application)?`, `register(\s+now)?`, `complete(\s+order|\s+registration)?`, and any control referencing `payment`.

---

### Finding 4: CORS Middleware Omits DELETE Method, Breaking Preflight Requests
- **Severity:** Medium (API / Integration)
- **Location:** `backend/core/apis/api.py:111`
- **Reproduction Steps:**
  1. Send an HTTP `OPTIONS /v1/sessions/test-session-id` with `Access-Control-Request-Method: DELETE`.
  2. FastAPI's CORSMiddleware returns HTTP 400 Bad Request because `allow_methods` only specifies `["GET", "POST"]`.
  3. Browser or cross-origin web client attempting session deletion via DELETE method is blocked by CORS.
- **Suggested Fix:** Add `"DELETE"` to `allow_methods` in `api.py:111`.

---

### Finding 5: Empty or Scanned PDFs Without Gemini Vision Trigger Unhandled Server Errors
- **Severity:** Medium (Robustness / Error Handling)
- **Location:** `backend/core/services/document_service.py:288-313`
- **Reproduction Steps:**
  1. Upload a PDF that contains no extractable digital text (e.g. blank page or image scan).
  2. If `GEMINI_API_KEY` is absent or quota-exhausted, `extract_document_facts` raises `RuntimeError("Google Gemini API is not configured or failed extraction...")`.
  3. The request terminates with HTTP 500 rather than returning an empty fact list or clean user-facing error.
- **Suggested Fix:** Catch Vision extraction errors when digital text extraction yields empty text and return an empty fact list with a warning or raise HTTP 422.

---

### Finding 6: Cross-Origin Navigation Guard Allows `javascript:` Pseudo-Protocols
- **Severity:** Low (Security Guardrail)
- **Location:** `desktop/electron/policy/PolicyEngine.ts:221-239`
- **Reproduction Steps:**
  1. Call `policyEngine.validateNavigation('school.edu', 'javascript:alert(1)')`.
  2. `new URL('javascript:alert(1)').host` evaluates to `""`.
  3. The conditional check `currentHost && targetHost && currentHost !== targetHost` evaluates to false, returning `{ allowed: true, code: 'NAVIGATION_ALLOWED' }`.
- **Suggested Fix:** Validate that the target URL protocol belongs strictly to `['http:', 'https:', 'file:']` and deny all others.

---

### Finding 7: Binary Executables Fall Through to Plaintext Decoder
- **Severity:** Low (Code Quality)
- **Location:** `backend/core/services/document_service.py:344`
- **Reproduction Steps:**
  1. Submit a binary file (e.g. `.exe`, `.bin`, `.dll`) to `/v1/documents/extract`.
  2. Because the extension is unrecognized, execution falls through to `path.read_text(encoding="utf-8", errors="ignore")`, attempting regex fact matching on binary junk.
- **Suggested Fix:** Explicitly whitelist permitted file extensions (`.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.txt`) and reject all others with an HTTP 415 or 400 error.

---

### Finding 8: `KEY_ALIASES` Missing Canonical Aliases for Common Demographics
- **Severity:** Low (Form Filling Accuracy)
- **Location:** `backend/core/services/document_service.py:41-86`
- **Reproduction Steps:**
  1. Extract a document containing `"Sex: Male"` or `"Town: Springfield"`.
  2. Facts are recorded with keys `sex` and `town`.
  3. `KEY_ALIASES` does not map `sex` -> `gender` or `town` -> `city`, forcing the system to rely entirely on LLM semantic inference rather than the direct rule-based matcher.
- **Suggested Fix:** Add mappings for `sex` -> `gender`, `town` -> `city`, and `province` -> `state` to `KEY_ALIASES`.

---

## Confirmed Working Architecture

The following components were thoroughly tested (both white-box and black-box) and confirmed solid:
- **Never-Submit Safety Boundary:** The agent workflow transitions from `VERIFYING` directly to `REVIEW_READY` and completely halts. Neither `AgentController.ts`, `PolicyEngine.ts`, nor `ToolRegistry.ts` contains any code path allowing autonomous triggering of `submitFormAsOperator()`.
- **Stepped Form Compatibility:** FormScanner and BrowserManager cleanly handle multi-step wizards (`mock_school_form.html`), distinguishing active visible controls from hidden sections and maintaining correct field references across all 5 sections.
- **Radio Group Scoping:** Radio buttons sharing a `name` attribute are collapsed into single logical entities with options mapped and values scoped to their fieldset/group label.
- **Vault V2 Encryption & Key Slots:**
  - AES-256-GCM authenticated encryption rejects all bit-flipped ciphertext and tampered authentication tags.
  - OS safeStorage DEK wrapping works seamlessly when available.
  - Rate-limiting exponential backoff on wrong password attempts is enforced.
  - Recovery codes force a mandatory key reset upon unlocking.
  - V1 vault files with custom scrypt parameters load smoothly without data loss.
- **Zero-Value History Store:** `HistoryStore.ts` writes strictly sanitized metadata records to `autofiller-history.json`. No personal values, passwords, or document bodies are ever written to the history log.
- **Dual-Token Backend Auth:** HMAC timing-safe validation correctly authenticates the dual-token bridge between Electron and FastAPI, and refuses execution when anonymous access flags are set.
- **In-Memory Concurrency:** High-concurrency operations on the backend in-memory database execute with zero race conditions or state corruption.
