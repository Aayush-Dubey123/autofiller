<div align="center">

# AutoFiller AI

### Document → AI → Browser Automation → Human Review

AutoFiller AI is a desktop application that extracts information from student documents and uses it to fill web-based school admission and registration forms safely and efficiently.

**Electron** · **React** · **TypeScript** · **FastAPI** · **Google Gemini** · **Playwright**

</div>

## The Problem

School admissions, registrations, and similar workflows often require users or staff to manually copy information from documents into lengthy online forms. This process is:

- **Repetitive:** The same student details are entered across multiple forms.
- **Time-consuming:** Manual data entry slows down admissions and administrative work.
- **Error-prone:** Names, dates, addresses, phone numbers, and other details can be mistyped.
- **Difficult to verify:** It is easy to miss required fields or enter information in the wrong format.
- **Unsafe to automate blindly:** An automated system must not submit forms or make decisions without human oversight.

## The Solution

AutoFiller AI combines document intelligence with visible browser automation. It reads information from an uploaded document, understands the target form, maps the extracted information to the appropriate fields, fills the form, and verifies the result.

The workflow is:

```text
Student document
      ↓
AI-powered data extraction
      ↓
Web-form scanning
      ↓
Semantic field mapping
      ↓
Visible browser form filling
      ↓
Verification
      ↓
Human review
      ↓
User-controlled submission
```

Automation always stops at the `REVIEW_READY` state. The user remains responsible for checking the completed form and submitting it manually.

## How It Works

1. **Upload a document** — Provide a PDF, image, or supported student record.
2. **Extract information** — Google Gemini and document-processing services identify structured facts such as the student's name, date of birth, address, parent details, and contact information.
3. **Open the target form** — Playwright loads the web form in a visible browser session.
4. **Scan and map fields** — The application discovers text inputs, selects, radio buttons, checkboxes, and other supported controls, then maps them to extracted facts.
5. **Ask for clarification** — If information is missing or ambiguous, AutoFiller asks the user instead of guessing.
6. **Fill the form** — Approved values are entered through controlled, policy-checked browser actions.
7. **Verify the result** — The application re-reads the form values and compares them with the extracted source data.
8. **Review and submit manually** — The workflow stops so the user can make the final decision.

## Key Features

- PDF and image document extraction.
- AI-assisted semantic mapping between document facts and form fields.
- Visible Playwright browser automation.
- Support for text inputs, number fields, emails, phone numbers, dates, selects, radio groups, checkboxes, and textareas.
- Human-in-the-loop clarification for uncertain values.
- Field-level verification before review.
- Pause, resume, stop, and user-takeover controls.
- Strict protection against final form submission by the automation agent.
- Navigation and tool permission policies.
- Authenticated FastAPI backend.
- Encrypted API-key and token storage where supported.
- MongoDB persistence with an in-memory fallback for development.
- Backend, policy, scanner, and end-to-end tests.

## Technology Stack

| Layer | Technology |
|---|---|
| Desktop application | Electron |
| Frontend | React, TypeScript, Vite, Vanilla CSS |
| Browser automation | Playwright, Chromium |
| Backend | Python, FastAPI, Uvicorn, Pydantic |
| AI processing | Google Gemini via the Google GenAI SDK |
| Document parsing | PyMuPDF |
| Database | MongoDB via Motor, with in-memory fallback |
| Packaging | electron-builder |

## Project Structure

```text
autofiller/
├── backend/                  # FastAPI backend and AI services
│   ├── commons/              # Authentication and shared utilities
│   ├── core/                 # APIs, models, controllers, services, and database code
│   ├── scripts/              # Backend validation scripts
│   └── tests/                # Backend tests
├── desktop/                  # Electron and React desktop application
│   ├── electron/             # Main process, agent, browser, IPC, and policy code
│   ├── src/                  # React renderer and UI features
│   ├── public/               # Demo form and sample documents
│   └── tests/                # Desktop and integration tests
├── AGENTS.md                 # Engineering and contribution guidelines
└── progress.md               # Detailed development progress report
```

## Getting Started

### Prerequisites

- Node.js 18 or later
- Python 3.11 or later
- A Google Gemini API key
- Windows is currently the primary development environment

### Set up the backend

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
```

Configure the required Gemini credentials and backend environment variables, then start the FastAPI backend using the project's backend entry point.

### Set up the desktop application

```powershell
cd desktop
npm install
npm run dev
```

To run the Electron application:

```powershell
npm run electron
```

The repository also includes `start.ps1` and `start.bat` launchers for starting the backend and desktop application together.

## Testing

Run the backend tests:

```powershell
.\venv\Scripts\python.exe -m pytest backend/tests/test_backend.py
```

Run the desktop build and test suite:

```powershell
cd desktop
npm run test
```

The test coverage includes authentication, document extraction, field mapping, clarification handling, policy enforcement, form scanning, tool execution, and end-to-end integration.

## Safety and Privacy

AutoFiller AI is designed to assist users, not replace their judgment:

- The agent never submits the final form automatically.
- Submit, register, apply, and finish controls are blocked by the policy engine.
- Ambiguous fields trigger clarification instead of automatic guessing.
- Browser automation runs visibly so the operator can monitor it.
- Protected backend routes require authentication.
- API keys are encrypted or masked and are not exposed in normal responses.
- Document access is restricted to approved locations and file-size limits.
- Renderer access to privileged Electron capabilities is restricted through a typed preload bridge.

## Current Status

The current implementation supports the core workflow:

> Document extraction → form scanning → field mapping → controlled filling → verification → `REVIEW_READY`

Planned improvements include multi-page form navigation, broader image-document support, packaged distribution, production MongoDB deployment, session history, multi-document workflows, and additional form-control compatibility.

## License

This project is currently under development. Add the project's chosen license before distributing it publicly.
