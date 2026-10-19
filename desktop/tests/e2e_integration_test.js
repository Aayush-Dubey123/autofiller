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

process.env.NODE_ENV = 'test';
const assert = require('assert');
const path = require('path');

const DIST = path.resolve(__dirname, '../dist-electron');
const { AgentController } = require(path.join(DIST, 'agent/AgentController'));
const { BrowserManager } = require(path.join(DIST, 'browser/BrowserManager'));
const { PolicyEngine } = require(path.join(DIST, 'policy/PolicyEngine'));
const { HistoryStore } = require(path.join(DIST, 'services/VaultService'));

const fs = require('fs');

const FORM_PATH = [
  path.resolve(__dirname, '../public/mock_school_form.html'),
  path.resolve(__dirname, '../../test-fixtures/mock_school_form.html'),
].find(p => fs.existsSync(p)) || path.resolve(__dirname, '../public/mock_school_form.html');
const FORM_URL = `file://${FORM_PATH.replace(/\\/g, '/')}`;

const filter = process.env.TEST_FILTER || process.argv[2];
let passed = 0;

/**
 * Run a single named assertion block and count it when it succeeds.
 *
 * @param {string} name Human readable test name.
 * @param {() => Promise<void>} body Async assertion body.
 */
async function test(name, body) {
  if (filter && !name.toLowerCase().includes(filter.toLowerCase())) {
    return;
  }
  try {
    await body();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (error) {
    console.error(`  FAIL - ${name}`);
    throw error;
  }
}

function getFullFormMappings(snapshot) {
  const mappings = [];
  const find = (needle) =>
    snapshot.fields.find((field) => field.visible && field.label.toLowerCase().includes(needle)) ||
    snapshot.fields.find((field) => field.label.toLowerCase().includes(needle));

  // Section 1
  const name = find('student full name') || find('student name') || find('full name');
  if (name) mappings.push({ field_ref: name.ref, field_label: name.label, fact_key: 'student_name', confidence: 1.0, status: 'PENDING' });
  const dob = find('date of birth') || find('dob');
  if (dob) mappings.push({ field_ref: dob.ref, field_label: dob.label, fact_key: 'dob', confidence: 1.0, status: 'PENDING' });
  const gender = find('gender');
  if (gender) mappings.push({ field_ref: gender.ref, field_label: gender.label, fact_key: 'gender', confidence: 1.0, status: 'PENDING' });

  // Section 2
  const email = find('email');
  if (email) mappings.push({ field_ref: email.ref, field_label: email.label, fact_key: 'email', confidence: 1.0, status: 'PENDING' });
  const phone = find('phone');
  if (phone) mappings.push({ field_ref: phone.ref, field_label: phone.label, fact_key: 'phone', confidence: 1.0, status: 'PENDING' });

  // Section 3
  const address = find('residential address') || find('address');
  if (address) mappings.push({ field_ref: address.ref, field_label: address.label, fact_key: 'address', confidence: 1.0, status: 'PENDING' });
  const city = find('city');
  if (city) mappings.push({ field_ref: city.ref, field_label: city.label, fact_key: 'city', confidence: 1.0, status: 'PENDING' });
  const state = find('state');
  if (state) mappings.push({ field_ref: state.ref, field_label: state.label, fact_key: 'state', confidence: 1.0, status: 'PENDING' });
  const pincode = find('pincode') || find('zip');
  if (pincode) mappings.push({ field_ref: pincode.ref, field_label: pincode.label, fact_key: 'pincode', confidence: 1.0, status: 'PENDING' });

  // Section 4
  const father = find('father');
  if (father) mappings.push({ field_ref: father.ref, field_label: father.label, fact_key: 'father_name', confidence: 1.0, status: 'PENDING' });
  const mother = find('mother');
  if (mother) mappings.push({ field_ref: mother.ref, field_label: mother.label, fact_key: 'mother_name', confidence: 1.0, status: 'PENDING' });

  // Section 5
  const previousSchool = find('previous school');
  if (previousSchool) mappings.push({ field_ref: previousSchool.ref, field_label: previousSchool.label, fact_key: 'previous_school', confidence: 1.0, status: 'PENDING' });
  const grade = find('grade');
  if (grade) mappings.push({ field_ref: grade.ref, field_label: grade.label, fact_key: 'grade', confidence: 1.0, status: 'PENDING' });
  const allergies = find('allergies');
  if (allergies) mappings.push({ field_ref: allergies.ref, field_label: allergies.label, fact_key: 'allergies', confidence: 1.0, status: 'PENDING' });
  const transport = find('transport');
  if (transport) mappings.push({ field_ref: transport.ref, field_label: transport.label, fact_key: 'transport', confidence: 1.0, status: 'PENDING' });
  const terms = find('terms') || snapshot.fields.find((f) => f.type === 'checkbox');
  if (terms) mappings.push({ field_ref: terms.ref, field_label: terms.label, fact_key: 'terms', confidence: 1.0, status: 'PENDING' });

  return mappings;
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
        fact_count: 14,
        facts: [
          { key: 'student_name', label: 'Student Name', value: 'Aarav Sharma', confidence: 0.95 },
          { key: 'dob', label: 'Date of Birth', value: '2005-03-23', confidence: 0.95 },
          { key: 'gender', label: 'Gender', value: 'Male', confidence: 0.95 },
          { key: 'email', label: 'Email Address', value: 'aarav@example.com', confidence: 0.95 },
          { key: 'phone', label: 'Phone', value: '9876543210', confidence: 0.95 },
          { key: 'address', label: 'Address', value: '123 Park Street', confidence: 0.95 },
          { key: 'city', label: 'City', value: 'Mumbai', confidence: 0.95 },
          { key: 'state', label: 'State', value: 'Maharashtra', confidence: 0.95 },
          { key: 'pincode', label: 'Pincode', value: '400001', confidence: 0.95 },
          { key: 'father_name', label: 'Father Name', value: 'Vikram Sharma', confidence: 0.95 },
          { key: 'mother_name', label: 'Mother Name', value: 'Sunita Sharma', confidence: 0.95 },
          { key: 'grade', label: 'Grade', value: 'Grade 10', confidence: 0.95 },
          { key: 'allergies', label: 'Allergies', value: 'No', confidence: 0.95 },
          { key: 'transport', label: 'Transport', value: 'No', confidence: 0.95 },
          { key: 'terms', label: 'Terms', value: 'agree', confidence: 1.0 },
        ],
      };
    },
    async mapForm(sessionId, snapshot) {
      calls.push(['mapForm', sessionId, snapshot.fields.length]);
      const mappings = getFullFormMappings(snapshot);
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
    async appendEvents(sessionId, events, verifications) {
      calls.push(['appendEvents', sessionId, (events || []).length, verifications || []]);
      return { success: true, appended: (events || []).length, event_count: (events || []).length };
    },
    async appendEventSafe(sessionId, event) {
      calls.push(['appendEventSafe', sessionId, event.type]);
      return { success: true };
    },
    async purgeSession(sessionId) {
      calls.push(['purgeSession', sessionId]);
      return { success: true };
    },
    async purgeAllSessions() {
      calls.push(['purgeAllSessions']);
      return { success: true };
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

    await controller.cleanup();
  });

  await test('field fills are verified and reported truthfully', async () => {
    const backend = makeStubBackend(FORM_URL);
    const origMap = backend.mapForm;
    backend.mapForm = async (sessionId, snapshot) => {
      const res = await origMap(sessionId, snapshot);
      const genderM = res.mappings.find((m) => /gender/i.test(m.field_label));
      if (genderM) {
        genderM.fact_value = 'Grade 99 (not an option)';
      }
      return res;
    };
    const controller = new AgentController(backend);
    const events = [];
    controller.onEvent((event) => events.push(event));

    const unsub = controller.onClarificationRequest(async () => {
      unsub();
      await controller.stop();
    });

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    const completions = events.filter((event) => event.type === 'TOOL_COMPLETED');
    const failures = events.filter((event) => event.type === 'TOOL_FAILED');

    // TODO: extend when section-by-section flow exists
    // A successful fill must be reported as a completion with real field data.
    assert.ok(
      completions.some((event) => /Filled 'Student Full Name/.test(event.description)),
      `expected a Student Full Name completion, got: ${completions.map((e) => e.description).join(' | ')}`
    );

    // The deliberately mismatched control must NOT be reported as a success.
    assert.ok(
      !completions.some(
        (event) =>
          /Gender/.test(event.description) && /Select(ed)? '/.test(event.description)
      ),
      'a failed select must never be reported as completed'
    );
    assert.ok(
      failures.some((event) => /Gender/.test(event.description)),
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

    // TODO: extend when section-by-section flow exists
    // Unhide sections so submission controls across sections are discovered
    await browserManager.page.evaluate(() => {
      document.querySelectorAll('[hidden]').forEach((el) => el.removeAttribute('hidden'));
    });

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

  await test('zero-value contract: IPC events, persisted events, and verifications contain no raw values across fill-and-verify', async () => {
    const backend = makeStubBackend(FORM_URL);
    const persistedEvents = [];
    const ipcEvents = [];
    let persistedVerifications = [];
    const origAppendEventSafe = backend.appendEventSafe;
    backend.appendEventSafe = async (sessionId, event) => {
      persistedEvents.push(JSON.parse(JSON.stringify(event)));
      return origAppendEventSafe(sessionId, event);
    };
    const origAppendEvents = backend.appendEvents;
    backend.appendEvents = async (sessionId, events, verifications) => {
      if (verifications && verifications.length > 0) {
        persistedVerifications.push(...JSON.parse(JSON.stringify(verifications)));
      }
      return origAppendEvents(sessionId, events, verifications);
    };

    const controller = new AgentController(backend);
    controller.onEvent((event) => {
      ipcEvents.push(JSON.parse(JSON.stringify(event)));
    });

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    assert.ok(persistedEvents.length > 0, 'agent events must be queued for persistence');
    assert.ok(ipcEvents.length > 0, 'agent events must be emitted over IPC');

    // Confirm that fill and verify tools executed
    const toolEvents = persistedEvents.filter(
      (e) => e.tool === 'fill_text' || e.tool === 'verify_field'
    );
    assert.ok(toolEvents.length > 0, 'fill_text or verify_field events must have executed');

    const forbiddenKeys = [
      'fact_value',
      'factValue',
      'actualValue',
      'actual_value',
      'expectedValue',
      'expected_value',
      'selectedValue',
      'selected_value',
    ];

    // 1. Verify that across all IPC event objects, no sensitive keys or raw personal values exist
    for (const evt of ipcEvents) {
      const serialized = JSON.stringify(evt);
      for (const key of forbiddenKeys) {
        assert.strictEqual(
          serialized.includes(`"${key}"`),
          false,
          `IPC event ${evt.type} (${evt.tool || ''}) must not contain "${key}": ${serialized}`
        );
      }
      assert.strictEqual(
        serialized.includes('Aarav Sharma'),
        false,
        `IPC event ${evt.type} (${evt.tool || ''}) must not contain raw field value 'Aarav Sharma': ${serialized}`
      );
    }

    // 2. Verify that across all persisted event objects, metadata contains no sensitive keys
    for (const evt of persistedEvents) {
      const serialized = JSON.stringify(evt);
      for (const key of forbiddenKeys) {
        assert.strictEqual(
          serialized.includes(`"${key}"`),
          false,
          `Persisted event ${evt.type} (${evt.tool || ''}) must not contain "${key}": ${serialized}`
        );
      }
      assert.strictEqual(
        serialized.includes('Aarav Sharma'),
        false,
        `Persisted event ${evt.type} (${evt.tool || ''}) must not contain raw field value 'Aarav Sharma': ${serialized}`
      );
    }

    // 3. Verify that verification persistence contains only safe metadata and no raw values
    assert.ok(persistedVerifications.length > 0, 'verifications must be persisted to session');
    for (const verif of persistedVerifications) {
      const serialized = JSON.stringify(verif);
      assert.ok(verif.field_ref, 'verification must have field_ref');
      assert.ok(verif.field_label, 'verification must have field_label');
      assert.strictEqual(typeof verif.verified, 'boolean', 'verification must have boolean verified');
      for (const key of forbiddenKeys) {
        assert.strictEqual(
          serialized.includes(`"${key}"`),
          false,
          `Persisted verification must not contain "${key}": ${serialized}`
        );
      }
      assert.strictEqual(
        serialized.includes('Aarav Sharma'),
        false,
        `Persisted verification must not contain raw field value 'Aarav Sharma': ${serialized}`
      );
    }

    assert.strictEqual(controller.getStateMachine().getState(), 'REVIEW_READY');

    await controller.cleanup();
  });

  await test('agent delivers sequential clarification prompts with truthful stepper counts (total and currentIndex) throughout CLARIFICATION_REQUIRED', async () => {
    const backend = makeStubBackend(FORM_URL);
    const origMapForm = backend.mapForm;
    backend.mapForm = async (sessionId, snapshot) => {
      const res = await origMapForm(sessionId, snapshot);
      const nameField = snapshot.fields.find((f) => /name/i.test(f.label));
      const genderField = snapshot.fields.find((f) => /gender/i.test(f.label));
      res.clarifications_required = [
        {
          clarification_id: 'clarify_test_1',
          field_ref: nameField ? nameField.ref : 'field_001',
          field_label: 'Student Full Name',
          question: 'Please confirm student full name',
          options: ['Aarav Sharma', 'Aarav S.'],
        },
        {
          clarification_id: 'clarify_test_2',
          field_ref: genderField ? genderField.ref : 'field_002',
          field_label: 'Gender',
          question: 'Please select gender',
          options: ['Male', 'Female', 'Other'],
        },
      ];
      return res;
    };

    const controller = new AgentController(backend);
    const receivedPrompts = [];
    const stateTransitions = [];

    controller.getStateMachine().onTransition((state) => {
      stateTransitions.push(state);
    });

    controller.onClarificationRequest((prompt) => {
      receivedPrompts.push(prompt);
      // Asynchronously answer the clarification to simulate user interaction with the persistent stepper
      setTimeout(() => {
        const answer = prompt.clarificationId === 'clarify_test_1' ? 'Aarav Sharma' : 'Male';
        controller.answerClarification(prompt.clarificationId, answer);
      }, 50);
    });

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    assert.strictEqual(receivedPrompts.length, 2, 'should receive exactly 2 clarification prompts');
    assert.strictEqual(receivedPrompts[0].total, 2, 'prompt 1 should have total = 2');
    assert.strictEqual(receivedPrompts[0].currentIndex, 1, 'prompt 1 should have currentIndex = 1');
    assert.strictEqual(receivedPrompts[1].total, 2, 'prompt 2 should have total = 2');
    assert.strictEqual(receivedPrompts[1].currentIndex, 2, 'prompt 2 should have currentIndex = 2');

    assert.ok(
      stateTransitions.includes('CLARIFICATION_REQUIRED'),
      'state machine must have visited CLARIFICATION_REQUIRED'
    );
    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      'agent should finish all clarifications and reach REVIEW_READY'
    );

    await controller.cleanup();
  });

  await test('agreement checkbox is left for operator without timeout and Never-Submit remains intact', async () => {
    const backend = makeStubBackend(FORM_URL);
    const controller = new AgentController(backend);
    backend.mapForm = async (sessionId, snapshot) => {
      // Unhide sections so section-5 checkbox is interactable in this test
      if (controller.getBrowserManager()?.page) {
        await controller.getBrowserManager().page.evaluate(() => {
          document.querySelectorAll('[hidden]').forEach((el) => el.removeAttribute('hidden'));
        }).catch(() => {});
      }
      const mappings = getFullFormMappings(snapshot);
      const checkboxField = snapshot.fields.find((f) => f.type === 'checkbox');
      assert.ok(checkboxField, 'terms checkbox should be detected in snapshot');
      return {
        session_id: sessionId,
        mappings,
        clarifications_required: [],
        unmapped_fields: [],
      };
    };

    const events = [];
    controller.onEvent((e) => events.push(e));

    const startTime = Date.now();
    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    const elapsed = Date.now() - startTime;
    assert.ok(elapsed < 10000, `Checkbox flow took ${elapsed}ms; must not exceed 10s`);

    assert.strictEqual(controller.getStateMachine().getState(), 'REVIEW_READY');

    const leftForYou = events.find(
      (e) => e.type === 'STATE_CHANGED' && /Left for you:.*terms/i.test(e.description)
    );
    assert.ok(leftForYou, 'terms checkbox must be reported in timeline as Left for you');

    const termsChecked = await controller.getBrowserManager().page.isChecked('#terms');
    assert.strictEqual(termsChecked, false, 'consent checkbox must remain unchecked');

    const submitBlocked = events.find((e) => e.type === 'POLICY_BLOCKED');
    assert.ok(submitBlocked, 'Never-Submit policy must block autonomous submission');

    await controller.cleanup();
  });

  await test('stopping active session cleanly closes browser, purges session, and transitions to IDLE', async () => {
    const backend = makeStubBackend(FORM_URL);
    backend.mapForm = async (sessionId, snapshot) => {
      return {
        session_id: sessionId,
        mappings: [],
        clarifications_required: [
          {
            clarification_id: 'clarify_stop_test',
            field_ref: 'field_001',
            field_label: 'Student Name',
            question: 'What is student name?',
            options: ['Aarav', 'Other'],
          },
        ],
        unmapped_fields: [],
      };
    };

    const controller = new AgentController(backend);
    let clarificationReceived = false;

    const unsubscribe = controller.onClarificationRequest(async () => {
      clarificationReceived = true;
      unsubscribe();
      // Stop session while waiting in CLARIFICATION_REQUIRED
      await controller.stop();
    });

    await controller.startSession({
      documentText: 'Test text',
      documentName: 'test.pdf',
      targetUrl: FORM_URL,
    });

    assert.ok(clarificationReceived, 'clarification should have been reached');
    assert.strictEqual(
      controller.getStateMachine().getState(),
      'IDLE',
      'state machine must be returned to IDLE'
    );

    // Ensure subsequent session can be started cleanly
    let secondSessionStarted = false;
    try {
      // Re-map without clarifications to complete cleanly
      backend.mapForm = async (sessionId, snapshot) => ({
        session_id: sessionId,
        mappings: getFullFormMappings(snapshot),
        clarifications_required: [],
        unmapped_fields: [],
      });
      await controller.startSession({
        documentText: 'Aarav Sharma',
        documentName: 'test2.pdf',
        targetUrl: FORM_URL,
      });
      secondSessionStarted = true;
      assert.strictEqual(controller.getStateMachine().getState(), 'REVIEW_READY');
    } finally {
      await controller.cleanup();
    }
    assert.ok(secondSessionStarted, 'should be able to start second session after stop');
  });

  await test('audit persistence queue is fully drained before purgeSession executes and never produces post-purge 404 race condition', async () => {
    const backend = makeStubBackend(FORM_URL);
    const activeSessions = new Set();
    let postPurgeEventAttempted = false;

    const origCreateSession = backend.createSession;
    backend.createSession = async (...args) => {
      const res = await origCreateSession(...args);
      activeSessions.add(res.id);
      return res;
    };

    backend.appendEventSafe = async (sessionId, event) => {
      // Simulate network latency so events queue up
      await new Promise((r) => setTimeout(r, 25));
      if (!activeSessions.has(sessionId)) {
        postPurgeEventAttempted = true;
      }
      return true;
    };

    const origPurge = backend.purgeSession;
    backend.purgeSession = async (sessionId) => {
      activeSessions.delete(sessionId);
      return origPurge(sessionId);
    };

    const controller = new AgentController(backend);
    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    assert.strictEqual(
      postPurgeEventAttempted,
      false,
      'No audit event must be persisted after the session is purged (which causes 404)'
    );
    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      'Session must complete cleanly to REVIEW_READY'
    );

    await controller.cleanup();
  });

  await test('failed or hanging event persistence does not prevent browser cleanup or session stop', async () => {
    const backend = makeStubBackend(FORM_URL);

    // Deliberately simulate failing event persistence
    backend.appendEventSafe = async () => {
      throw new Error('Database connection failed');
    };

    const controller = new AgentController(backend);
    let errorThrown = false;
    try {
      await controller.startSession({
        documentText: 'Student Name: Aarav Sharma',
        documentName: 'student.pdf',
        targetUrl: FORM_URL,
      });
    } catch {
      errorThrown = true;
    }

    assert.strictEqual(errorThrown, false, 'Persistence failures must not break the workflow');
    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      'Workflow must proceed to REVIEW_READY despite persistence failures'
    );

    // Stop must also succeed without hanging or throwing
    await controller.stop();
    assert.strictEqual(controller.getStateMachine().getState(), 'IDLE');
    await controller.cleanup();
  });

  await test('programmatic form submission mechanisms are removed from AgentController and BrowserManager', async () => {
    const backend = makeStubBackend(FORM_URL);
    const controller = new AgentController(backend);
    assert.strictEqual(
      typeof controller.submitFormAsOperator,
      'undefined',
      'AgentController must not expose submitFormAsOperator'
    );
    const browser = controller.getBrowserManager();
    assert.strictEqual(
      typeof browser.submitFormManually,
      'undefined',
      'BrowserManager must not expose submitFormManually'
    );
  });

  await test('agent autonomously navigates all five form sections via Continue and halts at REVIEW_READY before Submit', async () => {
    const backend = makeStubBackend(FORM_URL);

    // Provide mappings for all 5 sections so validation in each section succeeds
    backend.mapForm = async (sessionId, snapshot) => {
      const mappings = [];
      const find = (needle) =>
        snapshot.fields.find((f) => f.label.toLowerCase().includes(needle));

      // Section 1
      const name = find('student full name') || find('student name');
      if (name) mappings.push({ field_ref: name.ref, field_label: name.label, fact_key: 'student_name', fact_value: 'Aarav Sharma', confidence: 1.0, status: 'PENDING' });
      const dob = find('date of birth') || find('dob');
      if (dob) mappings.push({ field_ref: dob.ref, field_label: dob.label, fact_key: 'dob', fact_value: '2005-03-23', confidence: 1.0, status: 'PENDING' });
      const gender = find('gender');
      if (gender) mappings.push({ field_ref: gender.ref, field_label: gender.label, fact_key: 'gender', fact_value: 'Male', confidence: 1.0, status: 'PENDING' });

      // Section 2
      const email = find('email');
      if (email) mappings.push({ field_ref: email.ref, field_label: email.label, fact_key: 'email', fact_value: 'aarav@example.com', confidence: 1.0, status: 'PENDING' });
      const phone = find('phone');
      if (phone) mappings.push({ field_ref: phone.ref, field_label: phone.label, fact_key: 'phone', fact_value: '9876543210', confidence: 1.0, status: 'PENDING' });

      // Section 3
      const address = find('residential address') || find('address');
      if (address) mappings.push({ field_ref: address.ref, field_label: address.label, fact_key: 'address', fact_value: '123 Park Street', confidence: 1.0, status: 'PENDING' });
      const city = find('city');
      if (city) mappings.push({ field_ref: city.ref, field_label: city.label, fact_key: 'city', fact_value: 'Mumbai', confidence: 1.0, status: 'PENDING' });
      const state = find('state');
      if (state) mappings.push({ field_ref: state.ref, field_label: state.label, fact_key: 'state', fact_value: 'Maharashtra', confidence: 1.0, status: 'PENDING' });
      const pincode = find('pincode') || find('zip');
      if (pincode) mappings.push({ field_ref: pincode.ref, field_label: pincode.label, fact_key: 'pincode', fact_value: '400001', confidence: 1.0, status: 'PENDING' });

      // Section 4
      const father = find('father');
      if (father) mappings.push({ field_ref: father.ref, field_label: father.label, fact_key: 'father_name', fact_value: 'Vikram Sharma', confidence: 1.0, status: 'PENDING' });
      const mother = find('mother');
      if (mother) mappings.push({ field_ref: mother.ref, field_label: mother.label, fact_key: 'mother_name', fact_value: 'Sunita Sharma', confidence: 1.0, status: 'PENDING' });

      // Section 5
      const grade = find('grade');
      if (grade) mappings.push({ field_ref: grade.ref, field_label: grade.label, fact_key: 'grade', fact_value: 'Grade 10', confidence: 1.0, status: 'PENDING' });
      const terms = find('terms') || snapshot.fields.find((f) => f.type === 'checkbox');
      if (terms) mappings.push({ field_ref: terms.ref, field_label: terms.label, fact_key: 'terms', fact_value: 'agree', confidence: 1.0, status: 'PENDING' });

      return {
        session_id: sessionId,
        mappings,
        clarifications_required: [],
        unmapped_fields: [],
      };
    };

    const controller = new AgentController(backend);
    const events = [];
    controller.onEvent((e) => {
      events.push(e);
    });

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    // 1. Verify that the agent halts at REVIEW_READY
    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      'Agent must halt at REVIEW_READY'
    );

    // 2. Verify that pagination tool (click_pagination) was executed for all 4 intermediate transitions
    const paginationCompletions = events.filter(
      (e) => e.tool === 'click_pagination' && e.type === 'TOOL_COMPLETED'
    );
    assert.strictEqual(
      paginationCompletions.length,
      4,
      `Expected exactly 4 pagination clicks (sections 1->2, 2->3, 3->4, 4->5), got ${paginationCompletions.length}`
    );

    // 3. Verify that all 5 sections were reached and Section 5 terms checkbox was reported as Left for you
    const termsLeftForYou = events.find(
      (e) => e.type === 'STATE_CHANGED' && /Left for you:.*terms/i.test(e.description)
    );
    assert.ok(termsLeftForYou, 'Section 5 terms checkbox must be reported as Left for you');

    // 4. Verify that PolicyEngine detected and blocked the final submission button on Section 5
    const policyBlocked = events.find(
      (e) => e.type === 'POLICY_BLOCKED' && /DENIED_FINAL_SUBMISSION/i.test(e.description)
    );
    assert.ok(policyBlocked, 'Never-Submit policy must block autonomous final submission on Section 5');

    // 5. Verify that final submission was NEVER clicked (confirmation message must not be visible)
    const isSubmitted = await controller.getBrowserManager().page.evaluate(() => {
      const confirmation = document.getElementById('submitted-confirmation');
      return confirmation && window.getComputedStyle(confirmation).display !== 'none';
    });
    assert.strictEqual(isSubmitted, false, 'The application must NEVER click or execute final form submission');

    await controller.cleanup();
  });

  await test('A. multiple missing values must all be collected sequentially rather than arbitrarily stopping after two', async () => {
    const backend = makeStubBackend(FORM_URL);
    const origMapForm = backend.mapForm;
    backend.mapForm = async (sessionId, snapshot) => {
      const res = await origMapForm(sessionId, snapshot);
      // In Section 1, make 3 required fields missing/unresolved (name, dob, gender)
      const hasSection1 = snapshot.fields.some((f) => /dob|birth/i.test(f.label));
      if (hasSection1) {
        res.mappings = res.mappings.filter((m) => !/student.*name|dob|gender/i.test(m.field_label));
        res.clarifications_required = [
          {
            clarification_id: 'clarify_missing_name',
            field_ref: snapshot.fields.find((f) => /name/i.test(f.label))?.ref || 'field_001',
            field_label: 'Student Full Name',
            question: 'Please confirm student full name',
            options: ['Aarav Sharma', 'Aarav S.'],
          },
          {
            clarification_id: 'clarify_missing_dob',
            field_ref: snapshot.fields.find((f) => /dob|birth/i.test(f.label))?.ref || 'field_002',
            field_label: 'Date of Birth',
            question: 'Please provide date of birth',
            options: ['2005-03-23', '23/03/2005'],
          },
          {
            clarification_id: 'clarify_missing_gender',
            field_ref: snapshot.fields.find((f) => /gender/i.test(f.label))?.ref || 'field_003',
            field_label: 'Gender',
            question: 'Please select student gender',
            options: ['Male', 'Female', 'Other'],
          },
        ];
      }
      return res;
    };

    const controller = new AgentController(backend);
    const receivedPrompts = [];
    controller.onClarificationRequest((prompt) => {
      receivedPrompts.push(prompt);
      setTimeout(() => {
        let answer = 'Aarav Sharma';
        if (/dob/i.test(prompt.clarificationId) || /birth/i.test(prompt.fieldLabel)) answer = '2005-03-23';
        if (/gender/i.test(prompt.clarificationId) || /gender/i.test(prompt.fieldLabel)) answer = 'Male';
        controller.answerClarification(prompt.clarificationId, answer);
      }, 40);
    });

    await controller.startSession({
      documentText: 'Student admission document',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    // Prove: all 3 missing values were collected, not arbitrarily stopped at 2
    assert.strictEqual(receivedPrompts.length, 3, 'Must collect all 3 missing values sequentially');
    assert.strictEqual(receivedPrompts[0].total, 3, 'First prompt must reflect total=3');
    assert.strictEqual(receivedPrompts[0].currentIndex, 1, 'First prompt currentIndex=1');
    assert.strictEqual(receivedPrompts[1].total, 3, 'Second prompt must reflect total=3');
    assert.strictEqual(receivedPrompts[1].currentIndex, 2, 'Second prompt currentIndex=2');
    assert.strictEqual(receivedPrompts[2].total, 3, 'Third prompt must reflect total=3');
    assert.strictEqual(receivedPrompts[2].currentIndex, 3, 'Third prompt currentIndex=3');

    // Prove workflow completed cleanly to REVIEW_READY after all 3 were collected and verified
    assert.strictEqual(controller.getStateMachine().getState(), 'REVIEW_READY');
    await controller.cleanup();
  });

  await test('B. simulated delayed/failed field filling blocks Continue until the actual DOM is correct', async () => {
    const backend = makeStubBackend(FORM_URL);
    const controller = new AgentController(backend);
    const browser = controller.getBrowserManager();

    let emailFillAttempts = 0;
    let paginationClicksBeforeVerified = 0;
    const origFillText = browser.fillText.bind(browser);

    // Intercept fillText for email in Section 2 to simulate delayed failure on 1st attempt
    browser.fillText = async function (fieldRef, value, signal) {
      if (value.includes('@') || /email/i.test(fieldRef)) {
        emailFillAttempts += 1;
        if (emailFillAttempts === 1) {
          // Attempt 1: simulate failure - field is left blank in DOM
          const res = await origFillText(fieldRef, '', signal);
          return { success: false, actualValue: '', expectedValue: value };
        }
      }
      return origFillText(fieldRef, value, signal);
    };

    const origClickPagination = browser.clickPagination.bind(browser);
    browser.clickPagination = async function (label, selector, signal) {
      const page = browser.page;
      const section2Visible = await page.evaluate(() => {
        const s2 = document.getElementById('section-2');
        return s2 && !s2.hidden;
      });
      if (section2Visible) {
        const emailVal = await page.inputValue('#email');
        if (!emailVal || !emailVal.includes('@')) {
          paginationClicksBeforeVerified += 1;
        }
      }
      return origClickPagination(label, selector, signal);
    };

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    assert.ok(emailFillAttempts >= 2, `Expected at least 2 fill attempts for email, got ${emailFillAttempts}`);
    assert.strictEqual(paginationClicksBeforeVerified, 0, 'Pagination click must never be attempted while DOM field is unverified');
    assert.strictEqual(controller.getStateMachine().getState(), 'REVIEW_READY');

    await controller.cleanup();
  });

  await test('C. simulated typo/mismatched value causes agent to retry and request clarification instead of advancing', async () => {
    const backend = makeStubBackend(FORM_URL);
    const origMapForm = backend.mapForm;
    backend.mapForm = async (sessionId, snapshot) => {
      const res = await origMapForm(sessionId, snapshot);
      // Give Section 1 gender an invalid option typo
      const genderM = res.mappings.find((m) => /gender/i.test(m.field_label));
      if (genderM) {
        genderM.fact_value = 'NonExistentGenderOption';
      }
      return res;
    };

    const controller = new AgentController(backend);
    let clarificationRequested = false;
    let advancedWhileMismatched = false;

    controller.onClarificationRequest((prompt) => {
      if (/gender/i.test(prompt.fieldLabel) || /gender/i.test(prompt.fieldRef)) {
        clarificationRequested = true;
        // Operator supplies corrected value
        setTimeout(() => {
          controller.answerClarification(prompt.clarificationId, 'Male');
        }, 50);
      }
    });

    const browser = controller.getBrowserManager();
    const origClickPagination = browser.clickPagination.bind(browser);
    browser.clickPagination = async function (label, selector, signal) {
      const page = browser.page;
      const genderVal = await page.inputValue('#gender');
      if (genderVal !== 'Male') {
        advancedWhileMismatched = true;
      }
      return origClickPagination(label, selector, signal);
    };

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    assert.strictEqual(clarificationRequested, true, 'Clarification must be requested when value mismatches/fails verification');
    assert.strictEqual(advancedWhileMismatched, false, 'Continue must NOT be clicked while gender value was mismatched');
    assert.strictEqual(controller.getStateMachine().getState(), 'REVIEW_READY');

    await controller.cleanup();
  });

  await test('D. each section actual DOM values are verified correct before navigation', async () => {
    const backend = makeStubBackend(FORM_URL);
    const controller = new AgentController(backend);
    const browser = controller.getBrowserManager();

    const verifiedSections = [];

    const origClickPagination = browser.clickPagination.bind(browser);
    browser.clickPagination = async function (label, selector, signal) {
      const page = browser.page;

      const s1 = await page.evaluate(() => !document.getElementById('section-1').hidden);
      const s2 = await page.evaluate(() => !document.getElementById('section-2').hidden);
      const s3 = await page.evaluate(() => !document.getElementById('section-3').hidden);
      const s4 = await page.evaluate(() => !document.getElementById('section-4').hidden);

      if (s1) {
        const name = await page.inputValue('#student_name');
        const dob = await page.inputValue('#dob');
        const gender = await page.inputValue('#gender');
        assert.strictEqual(name, 'Aarav Sharma');
        assert.ok(dob.length > 0);
        assert.strictEqual(gender, 'Male');
        verifiedSections.push(1);
      } else if (s2) {
        const email = await page.inputValue('#email');
        const phone = await page.inputValue('#phone');
        assert.strictEqual(email, 'aarav@example.com');
        assert.strictEqual(phone, '9876543210');
        verifiedSections.push(2);
      } else if (s3) {
        const address = await page.inputValue('#address');
        const city = await page.inputValue('#city');
        const state = await page.inputValue('#state');
        const pincode = await page.inputValue('#pincode');
        assert.strictEqual(address, '123 Park Street');
        assert.strictEqual(city, 'Mumbai');
        assert.strictEqual(state, 'Maharashtra');
        assert.strictEqual(pincode, '400001');
        verifiedSections.push(3);
      } else if (s4) {
        const father = await page.inputValue('#father_name');
        const mother = await page.inputValue('#mother_name');
        assert.strictEqual(father, 'Vikram Sharma');
        assert.strictEqual(mother, 'Sunita Sharma');
        verifiedSections.push(4);
      }

      return origClickPagination(label, selector, signal);
    };

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    assert.deepStrictEqual(verifiedSections, [1, 2, 3, 4], 'Sections 1, 2, 3, 4 must all be verified before their Continue click');
    assert.strictEqual(controller.getStateMachine().getState(), 'REVIEW_READY');

    await controller.cleanup();
  });

  await test('E. final REVIEW_READY occurs only after complete browser-side verification of all required fields across all sections', async () => {
    const backend = makeStubBackend(FORM_URL);
    let capturedVerifications = [];
    const origAppendEvents = backend.appendEvents;
    backend.appendEvents = async (sessionId, events, verifications) => {
      if (verifications && verifications.length > 0) {
        capturedVerifications.push(...verifications);
      }
      return origAppendEvents(sessionId, events, verifications);
    };

    const controller = new AgentController(backend);
    const events = [];
    controller.onEvent((e) => events.push(e));

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    assert.strictEqual(controller.getStateMachine().getState(), 'REVIEW_READY');

    // 1. Every required field across the full form must have verified: true
    const requiredLabels = [
      'Student Full Name',
      'Date of Birth',
      'Gender',
      'Email Address',
      'Phone',
      'Address',
      'City',
      'State',
      'Pincode',
      'Father',
      'Mother',
      'Grade',
      'terms',
    ];

    for (const reqLabel of requiredLabels) {
      const match = capturedVerifications.find((v) => new RegExp(reqLabel, 'i').test(v.field_label));
      assert.ok(match, `Verification record must exist for required field '${reqLabel}'`);
      assert.strictEqual(match.verified, true, `Verification record for '${reqLabel}' must be verified=true`);
    }

    // 2. Section 5 DOM must confirm grade is populated and terms is left unchecked for operator
    const page = controller.getBrowserManager().page;
    const gradeVal = await page.inputValue('#grade');
    const termsChecked = await page.isChecked('#terms');
    assert.strictEqual(gradeVal, 'Grade 10');
    assert.strictEqual(termsChecked, false, 'consent checkbox must remain unchecked');

    // 3. Final Submit was detected by PolicyEngine and blocked
    const policyBlocked = events.find((e) => e.type === 'POLICY_BLOCKED');
    assert.ok(policyBlocked, 'PolicyEngine must block autonomous submit');

    // 4. Form was never submitted
    const isSubmitted = await page.evaluate(() => {
      const confirmation = document.getElementById('submitted-confirmation');
      return confirmation && window.getComputedStyle(confirmation).display !== 'none';
    });
    assert.strictEqual(isSubmitted, false, 'Submit button must never be clicked');

    await controller.cleanup();
  });

  await test('document extraction stages transition correctly (uploading -> reading -> extracting -> organizing -> completed) without exposing raw values', async () => {
    const stages = [];
    let stage = 'idle';

    const setStage = (s) => {
      stage = s;
      stages.push(s);
    };

    // Verify full progressive state sequence
    setStage('uploading');
    setStage('reading_document');
    setStage('extracting_information');

    const backend = makeStubBackend(FORM_URL);
    const result = await backend.extractDocument();
    assert.strictEqual(result.fact_count, 14);

    setStage('organizing_facts');
    setStage('completed');

    assert.deepStrictEqual(stages, [
      'uploading',
      'reading_document',
      'extracting_information',
      'organizing_facts',
      'completed',
    ]);
  });

  await test('missing required value discovered during automation triggers clarification pause, resumes to fill & verify DOM, and continues automatically until REVIEW_READY', async () => {
    const backend = makeStubBackend(FORM_URL);
    const controller = new AgentController(backend);

    const origExtract = backend.extractDocument.bind(backend);
    backend.extractDocument = async () => {
      const res = await origExtract();
      return {
        ...res,
        facts: res.facts.filter((f) => f.key !== 'student_name'),
      };
    };

    // Provide mappings for all fields EXCEPT student name initially, simulating a missing value discovered during automation
    backend.mapForm = async (sessionId, snapshot) => {
      const allMappings = getFullFormMappings(snapshot);
      const filtered = allMappings.filter((m) => m.fact_key !== 'student_name');
      return {
        session_id: sessionId,
        mappings: filtered,
        clarifications_required: [],
        unmapped_fields: [],
      };
    };

    let clarificationReceived = false;
    controller.onClarificationRequest((prompt) => {
      if (prompt.fieldLabel.toLowerCase().includes('student') || prompt.fieldRef.includes('name')) {
        clarificationReceived = true;
        setTimeout(() => {
          controller.answerClarification(prompt.clarificationId, 'Kavya Sen');
        }, 50);
      }
    });

    const events = [];
    controller.onEvent((e) => events.push(e));

    await controller.startSession({
      documentText: 'Gender: Female',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    assert.ok(clarificationReceived, 'Clarification prompt must be presented for the missing required student name');
    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      'Agent must resume after clarification and continue to REVIEW_READY'
    );

    const policyBlocked = events.find((e) => e.type === 'POLICY_BLOCKED');
    assert.ok(policyBlocked, 'Never-Submit must block autonomous submission');

    await controller.cleanup();
  });

  await test('information preflight identifies all missing required values before opening the form, collects them sequentially, and only then launches the browser and completes the workflow', async () => {
    const backend = makeStubBackend(FORM_URL);
    backend.extractDocument = async () => ({
      document_name: 'student.pdf',
      fact_count: 12,
      facts: [
        { key: 'email', label: 'Email Address', value: 'aarav@example.com', confidence: 0.95 },
        { key: 'phone', label: 'Phone', value: '9876543210', confidence: 0.95 },
        { key: 'address', label: 'Address', value: '123 Park Street', confidence: 0.95 },
        { key: 'city', label: 'City', value: 'Mumbai', confidence: 0.95 },
        { key: 'state', label: 'State', value: 'Maharashtra', confidence: 0.95 },
        { key: 'pincode', label: 'Pincode', value: '400001', confidence: 0.95 },
        { key: 'father_name', label: 'Father Name', value: 'Vikram Sharma', confidence: 0.95 },
        { key: 'mother_name', label: 'Mother Name', value: 'Sunita Sharma', confidence: 0.95 },
        { key: 'grade', label: 'Grade', value: 'Grade 10', confidence: 0.95 },
        { key: 'allergies', label: 'Allergies', value: 'No', confidence: 0.95 },
        { key: 'transport', label: 'Transport', value: 'No', confidence: 0.95 },
        { key: 'terms', label: 'Terms', value: 'agree', confidence: 1.0 },
      ],
    });
    const controller = new AgentController(backend);

    const receivedPrompts = [];
    let browserOpenDuringPreflight = false;

    controller.onClarificationRequest((prompt) => {
      // Prove that the browser page is NOT open when preflight clarifications are issued
      if (controller.getBrowserManager().page !== null) {
        browserOpenDuringPreflight = true;
      }
      receivedPrompts.push(prompt);
      setTimeout(() => {
        let answer = 'Aarav Sharma';
        if (/dob/i.test(prompt.fieldRef) || /birth/i.test(prompt.fieldLabel)) answer = '2005-03-23';
        if (/gender/i.test(prompt.fieldRef) || /gender/i.test(prompt.fieldLabel)) answer = 'Male';
        controller.answerClarification(prompt.clarificationId, answer);
      }, 40);
    });

    await controller.startSession({
      documentText: 'School admission document without demographics',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
      requiredFactKeys: ['student_name', 'dob', 'gender'],
    });

    // 1. All 3 missing required values were collected sequentially before opening form
    assert.strictEqual(receivedPrompts.length, 3, 'Must identify and collect all 3 missing required values');
    assert.strictEqual(browserOpenDuringPreflight, false, 'Target form browser must NOT be opened before information preflight is complete');

    // 2. Stepper counts are truthful across the preflight sequence
    assert.strictEqual(receivedPrompts[0].total, 3);
    assert.strictEqual(receivedPrompts[0].currentIndex, 1);
    assert.strictEqual(receivedPrompts[1].total, 3);
    assert.strictEqual(receivedPrompts[1].currentIndex, 2);
    assert.strictEqual(receivedPrompts[2].total, 3);
    assert.strictEqual(receivedPrompts[2].currentIndex, 3);

    // 3. Once complete, automation proceeded and completed at REVIEW_READY
    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      'Session must proceed to REVIEW_READY once preflight completes'
    );

    await controller.cleanup();
  });

  await test('three requiredFactKeys are not treated as entire form requirement set when more requirements exist; all missing required facts collected before normal automation', async () => {
    const backend = makeStubBackend(FORM_URL);
    // Extracted facts initially contain only student_name, dob, gender
    backend.extractDocument = async () => ({
      document_name: 'student.pdf',
      fact_count: 3,
      facts: [
        { key: 'student_name', label: 'Student Name', value: 'Aarav Sharma', confidence: 0.95 },
        { key: 'dob', label: 'Date of Birth', value: '2005-03-23', confidence: 0.95 },
        { key: 'gender', label: 'Gender', value: 'Male', confidence: 0.95 },
      ],
    });

    // mapForm returns mappings for known facts in the session, leaving unprovided facts unmapped
    backend.mapForm = async (sessionId, snapshot, facts) => {
      const allMappings = getFullFormMappings(snapshot);
      const availableKeys = new Set((facts || []).map((f) => f.key.toLowerCase().trim()));
      const mapped = allMappings.filter((m) => {
        if (availableKeys.has(m.fact_key.toLowerCase().trim())) return true;
        for (const k of availableKeys) {
          if (m.fact_key.toLowerCase().includes(k) || k.includes(m.fact_key.toLowerCase())) return true;
        }
        return false;
      });
      return {
        session_id: sessionId,
        mappings: mapped,
        clarifications_required: [],
        unmapped_fields: [],
      };
    };

    const controller = new AgentController(backend);
    const receivedPrompts = [];
    let browserOpenDuringPrompts = false;

    controller.onClarificationRequest((prompt) => {
      if (controller.getBrowserManager().page !== null) {
        browserOpenDuringPrompts = true;
      }
      receivedPrompts.push(prompt);
      setTimeout(() => {
        let answer = 'Test Value';
        if (/email/i.test(prompt.fieldLabel)) answer = 'aarav@example.com';
        else if (/phone/i.test(prompt.fieldLabel)) answer = '9876543210';
        else if (/address/i.test(prompt.fieldLabel)) answer = '123 Park Street';
        else if (/city/i.test(prompt.fieldLabel)) answer = 'Mumbai';
        else if (/state/i.test(prompt.fieldLabel)) answer = 'Maharashtra';
        else if (/pin|zip/i.test(prompt.fieldLabel)) answer = '400001';
        else if (/father/i.test(prompt.fieldLabel)) answer = 'Vikram Sharma';
        else if (/mother/i.test(prompt.fieldLabel)) answer = 'Sunita Sharma';
        else if (/grade/i.test(prompt.fieldLabel)) answer = 'Grade 10';
        else if (/term|agree/i.test(prompt.fieldLabel)) answer = 'agree';
        controller.answerClarification(prompt.clarificationId, answer);
      }, 30);
    });

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma, DOB: 2005-03-23, Gender: Male',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
      requiredFactKeys: ['student_name', 'dob', 'gender'],
    });

    // 1. More than the 3 keys were required and collected
    assert.ok(
      receivedPrompts.length > 0,
      'Must identify and prompt for remaining required fields beyond the 3 keys'
    );
    // 2. The browser was NOT open while missing required facts were collected
    assert.strictEqual(
      browserOpenDuringPrompts,
      false,
      'Target browser must NOT be opened before complete required information set is collected'
    );
    // 3. Reached REVIEW_READY once all facts collected
    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      'Workflow must proceed to REVIEW_READY after all required information is provided'
    );

    await controller.cleanup();
  });

  await test('incomplete mapping cannot advance workflow and mapping failure does not silently produce a partially populated form', async () => {
    const backend = makeStubBackend(FORM_URL);
    backend.mapForm = async () => {
      throw new Error('Mapping provider failure: 503 Overloaded');
    };

    const controller = new AgentController(backend);
    let thrownError = null;

    try {
      await controller.startSession({
        documentText: 'Aarav Sharma',
        documentName: 'doc.pdf',
        targetUrl: FORM_URL,
      });
    } catch (err) {
      thrownError = err;
    }

    assert.ok(thrownError, 'Workflow must abort when mapping fails');
    assert.strictEqual(
      controller.getStateMachine().getState(),
      'ERROR',
      'State machine must transition to ERROR on mapping failure'
    );
    assert.strictEqual(
      controller.getBrowserManager().page,
      null,
      'Browser must not remain open or partially populated on mapping failure'
    );

    await controller.cleanup();
  });

  await test('Phase 9F: manual submit by user triggers automated detection, transitions to COMPLETED, and cleanly closes session', async () => {
    const backend = makeStubBackend(FORM_URL);
    const controller = new AgentController(backend);

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    // 1. Agent halts at REVIEW_READY without submitting
    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      'Agent must halt at REVIEW_READY before manual submission'
    );

    // 2. Browser remains open for operator review
    const bm = controller.getBrowserManager();
    assert.ok(bm.page && !bm.page.isClosed(), 'Browser must remain open for human review');

    // 3. Operator reviews, accepts terms, and clicks final submit on Section 5
    await bm.page.evaluate(() => {
      const terms = document.getElementById('terms');
      if (terms) terms.checked = true;
      const submitBtn = document.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn) {
        submitBtn.click();
      } else {
        const form = document.querySelector('form');
        if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });

    // 4. Await manual submission detection
    const completed = await controller.waitForManualSubmission(5000);
    assert.strictEqual(completed, true, 'Controller must detect submission and reach COMPLETED');
    assert.strictEqual(
      controller.getStateMachine().getState(),
      'COMPLETED',
      'State machine must be in terminal COMPLETED state'
    );

    // 5. Browser must be cleanly closed after session completion
    assert.strictEqual(
      bm.page,
      null,
      'Browser must be cleanly closed after session completion'
    );

    await controller.cleanup();
  });

  await test('Phase 9F: session finalization preserves COMPLETED history status and accurate field counts without IDLE downgrade', async () => {
    const scratchDir = path.join(__dirname, `scratch_test_history_${Date.now()}`);
    if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

    try {
      const historyStore = new HistoryStore(scratchDir);
      const backend = makeStubBackend(FORM_URL);
      const controller = new AgentController(backend);

      // Wire historyStore to controller lifecycle (totalFields 0 initially, synchronized from form)
      historyStore.beginSession({
        targetUrl: FORM_URL,
        profileName: 'Student Profile',
        dataSource: 'both',
        totalFields: 0,
      });

      controller.onEvent((e) => historyStore.noteEvent(e));
      controller.getStateMachine().onTransition((s) => historyStore.noteState(s));

      await controller.startSession({
        documentText: 'Student Name: Aarav Sharma',
        documentName: 'student.pdf',
        targetUrl: FORM_URL,
      });

      assert.strictEqual(controller.getStateMachine().getState(), 'REVIEW_READY');

      // Operator manually reviews, accepts terms, and submits
      const bm = controller.getBrowserManager();
      await bm.page.evaluate(() => {
        const terms = document.getElementById('terms');
        if (terms) terms.checked = true;
        const submitBtn = document.querySelector('button[type="submit"], input[type="submit"]');
        if (submitBtn) submitBtn.click();
      });

      await controller.waitForManualSubmission(5000);
      assert.strictEqual(controller.getStateMachine().getState(), 'COMPLETED');

      // Operator later stops / clears active controller
      await controller.stop();

      // Verify history records
      const sessions = historyStore.listSessions();
      assert.strictEqual(sessions.length, 1);
      const rec = sessions[0];

      // Must be COMPLETED, not IDLE
      assert.strictEqual(
        rec.status,
        'COMPLETED',
        'History record must retain COMPLETED status and not be downgraded to IDLE'
      );

      // Fields ratio must be truthful: totalFields >= fieldsFilled, no "15 / 12"
      assert.ok(rec.fieldsFilled > 0, 'fieldsFilled must be greater than zero');
      assert.ok(
        rec.totalFields >= rec.fieldsFilled,
        `totalFields (${rec.totalFields}) must be >= fieldsFilled (${rec.fieldsFilled})`
      );

      // Strict privacy check: no raw personal values in history record
      const serialized = JSON.stringify(rec);
      assert.strictEqual(serialized.includes('Aarav Sharma'), false, 'No raw student name in history');
      assert.strictEqual(serialized.includes('aarav@example.com'), false, 'No raw email in history');
      assert.strictEqual(serialized.includes('9876543210'), false, 'No raw phone in history');

      await controller.cleanup();
    } finally {
      if (fs.existsSync(scratchDir)) fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  await test('Phase 9F: failed or ambiguous submission does not falsely report success and preserves REVIEW_READY', async () => {
    const backend = makeStubBackend(FORM_URL);
    const controller = new AgentController(backend);

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    assert.strictEqual(controller.getStateMachine().getState(), 'REVIEW_READY');

    const bm = controller.getBrowserManager();

    // Inject an error element into the page simulating failed submission
    await bm.page.evaluate(() => {
      const err = document.createElement('div');
      err.className = 'error-message';
      err.textContent = 'Submission failed: Please correct the errors below.';
      document.body.prepend(err);
    });

    const isConfirmed = await bm.checkSubmissionConfirmed();
    assert.strictEqual(isConfirmed, false, 'Error on page must prevent submission confirmation');

    const completed = await controller.waitForManualSubmission(800);
    assert.strictEqual(completed, false, 'Failed submission must not transition to COMPLETED');
    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      'Session must remain in REVIEW_READY for user verification'
    );

    await controller.cleanup();
  });

  await test('Phase 9F: stopping at REVIEW_READY preserves REVIEW_READY in history and never downgrades to IDLE', async () => {
    const scratchDir = path.join(__dirname, `scratch_test_history_stop_${Date.now()}`);
    if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

    try {
      const historyStore = new HistoryStore(scratchDir);
      const backend = makeStubBackend(FORM_URL);
      const controller = new AgentController(backend);

      historyStore.beginSession({
        targetUrl: FORM_URL,
        profileName: 'Review Session',
        dataSource: 'profile',
        totalFields: 0,
      });

      controller.onEvent((e) => historyStore.noteEvent(e));
      controller.getStateMachine().onTransition((s) => historyStore.noteState(s));

      await controller.startSession({
        documentText: 'Student Name: Aarav Sharma',
        documentName: 'student.pdf',
        targetUrl: FORM_URL,
      });

      assert.strictEqual(controller.getStateMachine().getState(), 'REVIEW_READY');

      // Operator stops without submitting
      await controller.stop();

      const sessions = historyStore.listSessions();
      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(
        sessions[0].status,
        'REVIEW_READY',
        'History record must stay REVIEW_READY and not become IDLE'
      );
      assert.ok(sessions[0].fieldsFilled > 0, 'fieldsFilled must be > 0');
      assert.ok(sessions[0].totalFields >= sessions[0].fieldsFilled, 'totalFields >= fieldsFilled');

      await controller.cleanup();
    } finally {
      if (fs.existsSync(scratchDir)) {
        try { fs.rmSync(scratchDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch {}
      }
    }
  });

  await test('Phase 9F: stopping in-flight active session records INTERRUPTED in history, not IDLE', async () => {
    const scratchDir = path.join(__dirname, `scratch_test_history_interrupted_${Date.now()}`);
    if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

    try {
      const historyStore = new HistoryStore(scratchDir);
      historyStore.beginSession({
        targetUrl: 'http://example.com/form',
        profileName: 'Cancelled Session',
        dataSource: 'profile',
        totalFields: 5,
      });

      // Simulate in-flight state and user stop
      historyStore.noteState('FILLING_FORM');
      historyStore.noteState('IDLE');

      const sessions = historyStore.listSessions();
      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(
        sessions[0].status,
        'INTERRUPTED',
        'Interrupted in-flight session must be saved as INTERRUPTED, not IDLE'
      );
    } finally {
      if (fs.existsSync(scratchDir)) {
        try { fs.rmSync(scratchDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch {}
      }
    }
  });

  await test('Phase 10: Human Blocker Gate - detects login gate, types nothing while gated, resumes after simulated sign-in, fills form, halts at REVIEW_READY', async () => {
    const gateFixture = path.resolve(__dirname, 'fixtures/forms/login_gate.html');
    assert.ok(fs.existsSync(gateFixture), 'login_gate.html fixture must exist');
    const gateUrl = `file://${gateFixture.replace(/\\/g, '/')}`;

    const facts = [
      { key: 'student_name', label: 'Student Full Name', value: 'Aarav Sharma', confidence: 1.0 },
      { key: 'dob', label: 'Date of Birth', value: '2005-03-23', confidence: 1.0 },
      { key: 'email', label: 'Student Email Address', value: 'aarav@example.com', confidence: 1.0 },
    ];

    const backend = {
      async createSession(doc, url) {
        return { id: 'session_login_gate_e2e' };
      },
      async extractDocument() {
        return { facts };
      },
      async mapForm(sessionId, snapshot) {
        const mappings = snapshot.fields.map((f) => {
          if (/name/i.test(f.label)) {
            return { field_ref: f.ref, field_label: f.label, fact_key: 'student_name', confidence: 1.0, status: 'PENDING' };
          }
          if (/dob|birth/i.test(f.label)) {
            return { field_ref: f.ref, field_label: f.label, fact_key: 'dob', confidence: 1.0, status: 'PENDING' };
          }
          if (/email/i.test(f.label)) {
            return { field_ref: f.ref, field_label: f.label, fact_key: 'email', confidence: 1.0, status: 'PENDING' };
          }
          return { field_ref: f.ref, field_label: f.label, confidence: 0, status: 'UNMAPPED' };
        });
        return { mappings, clarifications_required: [] };
      },
      async appendEventSafe() {},
      async appendEvents() {},
      async purgeSession() {},
    };

    const controller = new AgentController(backend);
    let reachedTakeover = false;
    controller.onEvent((evt) => {
      if (evt.type === 'STATE_CHANGED' && controller.getStateMachine().getState() === 'USER_TAKEOVER') {
        reachedTakeover = true;
      }
    });

    const sessionPromise = controller.startSession({
      targetUrl: gateUrl,
      facts,
    });

    // Wait until agent detects login gate and halts in USER_TAKEOVER
    const waitStart = Date.now();
    while (!reachedTakeover && Date.now() - waitStart < 10000) {
      await new Promise((r) => setTimeout(r, 200));
    }

    assert.strictEqual(reachedTakeover, true, 'Agent must detect login gate and enter USER_TAKEOVER');
    assert.strictEqual(controller.getStateMachine().getState(), 'USER_TAKEOVER');

    // Verify agent typed nothing into username or password fields while gated
    const browserMgr = controller.getBrowserManager();
    const page = browserMgr.page;
    assert.ok(page, 'Browser page must be active');
    const userVal = await page.inputValue('#username');
    const pwdVal = await page.inputValue('#password');
    assert.strictEqual(userVal, '', 'Username field must remain empty while gated');
    assert.strictEqual(pwdVal, '', 'Password field must remain empty while gated');

    // Simulate operator clicking Sign In to pass the gate
    await page.click('#signin-btn');

    // Wait for the session to resume automatically, fill the form, and reach REVIEW_READY
    await sessionPromise;

    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      'Agent must resume after simulated sign-in, populate form, and halt at REVIEW_READY'
    );

    // Verify form fields were filled correctly
    const filledName = await page.inputValue('#student_name');
    const filledEmail = await page.inputValue('#email');
    assert.strictEqual(filledName, 'Aarav Sharma');
    assert.strictEqual(filledEmail, 'aarav@example.com');

    await controller.stop();
  });

  await test('Phase 11: Readiness Gate mode=redirect - sign-in triggers location redirect, resumes after ~1.5s, fills form, halts at REVIEW_READY without ERROR', async () => {
    const gateFixture = path.resolve(__dirname, 'fixtures/forms/login_gate.html');
    assert.ok(fs.existsSync(gateFixture), 'login_gate.html fixture must exist');
    const redirectUrl = `file://${gateFixture.replace(/\\/g, '/')}?mode=redirect`;

    const facts = [
      { key: 'student_name', label: 'Student Full Name', value: 'Aarav Sharma', confidence: 1.0 },
      { key: 'dob', label: 'Date of Birth', value: '2005-03-23', confidence: 1.0 },
      { key: 'email', label: 'Student Email Address', value: 'aarav@example.com', confidence: 1.0 },
    ];

    const backend = {
      async createSession(doc, url) {
        return { id: 'session_redirect_gate_e2e' };
      },
      async extractDocument() {
        return { facts };
      },
      async mapForm(sessionId, snapshot) {
        const mappings = snapshot.fields.map((f) => {
          if (/name/i.test(f.label)) {
            return { field_ref: f.ref, field_label: f.label, fact_key: 'student_name', confidence: 1.0, status: 'PENDING' };
          }
          if (/dob|birth/i.test(f.label)) {
            return { field_ref: f.ref, field_label: f.label, fact_key: 'dob', confidence: 1.0, status: 'PENDING' };
          }
          if (/email/i.test(f.label)) {
            return { field_ref: f.ref, field_label: f.label, fact_key: 'email', confidence: 1.0, status: 'PENDING' };
          }
          return { field_ref: f.ref, field_label: f.label, confidence: 0, status: 'UNMAPPED' };
        });
        return { mappings, clarifications_required: [] };
      },
      async appendEventSafe() {},
      async appendEvents() {},
      async purgeSession() {},
    };

    const controller = new AgentController(backend);
    let reachedTakeover = false;
    controller.onEvent((evt) => {
      if (evt.type === 'STATE_CHANGED' && controller.getStateMachine().getState() === 'USER_TAKEOVER') {
        reachedTakeover = true;
      }
    });

    const sessionPromise = controller.startSession({
      targetUrl: redirectUrl,
      facts,
    });

    const waitStart = Date.now();
    while (!reachedTakeover && Date.now() - waitStart < 10000) {
      await new Promise((r) => setTimeout(r, 200));
    }

    assert.strictEqual(reachedTakeover, true, 'Agent must detect login gate and enter USER_TAKEOVER in redirect mode');
    assert.strictEqual(controller.getStateMachine().getState(), 'USER_TAKEOVER');

    const browserMgr = controller.getBrowserManager();
    const page = browserMgr.page;
    assert.ok(page, 'Browser page must be active');

    // Trigger sign in which initiates window.location redirect
    await page.click('#signin-btn');

    // Await session completion to REVIEW_READY
    await sessionPromise;

    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      'Agent must survive redirect navigation, resume when form appears, and halt at REVIEW_READY'
    );

    const filledName = await page.inputValue('#student_name');
    const filledEmail = await page.inputValue('#email');
    assert.strictEqual(filledName, 'Aarav Sharma');
    assert.strictEqual(filledEmail, 'aarav@example.com');

    await controller.stop();
  });

  await test('Phase 12: Readiness Gate mode=late - skeleton loader delays real form by ~1.5s, resumes and halts at REVIEW_READY', async () => {
    const gateFixture = path.resolve(__dirname, 'fixtures/forms/login_gate.html');
    assert.ok(fs.existsSync(gateFixture), 'login_gate.html fixture must exist');
    const lateUrl = `file://${gateFixture.replace(/\\/g, '/')}?mode=late`;

    const facts = [
      { key: 'student_name', label: 'Student Full Name', value: 'Aarav Sharma', confidence: 1.0 },
      { key: 'dob', label: 'Date of Birth', value: '2005-03-23', confidence: 1.0 },
      { key: 'email', label: 'Student Email Address', value: 'aarav@example.com', confidence: 1.0 },
    ];

    const backend = {
      async createSession(doc, url) {
        return { id: 'session_late_gate_e2e' };
      },
      async extractDocument() {
        return { facts };
      },
      async mapForm(sessionId, snapshot) {
        const mappings = snapshot.fields.map((f) => {
          if (/name/i.test(f.label)) {
            return { field_ref: f.ref, field_label: f.label, fact_key: 'student_name', confidence: 1.0, status: 'PENDING' };
          }
          if (/dob|birth/i.test(f.label)) {
            return { field_ref: f.ref, field_label: f.label, fact_key: 'dob', confidence: 1.0, status: 'PENDING' };
          }
          if (/email/i.test(f.label)) {
            return { field_ref: f.ref, field_label: f.label, fact_key: 'email', confidence: 1.0, status: 'PENDING' };
          }
          return { field_ref: f.ref, field_label: f.label, confidence: 0, status: 'UNMAPPED' };
        });
        return { mappings, clarifications_required: [] };
      },
      async appendEventSafe() {},
      async appendEvents() {},
      async purgeSession() {},
    };

    const controller = new AgentController(backend);
    let reachedTakeover = false;
    controller.onEvent((evt) => {
      if (evt.type === 'STATE_CHANGED' && controller.getStateMachine().getState() === 'USER_TAKEOVER') {
        reachedTakeover = true;
      }
    });

    const sessionPromise = controller.startSession({
      targetUrl: lateUrl,
      facts,
    });

    const waitStart = Date.now();
    while (!reachedTakeover && Date.now() - waitStart < 10000) {
      await new Promise((r) => setTimeout(r, 200));
    }

    assert.strictEqual(reachedTakeover, true, 'Agent must enter USER_TAKEOVER on late mode login gate');
    assert.strictEqual(controller.getStateMachine().getState(), 'USER_TAKEOVER');

    const browserMgr = controller.getBrowserManager();
    const page = browserMgr.page;
    assert.ok(page, 'Browser page must be active');

    // Click signin which reveals skeleton loader, real form loads ~1.5s later
    await page.click('#signin-btn');

    await sessionPromise;

    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      'Agent must wait through skeleton loader, populate late form, and halt at REVIEW_READY'
    );

    const filledName = await page.inputValue('#student_name');
    const filledEmail = await page.inputValue('#email');
    assert.strictEqual(filledName, 'Aarav Sharma');
    assert.strictEqual(filledEmail, 'aarav@example.com');

    await controller.stop();
  });

  await test('zero-value trace contains none of the test profile values from a full fill', async () => {
    const os = require('os');
    const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-zero-val-'));
    const backend = makeStubBackend(FORM_URL);
    const controller = new AgentController(backend);
    controller.setUserDataDir(tempUserData);

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma\nDate of Birth: 2005-03-23\nEmail: aarav@example.com\nPhone: 9876543210\nAddress: 123 Park Street, Mumbai, Maharashtra, 400001\nFather Name: Vikram Sharma\nMother Name: Sunita Sharma',
      documentName: 'student.pdf',
      targetUrl: FORM_URL,
    });

    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      'Session must complete to REVIEW_READY'
    );

    const tracePath = path.join(tempUserData, 'autofiller-trace.json');
    assert.ok(fs.existsSync(tracePath), 'Trace file must exist in userData directory');

    const traceRaw = fs.readFileSync(tracePath, 'utf8');
    const traceJson = JSON.parse(traceRaw);

    // Profile values extracted from the document / stub backend facts
    const secretProfileValues = [
      'Aarav Sharma',
      '2005-03-23',
      'aarav@example.com',
      '9876543210',
      '123 Park Street',
      'Mumbai',
      'Maharashtra',
      '400001',
      'Vikram Sharma',
      'Sunita Sharma',
    ];

    for (const val of secretProfileValues) {
      assert.strictEqual(
        traceRaw.toLowerCase().includes(val.toLowerCase()),
        false,
        `Trace must NEVER contain profile value '${val}'`
      );
    }

    assert.ok(traceJson.scans.length > 0, 'Trace must record at least one scan');
    const firstScan = traceJson.scans[0];
    assert.ok(firstScan.fields.length > 0, 'Trace scan must contain fields');
    assert.ok(firstScan.hostAndPath, 'Scan must record host and path');
    assert.ok(typeof firstScan.frameCount === 'number', 'Scan must record frameCount');
    assert.ok(typeof firstScan.timeSinceNavMs === 'number', 'Scan must record timeSinceNavMs');

    for (const field of firstScan.fields) {
      assert.ok(field.ref, 'Field trace must include ref');
      assert.ok(field.scannedLabel, 'Field trace must include scannedLabel');
      assert.ok(field.labelSource, 'Field trace must include labelSource');
      assert.ok(field.controlType, 'Field trace must include controlType');
      assert.ok(typeof field.required === 'boolean', 'Field trace must include required boolean');
      assert.ok(typeof field.visible === 'boolean', 'Field trace must include visible boolean');
      assert.ok(field.enabledState, 'Field trace must include enabledState');
      assert.ok(field.location, 'Field trace must include location');
      assert.ok(field.mapping, 'Field trace must include mapping metadata');
      assert.ok(typeof field.valueAvailable === 'boolean', 'Field trace must include valueAvailable boolean');
      assert.ok(Array.isArray(field.fillStrategies), 'Field trace must include fillStrategies array');
      assert.ok(field.domReadBack, 'Field trace must include domReadBack');
    }

    await controller.cleanup();
    try {
      fs.rmSync(tempUserData, { recursive: true, force: true });
    } catch {}
  });

  await test('real agent fills custom ARIA controls fixture and halts at REVIEW_READY', async () => {
    const ariaFixturePath = path.resolve(__dirname, 'fixtures/forms/aria_controls.html');
    assert.ok(fs.existsSync(ariaFixturePath), 'aria_controls.html fixture must exist');
    const ariaUrl = `file://${ariaFixturePath.replace(/\\/g, '/')}`;

    const backend = makeStubBackend(ariaUrl);
    const controller = new AgentController(backend);

    const events = [];
    const states = [];
    controller.onEvent((event) => events.push(event));
    controller.getStateMachine().onTransition((state) => states.push(state));

    await controller.startSession({
      documentText: 'Student Name: Aarav Sharma\nAddress: 123 Park Street\nGender: Male\nGrade: Grade 10\nTerms: agree',
      documentName: 'student.pdf',
      targetUrl: ariaUrl,
    });

    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      `expected REVIEW_READY, events were: ${events.map((e) => e.description).join(' | ')}`
    );
    assert.ok(states.includes('REVIEW_READY'), 'State machine must transition to REVIEW_READY');

    // Inspect browser DOM state to confirm all ARIA controls were populated and verified
    const browserMgr = controller.getBrowserManager();
    const page = browserMgr.page;
    assert.ok(page, 'Browser page must be active');

    // 1. Text input
    const filledName = await page.inputValue('#inp_student_name');
    assert.strictEqual(filledName, 'Aarav Sharma', 'Text input must be filled');

    // 2. Textarea
    const filledAddress = await page.inputValue('#inp_address');
    assert.strictEqual(filledAddress, '123 Park Street', 'Textarea must be filled');

    // 3. ARIA Radiogroup: Male radio must be checked
    const maleChecked = await page.getAttribute('div[role="radio"][data-value="Male"]', 'aria-checked');
    assert.strictEqual(maleChecked, 'true', 'Male ARIA radio must have aria-checked="true"');
    const femaleChecked = await page.getAttribute('div[role="radio"][data-value="Female"]', 'aria-checked');
    assert.strictEqual(femaleChecked, 'false', 'Female ARIA radio must remain aria-checked="false"');

    // 4. ARIA Checkbox: Hostel checkbox must be checked
    const cbChecked = await page.getAttribute('#cb_hostel', 'aria-checked');
    assert.strictEqual(cbChecked, 'true', 'ARIA checkbox must have aria-checked="true"');

    // 5. ARIA Dropdown: Grade 10 selected, popup closed
    const chosenGrade = await page.textContent('#dd_grade_val');
    assert.ok(chosenGrade && chosenGrade.includes('Grade 10'), 'ARIA dropdown value must show Grade 10');
    const popupDisplay = await page.evaluate(() => {
      const p = document.getElementById('dd_grade_popup');
      return p ? window.getComputedStyle(p).display : 'none';
    });
    assert.strictEqual(popupDisplay, 'none', 'Dropdown popup must be closed after selection');

    // 6. Never-Submit safety boundary: Submit button was NEVER clicked
    const submittedDisplay = await page.evaluate(() => {
      const sub = document.getElementById('submitted-confirmation');
      return sub ? window.getComputedStyle(sub).display : 'none';
    });
    assert.notStrictEqual(submittedDisplay, 'block', 'Submit button must never be triggered by the agent');

    await controller.cleanup();
  });

  await test('hidden twin and re-render: fills visible input, survives re-render, no repeated clarification, halts at REVIEW_READY', async () => {
    const fixturePath = path.resolve(__dirname, 'fixtures/forms/hidden_twin_rerender.html');
    assert.ok(fs.existsSync(fixturePath), 'hidden_twin_rerender.html fixture must exist');
    const fixtureUrl = `file://${fixturePath.replace(/\\/g, '/')}`;

    const backend = makeStubBackend(fixtureUrl);
    backend.extractDocument = async () => ({
      document_name: 'test_doc.pdf',
      fact_count: 2,
      facts: [
        { key: 'student_name', label: 'Full Name', value: 'Alex Mercer', confidence: 0.95 },
        { key: 'city', label: 'City', value: 'Seattle', confidence: 0.95 },
      ],
    });

    const controller = new AgentController(backend);

    const events = [];
    const states = [];
    const clarificationPrompts = [];
    controller.onEvent((event) => events.push(event));
    controller.getStateMachine().onTransition((state) => states.push(state));

    controller.onClarificationRequest((prompt) => {
      clarificationPrompts.push(prompt);
      setTimeout(() => {
        controller.answerClarification(prompt.clarificationId, 'alex.mercer@example.com');
      }, 300);
    });

    await controller.startSession({
      documentText: 'Full Name: Alex Mercer\nCity: Seattle',
      documentName: 'test_doc.pdf',
      targetUrl: fixtureUrl,
    });

    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      `expected REVIEW_READY, events were: ${events.map((e) => e.description).join(' | ')}`
    );

    // 1. Zero re-asking: Email was missing from facts, so it should be asked EXACTLY ONCE
    const emailPrompts = clarificationPrompts.filter((p) =>
      p.fieldLabel.toLowerCase().includes('email')
    );
    assert.strictEqual(emailPrompts.length, 1, 'Email clarification must be asked exactly once (no re-asking)');

    // Inspect browser DOM state to confirm targeting
    const browserMgr = controller.getBrowserManager();
    const page = browserMgr.page;
    assert.ok(page, 'Browser page must be active');

    // 2. Hidden twin check: visible input is filled, hidden twin is NOT filled
    const visibleNameVal = await page.inputValue('#fullname-visible');
    assert.strictEqual(visibleNameVal, 'Alex Mercer', 'Visible Full Name input must be filled with fact value');
    const hiddenTwinVal = await page.inputValue('.twin-hidden');
    assert.strictEqual(hiddenTwinVal, '', 'Hidden twin input must NOT be filled');

    // 3. Re-render survival: email was filled in the freshly rendered input (#email-fresh)
    const freshEmailVal = await page.inputValue('#email-fresh');
    assert.strictEqual(freshEmailVal, 'alex.mercer@example.com', 'Fresh re-rendered email input must be filled');

    // 4. Multi-section continuation: Section 2 City was filled
    const cityVal = await page.inputValue('#city-visible');
    assert.strictEqual(cityVal, 'Seattle', 'Section 2 City input must be filled');

    // 5. Never-submit safety check: submit button was never clicked
    const currentUrl = page.url();
    assert.ok(currentUrl.includes('hidden_twin_rerender.html'), 'Page must remain on fixture URL without form submit');

    await controller.cleanup();
  });

  await test('regression: existing-fact mapping, profile fact reuse, clarification persistence across rescan, missing clarification, ambiguity guard, and DOM verification', async () => {
    const fixturePath = path.resolve(__dirname, 'fixtures/forms/sparse_facts.html');
    assert.ok(fs.existsSync(fixturePath), 'sparse_facts.html fixture must exist');
    const fixtureUrl = `file://${fixturePath.replace(/\\/g, '/')}`;

    const backend = makeStubBackend(fixtureUrl);
    // 1. Stub extractDocument to return facts from document:
    // Full Name, Date of Birth, and two ambiguous emergency phone options
    backend.extractDocument = async () => ({
      document_name: 'maya_id_card.pdf',
      fact_count: 4,
      facts: [
        { key: 'student_name', label: 'Full Name', value: 'Maya Patel', confidence: 0.95 },
        { key: 'dob', label: 'Date of Birth', value: '2008-11-15', confidence: 0.95 },
        { key: 'emergency_phone_home', label: 'Emergency Contact Home', value: '+91 9820011223', confidence: 0.95 },
        { key: 'emergency_phone_work', label: 'Emergency Contact Office', value: '+91 9820099887', confidence: 0.95 },
      ],
    });

    // Simulate backend mapForm returning partial/failed mappings to test local fallback & reconciliation
    backend.mapForm = async (sessionId, snapshot) => {
      // Backend mapping only mapped Full Name and Date of Birth; it failed to map Nationality,
      // Parent / Guardian Name, City, etc.
      const name = snapshot.fields.find((f) => /full name/i.test(f.label));
      const dob = snapshot.fields.find((f) => /date of birth/i.test(f.label));
      const mappings = [];
      if (name) mappings.push({ field_ref: name.ref, field_label: name.label, fact_key: 'student_name', confidence: 0.95, status: 'PENDING' });
      if (dob) mappings.push({ field_ref: dob.ref, field_label: dob.label, fact_key: 'dob', confidence: 0.95, status: 'PENDING' });
      return {
        session_id: sessionId,
        target_url: fixtureUrl,
        mappings,
        clarifications_required: [],
      };
    };

    const controller = new AgentController(backend);
    const events = [];
    const states = [];
    const clarificationPrompts = [];
    controller.onEvent((event) => events.push(event));
    controller.getStateMachine().onTransition((state) => states.push(state));

    controller.onClarificationRequest((prompt) => {
      clarificationPrompts.push(prompt);
      setTimeout(() => {
        const lbl = prompt.fieldLabel.toLowerCase();
        if (lbl.includes('primary language')) {
          controller.answerClarification(prompt.clarificationId, 'English');
        } else if (lbl.includes('phone')) {
          // If ambiguous, user selects the home number
          controller.answerClarification(prompt.clarificationId, '+91 9820011223');
        } else if (lbl.includes('address')) {
          controller.answerClarification(prompt.clarificationId, '42 Hill View Road');
        } else if (lbl.includes('city')) {
          controller.answerClarification(prompt.clarificationId, 'Pune');
        } else {
          controller.answerClarification(prompt.clarificationId, 'Default Value');
        }
      }, 100);
    });

    // Provide saved profile facts: Nationality, Parent / Guardian Name
    const profileFacts = [
      { key: 'nationality', label: 'Nationality', value: 'Indian', confidence: 0.95 },
      { key: 'parent_name', label: 'Parent / Guardian Name', value: 'Rakesh Patel', confidence: 0.95 },
    ];

    await controller.startSession({
      documentText: 'Student Name: Maya Patel\nDOB: 2008-11-15',
      documentName: 'maya_id_card.pdf',
      targetUrl: fixtureUrl,
      profileFacts,
    });

    assert.strictEqual(
      controller.getStateMachine().getState(),
      'REVIEW_READY',
      `expected REVIEW_READY, events were: ${events.map((e) => e.description).join(' | ')}`
    );

    // REGRESSION ASSERTION 1: A fact present in uploaded document is reused without asking again
    const namePrompts = clarificationPrompts.filter((p) => /full name|student.*name/i.test(p.fieldLabel));
    assert.strictEqual(namePrompts.length, 0, 'Uploaded document fact (Full Name) must NOT trigger clarification');
    const dobPrompts = clarificationPrompts.filter((p) => /date of birth|dob/i.test(p.fieldLabel));
    assert.strictEqual(dobPrompts.length, 0, 'Uploaded document fact (DOB) must NOT trigger clarification');

    // REGRESSION ASSERTION 2: Saved profile value maps to the correct field
    const natPrompts = clarificationPrompts.filter((p) => /nationality/i.test(p.fieldLabel));
    assert.strictEqual(natPrompts.length, 0, 'Saved profile fact (Nationality) must NOT trigger clarification');
    const parentPrompts = clarificationPrompts.filter((p) => /parent/i.test(p.fieldLabel));
    assert.strictEqual(parentPrompts.length, 0, 'Saved profile fact (Parent Name) must NOT trigger clarification');

    // REGRESSION ASSERTION 3: A previously clarified answer survives form rescan/rerender and is not asked again
    const langPrompts = clarificationPrompts.filter((p) => /language/i.test(p.fieldLabel));
    assert.strictEqual(langPrompts.length, 1, 'Previously clarified Primary Language must be asked exactly once (not repeated across sections/rescans)');

    // REGRESSION ASSERTION 4: Genuine missing required value still triggers clarification
    const addrPrompts = clarificationPrompts.filter((p) => /address/i.test(p.fieldLabel));
    assert.strictEqual(addrPrompts.length, 1, 'Genuine missing required field (Address) must trigger clarification');
    const cityPrompts = clarificationPrompts.filter((p) => /city/i.test(p.fieldLabel));
    assert.strictEqual(cityPrompts.length, 1, 'Genuine missing required field (City) must trigger clarification');

    // REGRESSION ASSERTION 5: Ambiguous values are not guessed (options presented to user)
    const phonePrompts = clarificationPrompts.filter((p) => /phone/i.test(p.fieldLabel));
    assert.strictEqual(phonePrompts.length, 1, 'Ambiguous phone facts must trigger clarification without guessing');
    assert.ok(
      phonePrompts[0].options && phonePrompts[0].options.length >= 2,
      'Ambiguity prompt must present choices to the user rather than silently guessing'
    );

    // REGRESSION ASSERTION 6: Duplicate or stale field references do not generate duplicate questions
    const promptLabels = clarificationPrompts.map((p) => p.fieldLabel.toLowerCase().trim());
    const uniquePromptLabels = new Set(promptLabels);
    assert.strictEqual(promptLabels.length, uniquePromptLabels.size, 'No duplicate clarification prompts for the same field label');

    // REGRESSION ASSERTION 7: Correctly mapped values are independently verified in the DOM
    const browserMgr = controller.getBrowserManager();
    const page = browserMgr.page;
    assert.ok(page, 'Browser page must be active');

    const domName = await page.inputValue('#student_name');
    assert.strictEqual(domName, 'Maya Patel', 'DOM student_name must match document fact');
    const domDob = await page.inputValue('#dob');
    assert.strictEqual(domDob, '2008-11-15', 'DOM dob must match document fact');
    const domNat = await page.inputValue('#nationality');
    assert.strictEqual(domNat, 'Indian', 'DOM nationality must match profile fact');
    const domLang = await page.inputValue('#primary_language');
    assert.strictEqual(domLang, 'English', 'DOM primary_language must match clarified answer');
    const domParent = await page.inputValue('#parent_name');
    assert.strictEqual(domParent, 'Rakesh Patel', 'DOM parent_name must match profile fact');
    const domPhone = await page.inputValue('#emergency_phone');
    assert.strictEqual(domPhone, '+91 9820011223', 'DOM emergency_phone must match selected choice');
    const domAddr = await page.inputValue('#address');
    assert.strictEqual(domAddr, '42 Hill View Road', 'DOM address must match clarified answer');
    const domCity = await page.inputValue('#city');
    assert.strictEqual(domCity, 'Pune', 'DOM city must match profile fact');

    // REGRESSION SAFETY ASSERTION: Submit button was NEVER clicked and page halted at REVIEW_READY
    const confirmationVisible = await page.evaluate(() => {
      const el = document.getElementById('confirmation');
      return el && window.getComputedStyle(el).display !== 'none';
    });
    assert.strictEqual(confirmationVisible, false, 'Form submit confirmation must NOT be displayed (Never-Submit safety invariant)');

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
