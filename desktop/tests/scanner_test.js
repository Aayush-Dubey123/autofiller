/**
 * Automated test for FormScanner and BrowserManager submission detection using Playwright Chromium.
 * 
 * Verifies:
 * 1. Correct extraction of fields from mock HTML form into FormSnapshot.
 * 2. Complete exclusion of submit button from FormSnapshot fields.
 * 3. Separate detection of real submit controls by BrowserManager.scanSubmissionControls().
 */

const path = require('path');
const assert = require('assert');

const DIST = path.resolve(__dirname, '../dist-electron');
const { BrowserManager } = require(path.join(DIST, 'browser/BrowserManager'));

const fs = require('fs');

async function runScannerTest() {
  console.log('Running FormScanner & BrowserManager submission controls Playwright test...');
  const browserManager = new BrowserManager();
  await browserManager.launch(true);

  const fixturePath = [
    path.resolve(__dirname, '../public/mock_school_form.html'),
    path.resolve(__dirname, '../../test-fixtures/mock_school_form.html'),
  ].find(p => fs.existsSync(p)) || path.resolve(__dirname, '../public/mock_school_form.html');
  const fileUrl = `file://${fixturePath.replace(/\\/g, '/')}`;

  await browserManager.navigateTo(fileUrl);

  const snapshot = await browserManager.scanActiveForm();
  console.log(`Discovered ${snapshot.fields.length} form fields in FormSnapshot.`);
  assert.ok(snapshot.fields.length >= 10, 'Expected at least 10 form fields');

  // Verify Student Name
  const nameField = snapshot.fields.find((f) => /student.*name|full.*name/i.test(f.label));
  assert.ok(nameField, 'studentName field must be detected');
  assert.strictEqual(nameField.required, true);

  // Verify submit button is NOT included in FormSnapshot fields
  const submitInFields = snapshot.fields.find(
    (f) => f.type === 'submit' || f.ref === 'submitBtn' || /^submit(\s+application)?$/i.test(f.label.trim())
  );
  assert.strictEqual(submitInFields, undefined, 'Submit button must NOT be in FormSnapshot fields');

  // Verify BrowserManager detects real submit controls separately from fillable fields
  const submissionControls = await browserManager.scanSubmissionControls();
  console.log(`Discovered ${submissionControls.length} submission control(s):`, submissionControls);
  const realSubmitControls = submissionControls.filter((c) => c.isSubmitType || /submit/i.test(c.label));
  assert.ok(realSubmitControls.length >= 1, 'Expected at least 1 submit type control on mock form');
  assert.strictEqual(realSubmitControls[0].isSubmitType, true);

  await browserManager.close();
  console.log('✓ FormScanner & submission controls test passed successfully!');
}

runScannerTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
