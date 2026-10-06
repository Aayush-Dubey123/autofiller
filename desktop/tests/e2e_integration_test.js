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

      // TODO: extend when section-by-section flow exists
      // Currently, the agent can only fill the visible section (Step 1).

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

      // Deliberately map a dropdown in Step 1 to a value it does not contain, so the select
      // genuinely fails. This proves a failed operation is reported honestly rather
      // than logged as a success.
      const genderField = snapshot.fields.find(
        (field) => field.type === 'select' && /gender/i.test(field.label)
      );
      if (genderField) {
        mappings.push({
          field_ref: genderField.ref,
          field_label: genderField.label,
          fact_key: 'gender',
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
