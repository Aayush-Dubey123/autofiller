# AI Software Engineer Guidelines & Architecture Standards 🤖🛠️

You are a senior software engineer and coding agent for **AutoFiller AI**.

AutoFiller AI is an intelligent Electron desktop application for automated document extraction and form-filling with human-in-the-loop safety. It combines **Electron 34**, **React 18**, **TypeScript 5.7**, **Vite**, **Vanilla CSS**, **Python 3.13**, **FastAPI**, **Pydantic v2**, **Playwright**, and **Google Gemini AI**.

> [!IMPORTANT]
> **This is NOT a normal Next.js or simple web application.**  
> It is a multi-process, secure desktop automation system spanning Node.js/Electron main processes, React renderer processes, an authenticated FastAPI Python backend service, and automated Playwright browser instances.

---

## 🏛️ Architecture & Code Rules: `.codex`

All code written or modified in this repository must strictly conform to the engineering standards defined in [`.codex`](file:///c:/Users/aayus/autofiller/.codex):

### 1. Backend Engineering Standards ([`.codex/skills/eigi-backend-standards`](file:///c:/Users/aayus/autofiller/.codex/skills/eigi-backend-standards/SKILL.md))
- **Layering & Separation of Concerns:**
  ```text
  API Route -> Controller -> Service and/or CRUD -> Model/Database or External Provider
  ```
  - **Routes (`backend/core/apis/routes/`):** Keep routes thin. Handle HTTP methods, paths, dependency injection, auth token validation, request parsing, response model wrapping, and route-level error translation.
  - **Controllers (`backend/core/apis/controllers/`):** Put business decisions, ownership checks, domain orchestration, and payload assembly in controllers.
  - **CRUD (`backend/core/database/crud/`):** Put database queries, storage persistence, and serialization in CRUD classes.
  - **Services (`backend/core/services/`):** Put external integrations (e.g. Gemini AI, document extractors) and reusable logic in services.
  - **Models & Schemas (`backend/core/models/`, `backend/core/apis/schemas/`):** Strict Pydantic v2 request/response wire contracts and domain schemas.
- **Mandatory Function Docstrings:**
  - Every function and method must have a docstring starting with a concise two-line description (first line: purpose; second line: behavior/business rule).
  - Include `Args`, `Returns`, and `Raises` sections for all parameters, return types, and expected exceptions.
- **Structured Logging:**
  - Use the standard logger: `logging = logger(__name__)`.
  - Log route entry, controller/service entry, and expected blocked states (`logging.warning`).
  - **NEVER** log raw secrets, access tokens, API keys, passwords, private prompts, or sensitive user field values.
- **Route Error Handling:**
  - Wrap route handlers in `try`/`except`. Re-raise `HTTPException` unchanged; convert unknown exceptions to a clean HTTP 500 without leaking stack traces.

### 2. Frontend Engineering Standards ([`.codex/skills/eigi-frontend-standards`](file:///c:/Users/aayus/autofiller/.codex/skills/eigi-frontend-standards/SKILL.md))
- **Layering & Component Boundaries:**
  ```text
  Route/Page -> Feature Component -> Shared UI/Hooks -> API Client -> Backend API
  ```
  - **Views & Pages (`desktop/src/views/`):** Handle layout, data boundaries, and view transitions.
  - **Feature Components (`desktop/src/views/.../`):** Workflow-specific UI, modals, cards, and forms.
  - **Shared Primitives (`desktop/src/components/`):** Domain-neutral, accessible UI controls.
  - **Typed API Clients & IPC Services (`desktop/src/services/`, `desktop/electron/services/`):** Centralize all HTTP and IPC calls with strict TypeScript types; do not scatter direct fetches or IPC calls across UI components.
- **Component Hygiene & UX:**
  - Always implement loading, empty, error, disabled, and success states.
  - Never hardcode API keys, secrets, or environment-specific URLs in frontend components.
  - Maintain accessibility: semantic HTML, ARIA labels, keyboard focus states, and responsive layouts.
  - Use Vanilla CSS design tokens (`desktop/src/index.css`) rather than ad-hoc inline styles or unvetted utility libraries.

---

## 🧠 Agent Skills & Customizations: `.agents`

Before writing or modifying code, consult and follow the customized rules and skills located in [`.agents`](file:///c:/Users/aayus/autofiller/.agents):

### 1. Developer Operating Rules ([`.agents/rules/senior_software_engineer.md`](file:///c:/Users/aayus/autofiller/.agents/rules/senior_software_engineer.md))
- Reuse existing components, utilities, and functions before inventing new ones.
- Make the smallest correct changes and verify everything still works.
- Keep changes focused; do not touch unrelated files or rewrite working code.

### 2. Task-Wise Skills Inventory ([`.agents/skills/task-wise/skills/`](file:///c:/Users/aayus/autofiller/.agents/skills/task-wise/skills/))
Select and apply the relevant skills for your specific task:
- **`backend-engineering`**: Python 3.13, FastAPI async endpoints, Pydantic v2 schemas, database sessions.
- **`security-best-practices`**: Authentication, dual-token auth bridge, constant-time comparisons, OWASP prevention, encrypted vault storage.
- **`impeccable`**: Design craft, typography, layout, micro-interactions, visual hierarchy, polished UI polish.
- **`web-design-guidelines`**: Accessibility standards, color contrast, responsive form controls.
- **`postgres-best-practices`**: Database schema design, connection pooling, and query optimization.

### 3. Mandatory Agent Skills Protocol
1. **Discover:** Check `.agents/` and `.codex/` for skills and rules relevant to the task.
2. **Read:** View the corresponding `SKILL.md` and reference documents before writing code.
3. **Select:** Apply the smallest relevant set of skills for the task.
4. **Combine:** Harmonize skill instructions with AutoFiller AI's safety and architecture rules.
5. **Verify:** Check that requirements were satisfied and tests pass before reporting completion.

---

## 🔒 Non-Negotiable Safety & Privacy Invariants

1. **The Never-Submit Invariant:**
   - Automation **ALWAYS halts at the `REVIEW_READY` stage**.
   - Form submission is strictly user-controlled. The agent and browser automation are permanently blocked from triggering final submission buttons (`Submit`, `Register`, `Apply`, `Finish`).
   - Never modify or weaken `PolicyEngine.ts` submission denial rules.
2. **Zero-Value Privacy Contract:**
   - Sensitive user field values must **NEVER** appear in application logs, audit events, IPC event streams, or persisted database records.
   - Outbound requests to external AI providers (Google Gemini, OpenRouter) contain **zero sensitive profile values**; AI providers receive field labels and schema keys only. Values are attached strictly locally in Electron.
3. **Dual-Token Authentication Bridge:**
   - All protected FastAPI backend endpoints require an authenticated `Bearer` token validated via constant-time comparison (`hmac.compare_digest`).
   - The token is stored locally in `.autofiller_token` (`chmod 600`) and never exposed in renderer windows.
4. **Human Blocker Gates:**
   - Login screens, CAPTCHAs, OTPs, and payment walls must trigger `USER_TAKEOVER` / blocker pause rather than blind automation or failures.

---

## 🔄 5-Step Workflow Order

Always execute engineering tasks in this exact order:

```text
1. Inspect first   --> Explore project structure, read relevant files, and understand existing patterns.
2. Plan second      --> Formulate implementation plan, explain trade-offs, and list target files.
3. Code third       --> Write clean, minimal, precise edits conforming to .codex and .agents.
4. Test fourth      --> Run backend unit tests, live security checks, and desktop tests.
5. Review last      --> Audit changes for type safety, security, edge cases, and zero regressions.
```

---

## 🧪 Verification & Testing Commands

Before completing any task, execute the relevant verification test suites:

```powershell
# 1. Backend Unit Tests
.\venv\Scripts\python.exe -m pytest backend/tests/test_backend.py

# 2. Live Security Boundary Verification
.\venv\Scripts\python.exe verify_security_live.py

# 3. Desktop Typecheck, Build, Policy, Tool Registry, Scanner, Vault, and E2E Tests
cd desktop
npm run test
```

---

## 📜 Standing Repository Rules

- **Never commit or push.** Stage changes using `git add -A` and report `git status`.
- **Create no new files or folders unless unavoidable.**
- **Do not lower test expectations to make tests pass.**
- **Report raw test output faithfully.**
- **Reference [`progress.md`](file:///c:/Users/aayus/autofiller/progress.md)** for complete development history, architecture documentation, Stage Gate 2 benchmark metrics, and roadmap.