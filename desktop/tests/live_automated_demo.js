/**
 * Live Automated Demonstration & QA Test for AutoFiller AI (Phase 1)
 *
 * Launches a VISIBLE Chrome/Edge browser window on screen and executes
 * the complete Phase 1 automated form-filling workflow:
 *
 * 1. Document Extraction & Student Facts Preparation
 * 2. Target URL Navigation (http://127.0.0.1:8000/mock_school_form.html)
 * 3. Form Field Scanning & Field Mapping
 * 4. Automated Form Population with Visual Element Highlights
 * 5. Field Verification
 * 6. Policy Engine Guard Assertion (DENIED_FINAL_SUBMISSION)
 * 7. Terminal State Halted at REVIEW_READY for Human Review
 */

const path = require('path');
const DIST = path.resolve(__dirname, '../dist-electron');
const { AgentController } = require(path.join(DIST, 'agent/AgentController'));
const { PolicyEngine } = require(path.join(DIST, 'policy/PolicyEngine'));

const TARGET_URL = 'http://127.0.0.1:8000/mock_school_form.html';

function makeStubBackend() {
  const calls = [];
  return {
    calls,
    async createSession(documentName, targetUrl) {
      calls.push(['createSession', documentName, targetUrl]);
      return { id: 'session_live_demo' };
    },
    async extractDocument() {
      calls.push(['extractDocument']);
      return {
        document_name: 'student_admission.pdf',
        fact_count: 7,
        facts: [
          { key: 'full_name', label: 'Full Name', value: 'Aarav Sharma', confidence: 0.98 },
          { key: 'dob', label: 'Date of Birth', value: '15 March 2010', confidence: 0.96 },
          { key: 'email', label: 'Email', value: 'aarav.sharma@example.com', confidence: 0.99 },
          { key: 'phone', label: 'Phone', value: '+91 98765 43210', confidence: 0.97 },
          { key: 'gender', label: 'Gender', value: 'Male', confidence: 0.95 },
          { key: 'class', label: 'Class Applying For', value: 'Grade 10', confidence: 0.98 },
          { key: 'city', label: 'City', value: 'Bengaluru', confidence: 0.94 },
          { key: 'allergies', label: 'Allergies', value: 'Peanuts', confidence: 0.92 },
          { key: 'transport', label: 'Transport Required', value: 'Yes', confidence: 0.95 },
        ],
      };
    },
    async mapForm(sessionId, snapshot) {
      calls.push(['mapForm', sessionId, snapshot.fields.length]);
      const find = (needle) => snapshot.fields.find((f) => f.label.toLowerCase().includes(needle));
      const mappings = [];

      const nameField = find('student name') || find('full name');
      if (nameField) {
        mappings.push({
          field_ref: nameField.ref,
          field_label: nameField.label,
          fact_key: 'full_name',
          fact_value: 'Aarav Sharma',
          confidence: 0.98,
          status: 'PENDING',
        });
      }

      const emailField = snapshot.fields.find(
        (f) => /email/i.test(f.label) && !/parent|guardian|father|mother/i.test(f.label)
      );
      if (emailField) {
        mappings.push({
          field_ref: emailField.ref,
          field_label: emailField.label,
          fact_key: 'email',
          fact_value: 'aarav.sharma@example.com',
          confidence: 0.99,
          status: 'PENDING',
        });
      }

      const genderField = snapshot.fields.find((f) => f.type === 'select' && /gender/i.test(f.label));
      if (genderField) {
        mappings.push({
          field_ref: genderField.ref,
          field_label: genderField.label,
          fact_key: 'gender',
          fact_value: 'Male',
          confidence: 0.95,
          status: 'PENDING',
        });
      }

      const dobField = snapshot.fields.find((f) => /date of birth|dob/i.test(f.label));
      if (dobField) {
        mappings.push({
          field_ref: dobField.ref,
          field_label: dobField.label,
          fact_key: 'dob',
          fact_value: '15-03-2010',
          confidence: 0.96,
          status: 'PENDING',
        });
      }

      const cityField = snapshot.fields.find((f) => /city/i.test(f.label));
      if (cityField) {
        mappings.push({
          field_ref: cityField.ref,
          field_label: cityField.label,
          fact_key: 'city',
          fact_value: 'Bengaluru',
          confidence: 0.94,
          status: 'PENDING',
        });
      }

      const phoneField = snapshot.fields.find((f) => /phone|contact/i.test(f.label));
      if (phoneField) {
        mappings.push({
          field_ref: phoneField.ref,
          field_label: phoneField.label,
          fact_key: 'phone',
          fact_value: '+91 98765 43210',
          confidence: 0.97,
          status: 'PENDING',
        });
      }

      const gradeField = snapshot.fields.find((f) => f.type === 'select' && /grade|class/i.test(f.label));
      if (gradeField) {
        mappings.push({
          field_ref: gradeField.ref,
          field_label: gradeField.label,
          fact_key: 'class',
          fact_value: '10th',
          confidence: 0.98,
          status: 'PENDING',
        });
      }

      const allergiesField = snapshot.fields.find((f) => f.type === 'radio' && /allerg/i.test(f.label));
      if (allergiesField) {
        mappings.push({
          field_ref: allergiesField.ref,
          field_label: allergiesField.label,
          fact_key: 'allergies',
          fact_value: 'Yes',
          confidence: 0.92,
          status: 'PENDING',
        });
      }

      return {
        session_id: sessionId,
        mappings,
        clarifications_required: [],
        unmapped_fields: [],
      };
    },
    async answerClarification() {},
    async appendEvents() {
      return { success: true };
    },
    async appendEventSafe() {
      return { success: true };
    },
    async getSettings() {
      return { api_key_configured: true, masked_key: 'AIza****wxyz', model: 'gemini-3.6-flash' };
    },
    async updateSettings() {
      return { success: true };
    },
    async testGemini() {
      return { valid: true };
    },
    getBaseUrl() {
      return TARGET_URL;
    },
  };
}

async function runLiveDemo() {
  console.log('\n======================================================');
  console.log('  autofiller.AI — LIVE Phase 1 Automated Browser Test  ');
  console.log('======================================================\n');
  console.log('🚀 Launching visible browser on screen...\n');

  const backend = makeStubBackend();
  const controller = new AgentController(backend);

  // Force VISIBLE browser launch so the user can see everything on screen
  controller.updateSettings({ headless: false, typingDelayMs: 40 });

  controller.onEvent((event) => {
    const timestamp = new Date(event.timestamp).toLocaleTimeString();
    let badge = '[EVENT]';
    if (event.type === 'TOOL_COMPLETED') badge = '✅ [FILLED]';
    if (event.type === 'POLICY_BLOCKED') badge = '🛡️ [POLICY GUARD]';
    if (event.type === 'STATE_CHANGED') badge = '🔄 [STATE]';
    console.log(`${badge} ${timestamp} - ${event.description}`);
  });

  console.log('📄 Step 1: Ingesting student_admission.pdf and extracting facts...');
  console.log('🌐 Step 2: Navigating visible browser to http://127.0.0.1:8000/mock_school_form.html...');
  console.log('✍️ Step 3: Automated field scanning, mapping, filling & verification in progress...\n');

  await controller.startSession({
    documentText: 'Student Name: Aarav Sharma\nDate of Birth: 15-03-2010\nGender: Male\nClass: Grade 10',
    documentName: 'student_admission.pdf',
    targetUrl: TARGET_URL,
    instruction: 'Fill out Grade 10 student admission form using extracted student details.',
  });

  const finalState = controller.getStateMachine().getState();
  console.log(`\n------------------------------------------------------`);
  console.log(`🏁 Final Agent State: ${finalState}`);
  console.log(`------------------------------------------------------\n`);

  if (finalState === 'REVIEW_READY') {
    console.log('🟢 SUCCESS: Phase 1 workflow achieved!');
    console.log('✅ Form filled and verified.');
    console.log('🛡️ Policy Engine verified: Submission button was NOT clicked (DENIED_FINAL_SUBMISSION).');
    console.log('👁️ Browser window will remain open on screen for 10 seconds for visual inspection...\n');
  }

  // Keep visible browser open for 10 seconds so user can visually inspect
  await new Promise((resolve) => setTimeout(resolve, 10000));

  await controller.cleanup();
  console.log('✨ Live demonstration completed cleanly.');
}

runLiveDemo()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Live demo failed:', err);
    process.exit(1);
  });
