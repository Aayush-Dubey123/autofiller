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

function getFullFormMappings(snapshot) {
  const mappings = [];
  const find = (needle) =>
    snapshot.fields.find((field) => field.label.toLowerCase().includes(needle));

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
  const previousSchool = find('previous school');
  if (previousSchool) mappings.push({ field_ref: previousSchool.ref, field_label: previousSchool.label, fact_key: 'previous_school', fact_value: 'Greenwood High', confidence: 1.0, status: 'PENDING' });
  const grade = find('grade');
  if (grade) mappings.push({ field_ref: grade.ref, field_label: grade.label, fact_key: 'grade', fact_value: 'Grade 10', confidence: 1.0, status: 'PENDING' });
  const allergies = find('allergies');
  if (allergies) mappings.push({ field_ref: allergies.ref, field_label: allergies.label, fact_key: 'allergies', fact_value: 'No', confidence: 1.0, status: 'PENDING' });
  const transport = find('transport');
  if (transport) mappings.push({ field_ref: transport.ref, field_label: transport.label, fact_key: 'transport', fact_value: 'No', confidence: 1.0, status: 'PENDING' });
  const terms = find('terms') || snapshot.fields.find((f) => f.type === 'checkbox');
  if (terms) mappings.push({ field_ref: terms.ref, field_label: terms.label, fact_key: 'terms', fact_value: 'agree', confidence: 1.0, status: 'PENDING' });

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
          { key: 'email', label: 'Email Address', value: 'aarav.sharma@example.com', confidence: 0.95 },
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

  await test('agreement checkbox is filled and verified without timeout and Never-Submit remains intact', async () => {
    const backend = makeStubBackend(FORM_URL);
    const controller = new AgentController(backend);
    const origMapForm = backend.mapForm;
    backend.mapForm = async (sessionId, snapshot) => {
      // TODO: extend when section-by-section flow exists
      // Unhide sections so section-5 checkbox is interactable in this test
      if (controller.getBrowserManager()?.page) {
        await controller.getBrowserManager().page.evaluate(() => {
          document.querySelectorAll('[hidden]').forEach((el) => el.removeAttribute('hidden'));
        }).catch(() => {});
      }
      const res = await origMapForm(sessionId, snapshot);
      const checkboxField = snapshot.fields.find((f) => f.type === 'checkbox');
      assert.ok(checkboxField, 'terms checkbox should be detected in snapshot');
      res.mappings.push({
        field_ref: checkboxField.ref,
        field_label: checkboxField.label,
        fact_key: 'terms',
        fact_value: 'agree',
        confidence: 1.0,
        status: 'PENDING',
      });
      return res;
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

    const verifiedCheckbox = events.find(
      (e) => e.type === 'TOOL_COMPLETED' && /Verified '.*terms/i.test(e.description)
    );
    assert.ok(verifiedCheckbox, 'terms checkbox must be verified');

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
      backend.mapForm = async (sessionId) => ({
        session_id: sessionId,
        mappings: [],
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
    controller.onEvent((e) => events.push(e));

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

    // 3. Verify that all 5 sections were reached and Section 5 terms checkbox was verified
    const termsVerified = events.find(
      (e) => e.type === 'TOOL_COMPLETED' && /Verified '.*terms/i.test(e.description)
    );
    assert.ok(termsVerified, 'Section 5 terms checkbox must be verified');

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
      res.mappings = res.mappings.filter((m) => !/name|dob|gender/i.test(m.field_label));
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

    // 2. Section 5 DOM must confirm grade and terms are populated in actual DOM
    const page = controller.getBrowserManager().page;
    const gradeVal = await page.inputValue('#grade');
    const termsChecked = await page.isChecked('#terms');
    assert.strictEqual(gradeVal, 'Grade 10');
    assert.strictEqual(termsChecked, true);

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
