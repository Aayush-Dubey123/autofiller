# AutoFiller AI 🤖📋
> **Document-Based Form Filling Using an AI Agent**

AutoFiller AI is an intelligent Electron desktop application that automates the tedious, repetitive process of filling web-based school registration and admission forms using data extracted directly from user-uploaded documents (PDFs, images, Word docs, etc.).

---

## 📌 Problem Statement

Schools maintain student information across various formats including PDF files, Excel sheets, Word documents, and physical records. To enter this data into school management portals, staff must manually read documents and copy details into form fields—a repetitive, time-consuming process prone to human error.

### 🎯 Solution Overview
AutoFiller AI empowers school staff to upload student admission documents, specify a target form URL, and issue a simple prompt (e.g., *"Read this document and fill out the student registration form"*). The application automatically extracts relevant details, opens a visible browser, accurately fills form inputs (text fields, dropdowns, radio options, checkboxes), verifies entered data against source documents, and pauses at the final review step for user verification.

---

## ✨ Key Capabilities (Phase One Scope)

- 📄 **Intelligent Document Extraction**: Automatically parses uploaded student records (PDFs, text, images) using Gemini AI to extract structured facts (Student Name, DOB, Parent Details, Address, Phone, etc.).
- 🌐 **Visible Web Automation**: Launches a dedicated Playwright browser instance, navigating to the target registration portal while allowing the user to watch, pause, or interact at any time.
- 🎯 **Smart Field Matching**: Maps extracted document facts to form controls—including text inputs, select dropdowns, radio groups, and checkboxes—with semantic context matching.
- 🔍 **Automated Verification**: Re-scans filled form inputs to confirm that entered values match source document data before user review.
- ❓ **Human-in-the-Loop Clarification**: Prompts the user explicitly when information is missing, ambiguous, or conflicting instead of guessing.
- 🛡️ **Phase-One Safety Boundary**: Automatically halts at the final **Review Ready** stage. **Form submission and destructive actions are strictly guarded**, leaving final submission approval safely in the hands of the user.

---

## 🏗️ Architecture & Technology Stack

- **Desktop UI & Agent Host**: Electron 34, React 19, TypeScript, Vite, Playwright browser integration.
- **AI Backend Engine**: Python 3.13, FastAPI, Pydantic v2, Google Gemini AI (for document parsing & field mapping).
- **Security & Governance**: Dual-token authentication bridge, strict origin navigation policies, and non-submitting form control safety rules.

---

## 🚀 Quick Start & Installation

### Prerequisites
- **Node.js**: v18+ and `npm`
- **Python**: v3.11+ with `venv`
- **Gemini API Key**: Set `GEMINI_API_KEY` in environment or configure via in-app Settings modal.

### Setup & Launch

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Aayush-Dubey123/autofiller.git
   cd autofiller
   ```

2. **Initialize Python Environment**:
   ```bash
   python -m venv venv
   .\venv\Scripts\activate
   pip install -r backend/requirements.txt
   ```

3. **Initialize Desktop Dependencies**:
   ```bash
   cd desktop
   npm install
   cd ..
   ```

4. **Launch Application**:
   Run the all-in-one launcher script:
   ```powershell
   .\start.ps1
   ```
   *(For Command Prompt, run `start.bat`)*

---

## 🧪 Running Tests

- **Backend Unit Tests**:
  ```bash
  .\venv\Scripts\python.exe -m pytest backend/tests/test_backend.py
  ```
- **Desktop E2E & Policy Tests**:
  ```bash
  cd desktop && npm run test
  ```
- **Live Security Verification**:
  ```bash
  .\venv\Scripts\python.exe verify_security_live.py
  ```

---

## 📄 License
MIT License. Developed for automated document-to-form workflow intelligence.
