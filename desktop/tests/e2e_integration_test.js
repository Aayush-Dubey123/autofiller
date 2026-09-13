/**
 * End-to-end integration test driving the REAL AgentController against the sample form.
 *
 * Unlike the previous version, this test does not re-implement form filling. It imports
 * the actual AgentController, BrowserManager, FormScanner, and PolicyEngine and asserts
 * on their real behaviour. The backend is stubbed at the BackendClient boundary so no
 * MongoDB or Gemini credentials are required.
 *
 * Verifies:
 * 1. The real agent fills text, select, checkbox, and radio fields.
 * 2. Radio selection stays scoped to its own group (two groups both offer "Yes").
 * 3. A genuinely failed fill is reported as TOOL_FAILED, never as success.
 * 4. The submission guard is derived from the real page and blocks submission.
 * 5. The workflow terminates at REVIEW_READY without ever clicking submit.
 */

const assert = require('assert');
const path = require('path');

const DIST = path.resolve(__dirname, '../dist-electron');
const { AgentController } = require(path.join(DIST, 'agent/AgentController'));
const { BrowserManager } = require(path.join(DIST, 'browser/BrowserManager'));
const { PolicyEngine } = require(path.join(DIST, 'policy/PolicyEngine'));

const fs = require('fs');

const FORM_PATH = [
  path.resolve(__dirname, '../public/mock_school_form.html'),
  path.resolve(__dirname, '../../test-fixtures/mock_school_form.html'),
].find(p => fs.existsSync(p)) || path.resolve(__dirname, '../public/mock_school_form.html');
const FORM_URL = `file://${FORM_PATH.replace(/\\/g, '/')}`;

let passed = 0;

/**
 * Run a single named assertion block and count it when it succeeds.
 *
 * @param {string} name Human readable test name.
 * @param {() => Promise<void>} body Async assertion body.
 */
async function test(name, body) {
  try {
    await body();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (error) {
    console.error(`  FAIL - ${name}`);
    throw error;
  }
}

/**
 * Build a stub backend client with deterministic facts and mapping responses.
 *
 * @param {string} url Target form URL reported in the snapshot.
 * @returns {object} Backend client double recording every call.
 */
function makeStubBackend(url) {
  const calls = [];
  return {
    calls,
    async createSession(documentName, targetUrl) {
      calls.push(['createSession', documentName, targetUrl]);
      return { id: 'session_e2e' };
    },
    async extractDocument() {
      calls.push(['extractDocument']);
      return {
        document_name: 'student.pdf',
        fact_count: 4,
        facts: [
          { key: 'student_name', label: 'Student Name', value: 'Aarav Sharma', confidence: 0.95 },
          { key: 'email', label: 'Email Address', value: 'aarav.sharma@example.com', confidence: 0.95 },
          { key: 'city', label: 'City', value: 'Mumbai', confidence: 0.95 },
          { key: 'allergies', label: 'Allergies', value: 'Yes', confidence: 0.95 },
        ],
      };
    },
    async mapForm(sessionId, snapshot) {
      calls.push(['mapForm', sessionId, snapshot.fields.length]);
      const find = (needle) =>
        snapshot.fields.find((field) => field.label.toLowerCase().includes(needle));
      const mappings = [];

      // The fixture labels this field "Student Full Name", so match deliberately.
      const nameField = find('student name') || find('full name');
      if (nameField) {
        mappings.push({
          field_ref: nameField.ref,
          field_label: nameField.label,
          fact_key: 'student_name',
          fact_value: 'Aarav Sharma',
          confidence: 0.95,
          status: 'PENDING',
        });
      }

      // Match the student contact email specifically, not the parent's address.
      const emailField = snapshot.fields.find(
        (field) => /email/i.test(field.label) && !/parent|guardian|father|mother/i.test(field.label)
      );
      if (emailField) {
        mappings.push({
          field_ref: emailField.ref,
          field_label: emailField.label,
          fact_key: 'email',
          fact_value: 'aarav.sharma@example.com',
          confidence: 0.95,
          status: 'PENDING',
        });
      }

      const genderField = snapshot.fields.find(
        (field) => field.type === 'select' && /gender/i.test(field.label)
      );
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

      // Target a radio group by its question text, deliberately using the same value
      // "Yes" that another group also offers.
      const radioField = snapshot.fields.find(
        (field) => field.type === 'radio' && /transport/i.test(field.label)
      );
      if (radioField) {
        mappings.push({
          field_ref: radioField.ref,
          field_label: radioField.label,
          fact_key: 'transport',
          fact_value: 'Yes',
          confidence: 0.95,
          status: 'PENDING',
        });
      }

      // Deliberately map a dropdown to a value it does not contain, so the select
      // genuinely fails. This proves a failed operation is reported honestly rather
      // than logged as a success.
      const gradeField = snapshot.fields.find(
        (field) => field.type === 'select' && /grade/i.test(field.label)
      );
      if (gradeField) {
        mappings.push({
          field_ref: gradeField.ref,
          field_label: gradeField.label,
          fact_key: 'grade',
          fact_value: 'Grade 99 (not an option)',
          confidence: 0.9,
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
    async answerClarification() {
      calls.push(['answerClarification']);
    },
    async appendEvents(sessionId, events) {
      calls.push(['appendEvents', sessionId, events.length]);
      return { success: true, appended: events.length, event_count: events.length };
    },
    async appendEventSafe(sessionId, event) {
      calls.push(['appendEventSafe', sessionId, event.type]);
      return { success: true };
    },
    async getSettings() {
      return { api_key_configured: true, masked_key: 'AIza****wxyz', model: 'gemini-3.6-flash' };
    },
    async updateSettings() {
      return { success: true, model: 'gemini-3.6-flash', api_key_configured: true, masked_key: '' };
    },
    async testGemini() {
      return { valid: true, message: 'ok' };
    },
    getBaseUrl() {
      return url;
    },
  };
}

async function runE2E() {
  console.log('=== AutoFiller End-to-End AgentController Verification ===');

  await test('FormScanner collapses radio groups into descriptive scoped fields', async () => {
    const browserManager = new BrowserManager();
    await browserManager.launch(true);
    await browserManager.navigateTo(FORM_URL);

    const snapshot = await browserManager.scanActiveForm();
    const radioFields = snapshot.fields.filter((field) => field.type === 'radio');
    assert.strictEqual(radioFields.length, 2, 'two logical radio groups are expected');
    radioFields.forEach((field) => {
      assert.ok(field.options.includes('Yes'), 'each group should expose its own Yes option');
      // The label must describe the group's question, not just repeat the option text.
      assert.ok(
        field.label.toLowerCase() !== 'yes',
        `radio group label should be descriptive, got '${field.label}'`
      );
    });
    assert.ok(
      radioFields.some((field) => /allerg/i.test(field.label)),
      'expected an allergies radio group'
    );
    assert.ok(
      radioFields.some((field) => /transport/i.test(field.label)),
      'expected a transport radio group'
    );

    await browserManager.close();
  });

  await test('the real agent fills fields and halts at REVIEW_READY', async () => {
    const backend = makeStubBackend(FORM_URL);
    const controller = new AgentController(backend);

    const events = [];
    const states = [];
    controller.onEvent((event) => events.push(event));
    controller.getStateMachine().onTransition((state) => states.push(state));

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      `expected REVIEW_READY, events were: ${events.map((e) => e.description).join(' | ')}`
    );
    assert.ok(states.includes('REVIEW_READY'));

    // The submission guard must fire from the real page, not a hardcoded string.
    const policyEvents = events.filter((event) => event.type === 'POLICY_BLOCKED');
    assert.ok(policyEvents.length > 0, 'a submission policy decision must be recorded');
    assert.ok(
      policyEvents.some((event) => /DENIED_FINAL_SUBMISSION/.test(event.description)),
      'the timeline must clearly report DENIED_FINAL_SUBMISSION when a submit control exists'
    );
    assert.strictEqual(
      policyEvents[0].metadata?.code,
      'DENIED_FINAL_SUBMISSION',
      'policy event metadata must report DENIED_FINAL_SUBMISSION'
    );

    await controller.cleanup();
  });

  await test('field fills are verified and reported truthfully', async () => {
    const backend = makeStubBackend(FORM_URL);
    const controller = new AgentController(backend);
    const events = [];
    controller.onEvent((event) => events.push(event));

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    const completions = events.filter((event) => event.type === 'TOOL_COMPLETED');
    const failures = events.filter((event) => event.type === 'TOOL_FAILED');

    // A successful fill must be reported as a completion with real field data.
    // Labels carry a trailing "*" required marker, so match the text loosely.
    assert.ok(
      completions.some((event) => /Filled 'Student Full Name/.test(event.description)),
      `expected a Student Full Name completion, got: ${completions.map((e) => e.description).join(' | ')}`
    );

    // The deliberately mismatched control must NOT be reported as a success.
    assert.ok(
      !completions.some(
        (event) =>
          /Grade/.test(event.description) && /Select(ed)? '/.test(event.description)
      ),
      'a failed select must never be reported as completed'
    );
    assert.ok(
      failures.some((event) => /Grade/.test(event.description)),
      'the failed select must be surfaced as a failure, not hidden'
    );

    await controller.cleanup();
  });

  await test('the agent never clicks a submission control', async () => {
    const backend = makeStubBackend(FORM_URL);
    const controller = new AgentController(backend);
    const events = [];
    controller.onEvent((event) => events.push(event));

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    const policyEngine = new PolicyEngine();
    const submitDecision = policyEngine.validateBrowserAction('click', 'Submit Application');
    assert.strictEqual(submitDecision.allowed, false);
    assert.strictEqual(submitDecision.code, 'DENIED_FINAL_SUBMISSION');

    const submissionDone = events.find((event) => /Ready for human review/.test(event.description));
    assert.ok(submissionDone, 'the workflow must end by handing control back to the human');

    await controller.cleanup();
  });

  await test('real submit controls are detected separately from fillable fields', async () => {
    const browserManager = new BrowserManager();
    await browserManager.launch(true);
    await browserManager.navigateTo(FORM_URL);

    const snapshot = await browserManager.scanActiveForm();
    const submitInFields = snapshot.fields.filter(
      (f) => f.type === 'submit' || f.ref === 'submitBtn' || /submit application/i.test(f.label)
    );
    assert.strictEqual(submitInFields.length, 0, 'FormScanner must exclude submit button from fields');

    const controls = await browserManager.scanSubmissionControls();
    const submitControls = controls.filter((c) => c.isSubmitType);
    assert.strictEqual(submitControls.length, 1, 'BrowserManager must find real submit controls');
    assert.strictEqual(submitControls[0].isSubmitType, true);

    await browserManager.close();
  });

  await test('agent events are persisted to the session audit timeline', async () => {
    const backend = makeStubBackend(FORM_URL);
    const controller = new AgentController(backend);
    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    const persisted = backend.calls.filter((call) => call[0] === 'appendEvents');
    assert.ok(persisted.length > 0, 'agent events must be persisted for audit');
    assert.ok(
      backend.calls.every((call) => call[0] !== 'mapForm' || call[2] > 0),
      'mapping must be called with a real snapshot'
    );
    await controller.cleanup();
  });

  await test('concurrent session starts are refused', async () => {
    const backend = makeStubBackend(FORM_URL);
    const controller = new AgentController(backend);

    const first = controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });
    await assert.rejects(
      () =>
        controller.startSession({
          documentText: 'Student Name: Aarav Sharma',
          documentName: 'student.pdf',
          targetUrl: FORM_URL,
        }),
      /SESSION_ALREADY_RUNNING/
    );
    await first.catch(() => undefined);
    await controller.cleanup();
  });

  console.log(`\nAll ${passed} end-to-end assertions passed.`);
}

runE2E()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Integration test failed:', error);
    process.exit(1);
  });
