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
  const visibleCount = snapshot.fields.filter((f) => f.visible).length;
  const hiddenCount = snapshot.fields.filter((f) => !f.visible).length;
  console.log(`Discovered ${snapshot.fields.length} form fields in FormSnapshot (${visibleCount} visible, ${hiddenCount} hidden).`);
  assert.strictEqual(snapshot.fields.length, 16, 'Expected exactly 16 form fields');

  // Verify Student Name
  const nameField = snapshot.fields.find((f) => /student.*name|full.*name/i.test(f.label));
  assert.ok(nameField, 'studentName field must be detected');
  assert.strictEqual(nameField.required, true);

  // Verify submit button is NOT included in FormSnapshot fields
  const submitInFields = snapshot.fields.find(
    (f) => f.type === 'submit' || f.ref === 'submitBtn' || /^submit(\s+application)?$/i.test(f.label.trim())
  );
  assert.strictEqual(submitInFields, undefined, 'Submit button must NOT be in FormSnapshot fields');

  // Unhide all sections so scanSubmissionControls can discover controls across step sections
  await browserManager.page.evaluate(() => {
    document.querySelectorAll('[hidden]').forEach((el) => el.removeAttribute('hidden'));
  });

  // Verify BrowserManager detects real submit controls separately from fillable fields
  const submissionControls = await browserManager.scanSubmissionControls();
  console.log(`Discovered ${submissionControls.length} submission control(s):`, submissionControls);
  const realSubmitControls = submissionControls.filter((c) => c.isSubmitType || /submit/i.test(c.label));
  assert.ok(realSubmitControls.length >= 1, 'Expected at least 1 submit type control on mock form');
  assert.strictEqual(realSubmitControls[0].isSubmitType, true);

  await browserManager.close();

  // Test Honeypot Protection: Exclude genuinely hidden traps while preserving legitimate controls
  console.log('\nRunning Honeypot protection tests on honeypot_safety.html fixture...');
  const honeypotManager = new BrowserManager();
  await honeypotManager.launch(true);

  const hpFixturePath = path.resolve(__dirname, 'fixtures/forms/honeypot_safety.html');
  assert.ok(fs.existsSync(hpFixturePath), 'honeypot_safety.html fixture must exist');
  const hpUrl = `file://${hpFixturePath.replace(/\\/g, '/')}`;
  await honeypotManager.navigateTo(hpUrl);

  const hpSnapshot = await honeypotManager.scanActiveForm();

  // 1. Genuinely hidden honeypot fields must be excluded from fill candidates
  const trapFields = hpSnapshot.fields.filter((f) => f.isHoneypot || !f.visible);
  console.log(`Discovered ${trapFields.length} suppressed trap/hidden field(s).`);
  assert.strictEqual(trapFields.length, 3, 'Expected exactly 3 honeypot trap fields');

  const websiteTrap = hpSnapshot.fields.find((f) => f.ref === 'field_001' || /website/i.test(f.label));
  assert.ok(websiteTrap, 'hp_website trap must be observed in DOM snapshot');
  assert.strictEqual(websiteTrap.isHoneypot, true, 'hp_website must be flagged as honeypot');
  assert.strictEqual(websiteTrap.visible, false, 'hp_website must not be visible/candidate');

  const faxTrap = hpSnapshot.fields.find((f) => /fax/i.test(f.label));
  assert.ok(faxTrap, 'hp_fax trap must be observed in DOM snapshot');
  assert.strictEqual(faxTrap.isHoneypot, true, 'hp_fax must be flagged as honeypot');
  assert.strictEqual(faxTrap.visible, false, 'hp_fax must not be visible/candidate');

  const companyTrap = hpSnapshot.fields.find((f) => /company/i.test(f.label));
  assert.ok(companyTrap, 'hp_company trap must be observed in DOM snapshot');
  assert.strictEqual(companyTrap.isHoneypot, true, 'hp_company must be flagged as honeypot');
  assert.strictEqual(companyTrap.visible, false, 'hp_company must not be visible/candidate');

  // 2. Legitimate controls must remain candidate fields (visible: true, isHoneypot: false)
  const legitimateFillCandidates = hpSnapshot.fields.filter(
    (f) => f.visible && !f.disabled && !f.isHoneypot
  );
  console.log(`Discovered ${legitimateFillCandidates.length} legitimate fill candidates.`);
  assert.strictEqual(legitimateFillCandidates.length, 5, 'Expected exactly 5 legitimate fields');

  const fullNameField = legitimateFillCandidates.find((f) => /full.*name/i.test(f.label));
  assert.ok(fullNameField, 'Full Name must be a legitimate fill candidate');
  assert.strictEqual(fullNameField.required, true);

  const emailField = legitimateFillCandidates.find((f) => /email/i.test(f.label));
  assert.ok(emailField, 'Email must be a legitimate fill candidate');

  const phoneField = legitimateFillCandidates.find((f) => /phone/i.test(f.label));
  assert.ok(phoneField, 'Phone must be a legitimate fill candidate');

  const subjectField = legitimateFillCandidates.find((f) => /subject/i.test(f.label));
  assert.ok(subjectField, 'Subject must be a legitimate fill candidate');

  const messageField = legitimateFillCandidates.find((f) => /message/i.test(f.label));
  assert.ok(messageField, 'Message must be a legitimate fill candidate');

  await honeypotManager.close();

  // 3. Test preservation of legitimate controls with tabindex=-1, aria-hidden, or off-screen positioning
  console.log('\nRunning legitimate controls test (tabindex=-1, aria-hidden, off-screen custom controls)...');
  const customControlsManager = new BrowserManager();
  await customControlsManager.launch(true);

  // Load custom_radio_checkbox.html (which uses visually-hidden off-screen inputs with visible labels)
  const customFixturePath = path.resolve(__dirname, 'fixtures/forms/custom_radio_checkbox.html');
  assert.ok(fs.existsSync(customFixturePath), 'custom_radio_checkbox.html fixture must exist');
  const customUrl = `file://${customFixturePath.replace(/\\/g, '/')}`;
  await customControlsManager.navigateTo(customUrl);

  const customSnapshot = await customControlsManager.scanActiveForm();
  const customCandidates = customSnapshot.fields.filter((f) => f.visible && !f.isHoneypot);
  console.log(`Discovered ${customCandidates.length} candidates in custom controls fixture.`);
  // All 4 fields (applicant_name, newsletter checkbox, meal_pref radio, special_notes) are preserved
  assert.strictEqual(customCandidates.length, 4, 'All 4 controls in custom controls fixture must be preserved as fill candidates');

  // Inject additional test controls dynamically into the page to specifically assert tabindex=-1 and aria-hidden
  await customControlsManager.page.evaluate(() => {
    const form = document.querySelector('form');
    // Legitimate field with tabindex="-1" and on-screen visible label
    const div1 = document.createElement('div');
    div1.innerHTML = '<label for="legit_tabindex">Date Override</label><input type="text" id="legit_tabindex" name="legit_tabindex" tabindex="-1">';
    form.appendChild(div1);

    // Legitimate field inside aria-hidden decorative wrapper but with visible human label
    const div2 = document.createElement('div');
    div2.innerHTML = '<div aria-hidden="true"><label for="legit_aria_hidden">Reference Number</label><input type="text" id="legit_aria_hidden" name="legit_aria_hidden"></div>';
    form.appendChild(div2);
  });

  const injectedSnapshot = await customControlsManager.scanActiveForm();
  const tabindexField = injectedSnapshot.fields.find((f) => /Date Override/i.test(f.label));
  assert.ok(tabindexField, 'tabindex=-1 control must be discovered');
  assert.strictEqual(tabindexField.visible, true, 'tabindex=-1 legitimate control must be visible');
  assert.strictEqual(Boolean(tabindexField.isHoneypot), false, 'tabindex=-1 legitimate control must NOT be honeypot');

  const ariaField = injectedSnapshot.fields.find((f) => /Reference Number/i.test(f.label));
  assert.ok(ariaField, 'aria-hidden control must be discovered');
  assert.strictEqual(ariaField.visible, true, 'aria-hidden legitimate control must be visible');
  assert.strictEqual(Boolean(ariaField.isHoneypot), false, 'aria-hidden legitimate control must NOT be honeypot');

  await customControlsManager.close();

  // 4. Test detectBlocker unit checks with CAPTCHA, OTP, Login, and No-form snippets
  console.log('\nRunning detectBlocker unit checks for CAPTCHA, OTP, Login, and No-form...');
  const blockerManager = new BrowserManager();
  await blockerManager.launch(true);
  const blockerPage = blockerManager.page;

  // 4a. CAPTCHA snippets
  console.log('  Testing CAPTCHA detection...');
  // reCAPTCHA iframe
  await blockerPage.setContent('<html><body><iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe></body></html>');
  let result = await blockerManager.detectBlocker(0);
  assert.strictEqual(result.type, 'captcha', 'reCAPTCHA iframe must be detected as captcha');

  // hCaptcha element
  await blockerPage.setContent('<html><body><div class="h-captcha" data-sitekey="xyz"></div><iframe src="https://assets.hcaptcha.com/check"></iframe></body></html>');
  result = await blockerManager.detectBlocker(0);
  assert.strictEqual(result.type, 'captcha', 'hCaptcha must be detected as captcha');

  // Cloudflare Turnstile
  await blockerPage.setContent('<html><body><iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile"></iframe></body></html>');
  result = await blockerManager.detectBlocker(0);
  assert.strictEqual(result.type, 'captcha', 'Cloudflare Turnstile must be detected as captcha');

  // 4b. OTP snippets
  console.log('  Testing OTP detection...');
  // input with autocomplete="one-time-code"
  await blockerPage.setContent('<html><body><input type="text" autocomplete="one-time-code"></body></html>');
  result = await blockerManager.detectBlocker(0);
  assert.strictEqual(result.type, 'otp', 'autocomplete="one-time-code" must be detected as otp');

  // input with verification code label
  await blockerPage.setContent('<html><body><label for="code">Enter Verification Code</label><input type="text" id="code"></body></html>');
  result = await blockerManager.detectBlocker(0);
  assert.strictEqual(result.type, 'otp', 'Verification Code label must be detected as otp');

  // input with name="otp"
  await blockerPage.setContent('<html><body><input type="text" name="otp" placeholder="Code"></body></html>');
  result = await blockerManager.detectBlocker(0);
  assert.strictEqual(result.type, 'otp', 'name="otp" input must be detected as otp');

  // 4c. Login detection
  console.log('  Testing Login detection...');
  await blockerPage.setContent('<html><body><form><input type="text" name="user"><input type="password" name="pass"></form></body></html>');
  result = await blockerManager.detectBlocker(0);
  assert.strictEqual(result.type, 'login', 'Visible password field must be detected as login');

  // 4d. No-form detection
  console.log('  Testing No-form detection...');
  await blockerPage.setContent('<html><body><h1>Welcome to Portal</h1><p>No inputs here</p></body></html>');
  result = await blockerManager.detectBlocker(0);
  assert.strictEqual(result.type, 'no-form', 'Page with no fillable fields must be detected as no-form');

  // 4e. Normal form detection (type === 'none')
  console.log('  Testing Normal form detection...');
  await blockerPage.setContent('<html><body><form><input type="text" name="student_name" placeholder="Full Name"><button type="submit">Submit</button></form></body></html>');
  result = await blockerManager.detectBlocker(0);
  assert.strictEqual(result.type, 'none', 'Page with fillable fields and no blockers must be detected as none');

  // 5. Test Safety Guard in fill path: never fill password, OTP, or CAPTCHA fields
  console.log('\nRunning fill path safety guard tests...');
  await blockerPage.setContent(`
    <html>
      <body>
        <form>
          <input type="password" id="secret_pass" name="secret_pass">
          <input type="text" id="sec_code" name="verification_code" autocomplete="one-time-code">
          <input type="text" id="plain_name" name="plain_name">
        </form>
      </body>
    </html>
  `);

  // Scan form: FormScanner must exclude password and one-time-code from FormSnapshot
  const safetySnapshot = await blockerManager.scanActiveForm();
  assert.strictEqual(safetySnapshot.fields.length, 1, 'FormScanner must strictly exclude password and OTP fields');
  assert.strictEqual(safetySnapshot.fields[0].ref, 'field_001');

  // If BrowserManager.fillText is attempted on a protected field directly, it must throw a SafetyGuard error
  let threwPasswordGuard = false;
  try {
    // Manually register field pointing to password
    blockerManager.scanner.selectorMap?.set('field_pwd', '#secret_pass');
    blockerManager.scanner.locatorMap?.set('field_pwd', blockerPage.locator('#secret_pass'));
    await blockerManager.fillText('field_pwd', 'Secret123!');
  } catch (err) {
    if (err.message && err.message.includes('[SafetyGuard]')) {
      threwPasswordGuard = true;
    }
  }
  assert.strictEqual(threwPasswordGuard, true, 'fillText must refuse to fill password field with [SafetyGuard]');

  let threwOtpGuard = false;
  try {
    blockerManager.scanner.selectorMap?.set('field_otp', '#sec_code');
    blockerManager.scanner.locatorMap?.set('field_otp', blockerPage.locator('#sec_code'));
    await blockerManager.fillText('field_otp', '123456');
  } catch (err) {
    if (err.message && err.message.includes('[SafetyGuard]')) {
      threwOtpGuard = true;
    }
  }
  assert.strictEqual(threwOtpGuard, true, 'fillText must refuse to fill OTP field with [SafetyGuard]');

  // 6. Test unblockReadiness immediate release
  console.log('\nRunning unblockReadiness test...');
  const waitPromise = blockerManager.waitUntilReady();
  blockerManager.unblockReadiness();
  const waitResult = await waitPromise;
  assert.ok(waitResult, 'unblockReadiness must release waitUntilReady immediately');

  // 7. Test ARIA role custom controls detection in getFormReadinessState
  console.log('\nRunning custom ARIA controls readiness check...');
  await blockerPage.setContent('<html><body><div role="textbox" aria-label="Comment">Hello</div><div role="radio" aria-label="Option 1"></div></body></html>');
  const customResult = await blockerManager.detectBlocker(0);
  assert.strictEqual(customResult.type, 'none', 'Page with custom ARIA controls must be recognized as fillable form');

  // 8. Regression Defect A: Hydration Readiness (delayed mounting with condition retry)
  console.log('\nRunning Defect A regression: Hydration readiness delayed mounting...');
  await blockerPage.setContent('<html><body><div id="mount-target"><h1>Hydrating form...</h1></div></body></html>');
  // Delayed mount after 250ms
  await blockerPage.evaluate(() => {
    setTimeout(() => {
      const el = document.getElementById('mount-target');
      if (el) {
        el.innerHTML = '<input type="text" name="delayed_name" placeholder="Full Name">';
      }
    }, 250);
  });
  const delayedResult = await blockerManager.detectBlocker(2000);
  assert.strictEqual(delayedResult.type, 'none', 'Delayed mounting within bounded wait must resolve to none (fillable)');

  // Bounded timeout without fields mounts resolves to zero_fillable_fields no-form
  await blockerPage.setContent('<html><body><h1>Static page without forms</h1></body></html>');
  const neverMountedResult = await blockerManager.detectBlocker(300);
  assert.strictEqual(neverMountedResult.type, 'no-form', 'When fields never mount, detectBlocker must conclude no-form');
  assert.strictEqual(neverMountedResult.matchedRule, 'zero_fillable_fields');

  // 9. Regression Defect B: Authentication Gate (independent of token count and password presence)
  console.log('\nRunning Defect B regression: Authentication gate independent of token count...');
  await blockerPage.route('https://accounts.google.com/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `
        <!DOCTYPE html>
        <html>
          <head><title>Sign in - Google Accounts</title></head>
          <body>
            <h1>Sign in</h1>
            <form>
              <input type="email" name="identifier" id="identifierId" aria-label="Email or phone">
              <select name="lang"><option value="en">English</option></select>
            </form>
          </body>
        </html>
      `,
    });
  });

  await blockerPage.goto('https://accounts.google.com/v3/signin/identifier');
  const authGateResult = await blockerManager.detectBlocker(0);
  assert.strictEqual(authGateResult.type, 'login', 'accounts.google.com must be detected as login blocker');
  assert.strictEqual(authGateResult.matchedRule, 'known_login_host', 'matchedRule must be known_login_host');
  assert.strictEqual(authGateResult.triggerElementOrHost, 'accounts.google.com');

  await blockerManager.close();

  // 10. Test ARIA custom controls discovery on aria_controls.html fixture
  console.log('\nRunning ARIA custom controls scanner discovery on aria_controls.html fixture...');
  const ariaScannerManager = new BrowserManager();
  await ariaScannerManager.launch(true);

  const ariaFixturePath = path.resolve(__dirname, 'fixtures/forms/aria_controls.html');
  assert.ok(fs.existsSync(ariaFixturePath), 'aria_controls.html fixture must exist');
  const ariaUrl = `file://${ariaFixturePath.replace(/\\/g, '/')}`;
  await ariaScannerManager.navigateTo(ariaUrl);

  const ariaSnapshot = await ariaScannerManager.scanActiveForm();
  console.log(`Discovered ${ariaSnapshot.fields.length} fields in ARIA controls fixture:`, ariaSnapshot.fields.map(f => ({ ref: f.ref, type: f.type, label: f.label })));

  // Expect exactly 5 logical fields: text, textarea, radio group, checkbox, and dropdown/combobox
  assert.strictEqual(ariaSnapshot.fields.length, 5, 'Expected exactly 5 fields in ARIA controls fixture');

  // 1. Text input
  const textF = ariaSnapshot.fields.find((f) => /student.*name/i.test(f.label));
  assert.ok(textF, 'Student Full Name field must be discovered');
  assert.strictEqual(textF.type, 'text');
  assert.strictEqual(textF.required, true);

  // 2. Textarea
  const areaF = ariaSnapshot.fields.find((f) => /address/i.test(f.label));
  assert.ok(areaF, 'Residential Address textarea must be discovered');
  assert.strictEqual(areaF.type, 'textarea');

  // 3. ARIA Radiogroup
  const radioF = ariaSnapshot.fields.find((f) => /gender/i.test(f.label));
  assert.ok(radioF, 'Gender ARIA radiogroup must be discovered');
  assert.strictEqual(radioF.type, 'radio');
  assert.ok(radioF.options.includes('Male'), 'Gender options must contain Male');
  assert.ok(radioF.options.includes('Female'), 'Gender options must contain Female');

  // 4. ARIA Checkbox
  const cbF = ariaSnapshot.fields.find((f) => /hostel/i.test(f.label));
  assert.ok(cbF, 'Hostel ARIA checkbox must be discovered');
  assert.strictEqual(cbF.type, 'checkbox');

  // 5. ARIA Listbox Dropdown
  const dropF = ariaSnapshot.fields.find((f) => /grade/i.test(f.label));
  assert.ok(dropF, 'Applying Grade ARIA dropdown must be discovered');
  assert.ok(dropF.type === 'combobox' || dropF.type === 'select', 'Dropdown type must be combobox or select');

  // Verify submit button is NOT included in FormSnapshot fields
  const ariaSubmitInFields = ariaSnapshot.fields.find(
    (f) => f.type === 'submit' || f.ref === 'submitBtn' || /submit/i.test(f.label)
  );
  assert.strictEqual(ariaSubmitInFields, undefined, 'Submit button must NOT be in ARIA FormSnapshot fields');

  await ariaScannerManager.close();

  console.log('✓ FormScanner honeypot protection, detectBlocker, Defect A/B regressions, and ARIA discovery passed successfully!');
}

runScannerTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
