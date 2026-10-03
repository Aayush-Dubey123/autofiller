<div align="center">

# AutoFiller AI

### `DOCUMENT → AI → BROWSER AUTOMATION → REVIEW`

AI-assisted desktop automation for turning student documents into verified web-form data.

**Electron** · **React** · **TypeScript** · **FastAPI** · **Gemini** · **Playwright**

</div>

# idea:

How the extension will work (brief)

One-time setup: you enter your data once into an encrypted profile vault in the extension. You can type it in or upload a document and let Gemini extract it, which reuses what you already built.

Every time you need to fill a form:

Open any website with a form and click the extension icon or press a shortcut.
A content script scans the page: fields, labels, dropdowns, radios, and multi-step forms.
A fast rule-based mapper matches fields to your profile. Gemini is called only for fields the rules can't resolve, and it receives field labels only, never your actual values.
The extension fills the fields locally and highlights them by confidence: green for confident, amber for uncertain, red for unmapped.
You review and correct, then submit yourself. The extension never submits, and it never touches passwords, OTPs, or card fields.

What carries over from your current project:

The scanner logic, the policy engine (submission guard), the date normalizer, and the key aliases move into a shared core.
Electron and Playwright are retired from the product and kept only as a test harness.
FastAPI becomes a small, authenticated, stateless backend used for Gemini calls, so other users don't need their own API key.
Phases, one per step
#	Phase	Outcome
0	Cleanup, rename, monorepo layout	A clean structure, with FormPilot renamed to AutoFiller everywhere
1	Shared core package	Scanner and policy engine with no Electron or Playwright dependency
2	Profile vault	Encrypted multi-profile data store
3	Universal form engine	Works beyond the demo school form: shadow DOM, iframes, custom dropdowns, multi-step forms
4	Chrome extension shell (MV3)	Popup, side panel, shortcut, and review overlay
5	Safety layer	Sensitive-field rules and domain controls
6	Backend v2	Auth, quotas, and stateless Gemini proxy
7	UI/UX redesign	Design system, onboarding, light and dark themes
8	Testing	Fixture forms from real sites and an accuracy score
9	Privacy and compliance	Policy, data deletion, and Web Store requirements
10	Deploy and publish	Hosted API and Chrome Web Store release

---

## What it solves

School and admission workflows often require staff to read documents and manually copy student information into web forms. AutoFiller AI turns that repetitive workflow into a supervised automation pipeline.

**Input:** student document  →  **Extract:** structured facts  →  **Map:** form fields  →  **Fill:** visible browser  →  **Verify:** source vs. form  →  **Review:** human approval

The project is intentionally designed around a **human-in-the-loop boundary**: automation stops at `REVIEW_READY`; final form submission remains user-controlled.

---

## System architecture

```mermaid
flowchart LR
    A[Student Document] --> B[Electron Desktop App]
    B --> C[FastAPI Backend]
    C --> D[Gemini AI]
    D --> E[Structured Facts]
    E --> F[Field Mapping]
    F --> G[Playwright]
    G --> H[Visible Web Form]
    H --> I[Verification]
    I --> J{Review Ready}
    J --> K[Human Review]
    K --> L[User-Controlled Submission]
```

### Core responsibilities

| Layer | Responsibility |
|---|---|
| **Electron + React** | Desktop UI and agent host |
| **FastAPI + Pydantic** | Backend API and validation |
| **Gemini** | Document parsing and semantic field mapping |
| **Playwright** | Visible browser navigation and form interaction |
| **Verification** | Re-check filled values against extracted source data |
| **Safety layer** | Origin/navigation policies, token bridge and submission guardrails |

---

## Workflow

### `01` Upload
Provide a student record such as a PDF, image or text-based document.

### `02` Extract
Gemini converts the document into structured facts such as name, DOB, parent details, address and phone information.

### `03` Discover & map
The agent opens the target website and maps extracted facts to supported controls: text inputs, selects, radio groups and checkboxes.

### `04` Fill visibly
Playwright performs the browser interaction in a visible session so the user can observe the automation.

### `05` Verify
The application re-scans the completed fields and checks them against the source facts.

### `06` Review boundary
Missing or ambiguous information triggers clarification. Once the workflow reaches `REVIEW_READY`, automation stops and the user owns the final decision.

---

## Why this project is interesting

- **Agentic workflow:** combines LLM reasoning with deterministic browser automation.
- **Desktop + backend architecture:** Electron hosts the user experience while FastAPI handles AI-backed processing.
- **Semantic field matching:** maps document facts to form controls rather than relying only on exact labels.
- **Visible automation:** the browser is observable and interruptible instead of being a hidden background process.
- **Verification-first:** filled values are checked before the workflow reaches human review.
- **Safety by design:** strict navigation and submission boundaries are part of the architecture, not an afterthought.

---

## Technology

**Desktop**  
Electron 34 · React 18 · TypeScript · Vite · Playwright

**Backend**  
Python 3.13 · FastAPI · Pydantic v2 · Google Gemini AI · PyMuPDF · MongoDB

**Engineering**  
Dual-token authentication bridge · CSP/security controls · automated tests · Windows packaging

---

## Repository structure

```text
AutoFiller AI/
├── backend/
│   ├── core/              # Backend application logic
│   ├── commons/           # Shared security/authentication utilities
│   ├── scripts/           # Backend utilities
│   ├── tests/             # Backend tests
│   └── main.py            # FastAPI entry point
│
├── desktop/
│   ├── electron/          # Electron main-process code
│   ├── src/               # React application
│   │   ├── components/
│   │   ├── features/
│   │   ├── lib/
│   │   └── types/
│   ├── tests/             # Desktop policy, scanner and E2E tests
│   └── public/             # Mock form + sample document
│
└── AGENTS.md              # Engineering workflow and safety guidelines
```

---

## Run locally

### Prerequisites

- Node.js 18+
- Python 3.11+
- Gemini API key

### Backend

```bash
python -m venv venv
.\venv\Scripts\activate
pip install -r backend/requirements.txt
```

Configure `GEMINI_API_KEY` in your environment, then start the FastAPI service using the project's backend entry point.

### Desktop

```bash
cd desktop
npm install
npm run dev
```

For the packaged Electron application:

```bash
npm run electron
```

---

## Verification

The repository includes separate backend and desktop verification paths.

```bash
# Backend tests
.\venv\Scripts\python.exe -m pytest backend/tests/test_backend.py

# Desktop build + policy + scanner + E2E integration tests
cd desktop
npm run test
```

The desktop test command builds the application before running the policy, tool-registry, scanner and E2E integration checks.

---

## Safety model

```text
DOCUMENT
   ↓
AI EXTRACTION
   ↓
FIELD MAPPING
   ↓
VISIBLE PLAYWRIGHT AUTOMATION
   ↓
VERIFICATION
   ↓
REVIEW_READY  ← automation stops here
   ↓
HUMAN REVIEW
   ↓
USER-CONTROLLED SUBMISSION
```

The system is designed to **clarify instead of guess** when information is missing, ambiguous or conflicting.

---

## Status

**Phase One:** document extraction → browser automation → field mapping → verification → `REVIEW_READY`.

MIT License.

---

## Manual Quick Start (Running Dev Environment)

### Option A: Automatic Launcher (Recommended)
Run the PowerShell launcher script from the root directory:
```powershell
.\start.ps1
```
*(Or `start.bat` on Command Prompt)*. This script verifies the Python environment, starts the FastAPI backend service, polls `/health` until ready, launches the Electron window, and cleanly shuts down the backend process upon exit.

### Option B: Manual Two-Terminal Setup

#### Terminal 1 — Start Python FastAPI Backend
1. Ensure your Gemini API key is configured in `backend/.env`:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
2. Activate virtual environment and start the Uvicorn ASGI server:
   ```powershell
   .\venv\Scripts\activate
   python -m uvicorn core.apis.api:app --app-dir backend --host 127.0.0.1 --port 8000
   ```

#### Terminal 2 — Start Electron Desktop Window
1. Navigate to the `desktop` directory and launch Electron:
   ```powershell
   cd desktop
   npm run electron
   ```
2. *(Optional)* For Vite frontend UI previewing in a browser:
   ```powershell
   cd desktop
   npm run dev
   ```
   *Note: Real document extraction and Playwright browser automation require running inside the Electron shell via `npm run electron` or `.\start.ps1`.*