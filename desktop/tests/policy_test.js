/**
 * Automated tests asserting AutoFiller security boundaries and agent-loop behaviour.
 *
 * These tests exercise the real compiled source in `dist-electron`, which the build
 * step regenerates, rather than any hand-maintained duplicate of the logic.
 */

const assert = require('assert');
const path = require('path');

const DIST = path.resolve(__dirname, '../dist-electron');
const { PolicyEngine } = require(path.join(DIST, 'policy/PolicyEngine'));

let passed = 0;

/**
 * Run a single named assertion block and count it when it succeeds.
 *
 * @param {string} name Human readable test name.
 * @param {() => void} body Assertion body.
 */
function test(name, body) {
  try {
    body();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (error) {
    console.error(`  FAIL - ${name}`);
    throw error;
  }
}

function runPolicyTests() {
  console.log('Running AutoFiller PolicyEngine tests against dist-electron...');
  const policy = new PolicyEngine();

  test('blocks Submit Application', () => {
    const result = policy.validateBrowserAction('click', 'Submit Application');
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.code, 'DENIED_FINAL_SUBMISSION');
  });

  test('blocks Submit', () => {
    const result = policy.validateBrowserAction('click', 'Submit');
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.code, 'DENIED_FINAL_SUBMISSION');
  });

  test('blocks Apply Now', () => {
    const result = policy.validateBrowserAction('click', 'Apply Now');
    assert.strictEqual(result.allowed, false);
  });

  test('blocks any structural submit control', () => {
    const result = policy.validateBrowserAction('click', 'Send', true);
    assert.strictEqual(result.allowed, false);
    assert.strictEqual(result.code, 'DENIED_FINAL_SUBMISSION');
  });

  test('allows wizard pagination buttons', () => {
    assert.strictEqual(policy.validateBrowserAction('click', 'Next').code, 'ALLOWED_PAGINATION');
    assert.strictEqual(policy.validateBrowserAction('click', 'Continue').code, 'ALLOWED_PAGINATION');
    assert.strictEqual(
      policy.validateBrowserAction('click', 'Save & Continue').code,
      'ALLOWED_PAGINATION'
    );
  });

  test('blocks extended checkout and submission buttons', () => {
    const forbiddenLabels = [
      'Place Order',
      'place order',
      'Finish Application',
      'finish application',
      'Register Now',
      'register now',
      'Continue to Payment',
      'Complete Order',
      'Complete Registration',
      'Proceed to Payment',
    ];
    for (const label of forbiddenLabels) {
      const result = policy.validateBrowserAction('click', label);
      assert.strictEqual(result.allowed, false, `${label} must be blocked`);
      assert.strictEqual(
        result.code,
        'DENIED_FINAL_SUBMISSION',
        `${label} must return DENIED_FINAL_SUBMISSION`
      );
    }
  });

  test('never treats a submission control as pagination', () => {
    assert.strictEqual(policy.isPaginationButton('Submit'), false);
    assert.strictEqual(policy.isFinalSubmissionButton('Submit Application'), true);
  });

  test('refuses unregistered and shell-like tools', () => {
    for (const name of ['execute_shell', 'execute_javascript', 'run_command', 'write_arbitrary_file']) {
      const result = policy.validateToolInvocation(name);
      assert.strictEqual(result.allowed, false, `${name} must be refused`);
      assert.strictEqual(result.code, 'TOOL_NOT_PERMITTED');
    }
  });

  test('permits registered read-only tools', () => {
    assert.strictEqual(policy.validateToolInvocation('inspect_form').allowed, true);
    assert.strictEqual(policy.validateToolInvocation('verify_field').allowed, true);
    assert.strictEqual(policy.validateToolInvocation('request_clarification').allowed, true);
  });

  test('refuses mutating tools without a validated field reference', () => {
    const missing = policy.validateToolInvocation('fill_text', {});
    assert.strictEqual(missing.allowed, false);
    assert.strictEqual(missing.code, 'INVALID_FIELD_REFERENCE');

    const arbitrary = policy.validateToolInvocation('fill_text', { fieldRef: '#injection' });
    assert.strictEqual(arbitrary.allowed, false);

    const valid = policy.validateToolInvocation('fill_text', { fieldRef: 'field_007' });
    assert.strictEqual(valid.allowed, true);
  });

  test('derives submission detection from real page controls', () => {
    const blocked = policy.evaluateSubmissionControls([
      { label: 'Student Name', selector: 'field_001', isSubmitType: false },
      { label: 'Submit Application', selector: 'btn', isSubmitType: true, type: 'submit' },
    ]);
    assert.strictEqual(blocked.allowed, false);
    assert.strictEqual(blocked.code, 'DENIED_FINAL_SUBMISSION');
    assert.strictEqual(blocked.controls.length, 1);

    const clean = policy.evaluateSubmissionControls([
      { label: 'Student Name', selector: 'field_001', isSubmitType: false },
    ]);
    assert.strictEqual(clean.allowed, true);
    assert.strictEqual(clean.code, 'NO_SUBMISSION_CONTROL');
  });

  test('treats buttons without explicit type as submit controls', () => {
    const defaultBtn = policy.evaluateSubmissionControls([
      { label: 'Save & Send', selector: '#btn1', isSubmitType: true, type: 'submit' },
    ]);
    assert.strictEqual(defaultBtn.allowed, false);
    assert.strictEqual(defaultBtn.code, 'DENIED_FINAL_SUBMISSION');
    assert.strictEqual(defaultBtn.controls.length, 1);
  });

  test('does NOT treat type="button" and type="reset" as final submission controls', () => {
    const nonSubmitControls = policy.evaluateSubmissionControls([
      { label: 'Submit Draft', selector: '#btnDraft', isSubmitType: false, type: 'button' },
      { label: 'Reset / Submit Again', selector: '#btnReset', isSubmitType: false, type: 'reset' },
    ]);
    assert.strictEqual(nonSubmitControls.allowed, true);
    assert.strictEqual(nonSubmitControls.code, 'NO_SUBMISSION_CONTROL');
    assert.strictEqual(nonSubmitControls.controls.length, 0);
  });

  test('treats input[type="submit"] and input[type="image"] as submit controls', () => {
    const imageSubmit = policy.evaluateSubmissionControls([
      { label: 'Pay & Submit', selector: '#imgBtn', isSubmitType: true, type: 'image' },
    ]);
    assert.strictEqual(imageSubmit.allowed, false);
    assert.strictEqual(imageSubmit.code, 'DENIED_FINAL_SUBMISSION');

    const inputSubmit = policy.evaluateSubmissionControls([
      { label: 'Submit', selector: '#inSubmit', isSubmitType: true, type: 'submit' },
    ]);
    assert.strictEqual(inputSubmit.allowed, false);
    assert.strictEqual(inputSubmit.code, 'DENIED_FINAL_SUBMISSION');
  });

  test('denies cross-host navigation', () => {
    const denied = policy.validateNavigation('school.edu', 'https://evil.example.com/steal');
    assert.strictEqual(denied.allowed, false);
    assert.strictEqual(denied.code, 'EXTERNAL_NAVIGATION_DENIED');

    const allowed = policy.validateNavigation('school.edu', 'https://school.edu/step2');
    assert.strictEqual(allowed.allowed, true);
  });

  test('restricts navigation protocols to http, https, and file; denies javascript, data, blob, and others', () => {
    // javascript: protocol
    const jsDenied = policy.validateNavigation('school.edu', 'javascript:alert(1)');
    assert.strictEqual(jsDenied.allowed, false);
    assert.strictEqual(jsDenied.code, 'PROTOCOL_NOT_PERMITTED');

    // data: protocol
    const dataDenied = policy.validateNavigation('school.edu', 'data:text/html,<h1>Malicious</h1>');
    assert.strictEqual(dataDenied.allowed, false);
    assert.strictEqual(dataDenied.code, 'PROTOCOL_NOT_PERMITTED');

    // blob: protocol
    const blobDenied = policy.validateNavigation('school.edu', 'blob:https://school.edu/a1b2c3d4');
    assert.strictEqual(blobDenied.allowed, false);
    assert.strictEqual(blobDenied.code, 'PROTOCOL_NOT_PERMITTED');

    // other disallowed protocols
    const ftpDenied = policy.validateNavigation('school.edu', 'ftp://school.edu/file.txt');
    assert.strictEqual(ftpDenied.allowed, false);
    assert.strictEqual(ftpDenied.code, 'PROTOCOL_NOT_PERMITTED');

    // allowed protocols
    const httpAllowed = policy.validateNavigation('school.edu', 'http://school.edu/form');
    assert.strictEqual(httpAllowed.allowed, true);
    assert.strictEqual(httpAllowed.code, 'NAVIGATION_ALLOWED');

    const httpsAllowed = policy.validateNavigation('school.edu', 'https://school.edu/form');
    assert.strictEqual(httpsAllowed.allowed, true);
    assert.strictEqual(httpsAllowed.code, 'NAVIGATION_ALLOWED');

    const fileAllowed = policy.validateNavigation('', 'file:///C:/Users/aayus/autofiller/desktop/public/mock_school_form.html');
    assert.strictEqual(fileAllowed.allowed, true);
    assert.strictEqual(fileAllowed.code, 'NAVIGATION_ALLOWED');
  });

  test('AgentController and BrowserManager do not provide programmatic submit execution', () => {
    const { AgentController } = require(path.join(DIST, 'agent/AgentController'));
    const { BrowserManager } = require(path.join(DIST, 'browser/BrowserManager'));
    assert.strictEqual(
      typeof AgentController.prototype.submitFormAsOperator,
      'undefined',
      'AgentController must not expose submitFormAsOperator'
    );
    assert.strictEqual(
      typeof BrowserManager.prototype.submitFormManually,
      'undefined',
      'BrowserManager must not expose submitFormManually'
    );
  });

  console.log(`\nAll ${passed} PolicyEngine assertions passed.`);
}

runPolicyTests();
