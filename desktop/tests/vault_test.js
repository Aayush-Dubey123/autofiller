/**
 * Unit tests for VaultService V2 encryption, key slots, prohibited credential rules,
 * Section 17 Single Profile Schema, validators, deriveFacts, and demo form mapping.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIST = path.resolve(__dirname, '../dist-electron');
const { VaultService, FakeKeyProtector } = require(path.join(DIST, 'services/VaultService'));
const {
  PROFILE_FIELDS,
  PROFILE_SECTIONS,
  SCHEMA_FIELD_MAP,
  validateMobile,
  validatePincode,
  validateAadhaar,
  validatePan,
  validateIfsc,
  validateEmail,
  validateYear,
  validatePercentage,
  deriveFacts,
  deriveFullName,
  calculateAge,
} = require(path.join(DIST, 'shared/profileSchema'));

async function runVaultTests() {
  console.log('=== Running VaultService Encryption & Security Tests (V2 Key Slots) ===');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
  const fakeProtector = new FakeKeyProtector();
  const vaultService = new VaultService(tmpDir, fakeProtector);

  // 1. Initial status when vault does not exist
  let status = vaultService.getStatus();
  assert.strictEqual(status.exists, false, 'vault should not exist initially');
  assert.strictEqual(status.unlocked, false, 'vault should be locked initially');

  // 2. Silent initialization (Standard Protection with OS slot)
  const initOk = await vaultService.ensureVaultInitialized();
  assert.strictEqual(initOk, true, 'silent vault initialization must succeed');

  status = vaultService.getStatus();
  assert.strictEqual(status.exists, true, 'vault file should exist after init');
  assert.strictEqual(status.unlocked, true, 'vault should be unlocked in standard mode');
  assert.strictEqual(status.hasOsSlot, true, 'OS slot must be present in standard mode');
  assert.strictEqual(status.hasPassphraseSlot, false, 'passphrase slot must be absent in standard mode');

  // 3. Verify file on disk contains NO plaintext field values
  const rawDiskContent = fs.readFileSync(path.join(tmpDir, 'vault.enc'), 'utf-8');
  assert.ok(!rawDiskContent.includes('Primary Profile'), 'disk file must not contain unencrypted profile names');
  assert.ok(rawDiskContent.includes('ciphertext'), 'disk file must contain encrypted ciphertext');
  assert.ok(JSON.parse(rawDiskContent).version === 2, 'disk file must be version 2');

  // 4. Save a profile with fields (allowed key vs sensitive key vs bank account number)
  const profile = vaultService.getProfiles()[0];
  profile.sections[0].fields.push({ key: 'student_name', label: 'Student Name', value: 'Aarav Sharma' });
  profile.sections[5].fields.push({ key: 'aadhaar_card_number', label: 'Aadhaar Card Number', value: '1234-5678-9012', sensitive: true });
  profile.sections[5].fields.push({ key: 'pan_card_number', label: 'PAN Card Number', value: 'ABCDE1234F', sensitive: true });
  profile.sections[5].fields.push({ key: 'passport_number', label: 'Passport Number', value: 'Z1234567', sensitive: true });

  // Bank account number and IFSC must be allowed (PART B)
  profile.sections[6].fields.push({ key: 'bank_account_number', label: 'Bank Account Number', value: '123456789012', sensitive: true });
  profile.sections[6].fields.push({ key: 'ifsc_code', label: 'IFSC Code', value: 'SBIN0001234', sensitive: true });
  profile.sections[2].fields.push({ key: 'pincode', label: 'Pincode', value: '400001' });

  await vaultService.saveProfile(profile);

  const rawDiskWithFields = fs.readFileSync(path.join(tmpDir, 'vault.enc'), 'utf-8');
  assert.ok(!rawDiskWithFields.includes('Aarav Sharma'), 'student name must not be readable in plaintext on disk');
  assert.ok(!rawDiskWithFields.includes('1234-5678-9012'), 'Aadhaar number must not be readable in plaintext on disk');
  assert.ok(!rawDiskWithFields.includes('123456789012'), 'Bank account number must not be readable in plaintext on disk');

  // 5. Verify prohibited keys are refused: password, card_number, credit_card, cvv, pin, upi_pin, otp
  await assert.rejects(async () => {
    const invalidProfile = JSON.parse(JSON.stringify(profile));
    invalidProfile.sections[0].fields.push({ key: 'password', label: 'Password', value: 'secret123' });
    await vaultService.saveProfile(invalidProfile);
  }, /prohibited from vault storage/, 'storing passwords must be rejected');

  await assert.rejects(async () => {
    const invalidProfile = JSON.parse(JSON.stringify(profile));
    invalidProfile.sections[0].fields.push({ key: 'card_number', label: 'Card Number', value: '4111222233334444' });
    await vaultService.saveProfile(invalidProfile);
  }, /prohibited from vault storage/, 'storing card_number must be rejected');

  await assert.rejects(async () => {
    const invalidProfile = JSON.parse(JSON.stringify(profile));
    invalidProfile.sections[0].fields.push({ key: 'cvv', label: 'CVV', value: '123' });
    await vaultService.saveProfile(invalidProfile);
  }, /prohibited from vault storage/, 'storing cvv must be rejected');

  await assert.rejects(async () => {
    const invalidProfile = JSON.parse(JSON.stringify(profile));
    invalidProfile.sections[0].fields.push({ key: 'pin', label: 'PIN', value: '1234' });
    await vaultService.saveProfile(invalidProfile);
  }, /prohibited from vault storage/, 'storing pin must be rejected');

  await assert.rejects(async () => {
    const invalidProfile = JSON.parse(JSON.stringify(profile));
    invalidProfile.sections[0].fields.push({ key: 'upi_pin', label: 'UPI PIN', value: '123456' });
    await vaultService.saveProfile(invalidProfile);
  }, /prohibited from vault storage/, 'storing upi_pin must be rejected');

  await assert.rejects(async () => {
    const invalidProfile = JSON.parse(JSON.stringify(profile));
    invalidProfile.sections[0].fields.push({ key: 'otp', label: 'One Time Password', value: '654321' });
    await vaultService.saveProfile(invalidProfile);
  }, /prohibited from vault storage/, 'storing otp must be rejected');

  // 6. Enable Extra Protection (passphrase slot + recovery slot)
  const enableRes = await vaultService.enableExtraProtection('StrongPrivacyKey123', true);
  assert.strictEqual(enableRes.success, true, 'enabling extra protection must succeed');
  assert.ok(enableRes.recoveryCode, 'recovery code should be generated');

  status = vaultService.getStatus();
  assert.strictEqual(status.hasPassphraseSlot, true, 'passphrase slot must be present');
  assert.strictEqual(status.hasOsSlot, false, 'OS slot must be removed when extra protection is on');
  assert.strictEqual(status.recoveryAvailable, true, 'recovery slot must be present');

  // Verify backup file exists
  assert.ok(fs.existsSync(path.join(tmpDir, 'vault.enc.bak')), 'vault.enc.bak backup file must exist');

  // 7. Lock vault and verify memory zeroization
  vaultService.lock();
  status = vaultService.getStatus();
  assert.strictEqual(status.unlocked, false, 'vault should be locked after lock()');
  assert.throws(() => vaultService.getProfiles(), /Vault is locked/, 'getProfiles must throw when locked');

  // 8. Unlock with wrong key fails
  const wrongUnlock = await vaultService.unlock({ privacyKey: 'WrongKey999' });
  assert.strictEqual(wrongUnlock.success, false, 'unlock with wrong key must fail');

  // 9. Unlock with recovery code succeeds
  const recUnlock = await vaultService.unlock({ recoveryCode: enableRes.recoveryCode });
  assert.strictEqual(recUnlock.success, true, 'unlock with recovery code must succeed');
  assert.strictEqual(vaultService.getStatus().unlocked, true);

  // 10. Change privacy key
  const changeRes = await vaultService.changePrivacyKey('StrongPrivacyKey123', 'NewStrongPrivacyKey456');
  assert.strictEqual(changeRes.success, true, 'change privacy key must succeed');

  vaultService.lock();
  const oldUnlock = await vaultService.unlock({ privacyKey: 'StrongPrivacyKey123' });
  assert.strictEqual(oldUnlock.success, false, 'old key must fail after key change');

  const newUnlock = await vaultService.unlock({ privacyKey: 'NewStrongPrivacyKey456' });
  assert.strictEqual(newUnlock.success, true, 'new key must unlock vault');

  // 11. Disable Extra Protection (round trip back to standard mode)
  const disableRes = await vaultService.disableExtraProtection('NewStrongPrivacyKey456');
  assert.strictEqual(disableRes.success, true, 'disabling extra protection must succeed');

  status = vaultService.getStatus();
  assert.strictEqual(status.hasOsSlot, true, 'OS slot must be restored');
  assert.strictEqual(status.hasPassphraseSlot, false, 'passphrase slot must be removed');

  // Cleanup vault service tmp dirs
  vaultService.eraseAll();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('✓ Vault encryption, key slots, and security rules verified.');

  // ==========================================
  // PART A & TESTS: Single Profile Schema Tests
  // ==========================================
  console.log('=== Running Section 17 Single Profile Schema Tests ===');

  // 12. Unique keys across all PROFILE_FIELDS
  const keysSet = new Set();
  PROFILE_FIELDS.forEach((f) => {
    assert.ok(!keysSet.has(f.key), `Duplicate schema key detected: '${f.key}'`);
    keysSet.add(f.key);
    assert.ok(f.label && f.label.trim(), `Field '${f.key}' must have a non-empty label`);
    assert.ok(f.section && f.section.trim(), `Field '${f.key}' must have a section`);
    assert.ok(f.type && f.type.trim(), `Field '${f.key}' must have an input type`);
  });

  // Verify 10 sections exist
  assert.strictEqual(PROFILE_SECTIONS.length, 10, 'Schema must define exactly 10 sections');

  // Verify sensitive flags set on ID and Bank fields
  const idAndBankSensitiveKeys = [
    'aadhaar_card_number',
    'pan_card_number',
    'passport_number',
    'voter_id_number',
    'driving_license_number',
    'bank_account_number',
    'ifsc_code',
  ];
  idAndBankSensitiveKeys.forEach((key) => {
    const f = SCHEMA_FIELD_MAP.get(key);
    assert.ok(f, `Field '${key}' must exist in schema`);
    assert.strictEqual(f.sensitive, true, `Field '${key}' must be marked sensitive`);
  });

  console.log('✓ Schema definition, unique keys, and sensitive flags verified.');

  // ==========================================
  // Validators Tests
  // ==========================================
  console.log('=== Running Schema Validators Tests ===');

  // Mobile validator (10 digits)
  assert.strictEqual(validateMobile('9876543210').valid, true);
  assert.strictEqual(validateMobile('98765 43210').valid, true);
  assert.strictEqual(validateMobile('987654321').valid, false);
  assert.strictEqual(validateMobile('98765432100').valid, false);
  assert.strictEqual(validateMobile('abcd1234ef').valid, false);

  // Pincode validator (6 digits)
  assert.strictEqual(validatePincode('400001').valid, true);
  assert.strictEqual(validatePincode('400 001').valid, true);
  assert.strictEqual(validatePincode('40001').valid, false);
  assert.strictEqual(validatePincode('4000001').valid, false);

  // Aadhaar validator (12 digits)
  assert.strictEqual(validateAadhaar('123456789012').valid, true);
  assert.strictEqual(validateAadhaar('1234 5678 9012').valid, true);
  assert.strictEqual(validateAadhaar('12345678901').valid, false);

  // PAN validator
  assert.strictEqual(validatePan('ABCDE1234F').valid, true);
  assert.strictEqual(validatePan('abcde1234f').valid, true); // Case insensitive
  assert.strictEqual(validatePan('ABCD1234F').valid, false);
  assert.strictEqual(validatePan('ABCDEF1234').valid, false);

  // IFSC validator
  assert.strictEqual(validateIfsc('SBIN0001234').valid, true);
  assert.strictEqual(validateIfsc('sbin0001234').valid, true);
  assert.strictEqual(validateIfsc('SBIN1001234').valid, false); // 5th character must be 0

  // Email validator
  assert.strictEqual(validateEmail('student@example.com').valid, true);
  assert.strictEqual(validateEmail('invalid-email').valid, false);

  // Year validator
  assert.strictEqual(validateYear('2024').valid, true);
  assert.strictEqual(validateYear('1999').valid, true);
  assert.strictEqual(validateYear('24').valid, false);
  assert.strictEqual(validateYear('1850').valid, false);

  // Percentage validator
  assert.strictEqual(validatePercentage('85.5').valid, true);
  assert.strictEqual(validatePercentage('100').valid, true);
  assert.strictEqual(validatePercentage('0').valid, true);
  assert.strictEqual(validatePercentage('105').valid, false);
  assert.strictEqual(validatePercentage('-5').valid, false);

  console.log('✓ All pure helper validators verified.');

  // ==========================================
  // deriveFacts Tests
  // ==========================================
  console.log('=== Running deriveFacts Tests ===');

  const rawFacts = {
    first_name: 'Aarav',
    middle_name: 'Kumar',
    last_name: 'Sharma',
    dob: '2008-05-15',
    address: 'Flat 402, Sunshine Heights',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
    same_as_current_address: 'true',
  };

  const derived = deriveFacts(rawFacts);

  // Full name
  assert.strictEqual(derived.student_name, 'Aarav Kumar Sharma', 'student_name must be derived from name parts');

  // Age calculation
  const birth = new Date('2008-05-15');
  const today = new Date();
  let expectedAge = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) expectedAge--;
  assert.strictEqual(derived.age, String(expectedAge), 'age must be derived from dob');

  // One-line address
  assert.strictEqual(
    derived.one_line_address,
    'Flat 402, Sunshine Heights, Mumbai, Maharashtra, 400001',
    'one_line_address must format correctly'
  );

  // same-as-current copies
  assert.strictEqual(derived.permanent_address, 'Flat 402, Sunshine Heights');
  assert.strictEqual(derived.permanent_city, 'Mumbai');
  assert.strictEqual(derived.permanent_state, 'Maharashtra');
  assert.strictEqual(derived.permanent_pincode, '400001');

  console.log('✓ deriveFacts (student_name, age, one_line_address, same_as_current) verified.');

  // ==========================================
  // Demo Form Fact Mapping Test
  // ==========================================
  console.log('=== Running Demo Form Schema Key Mapping Test ===');

  // The mock school form expects:
  // student_name, dob, gender, email, phone, address, city, state, pincode, father_name, mother_name, previous_school
  const demoFormProfile = {
    first_name: 'Aarav',
    last_name: 'Sharma',
    dob: '2008-05-15',
    gender: 'Male',
    email: 'aarav.sharma@example.com',
    phone: '9876543210',
    address: '123 Park Street',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
    father_name: 'Vikram Sharma',
    mother_name: 'Sunita Sharma',
    previous_school: 'Greenwood High',
  };

  const demoDerived = deriveFacts(demoFormProfile);

  const requiredDemoKeys = [
    'student_name',
    'dob',
    'gender',
    'email',
    'phone',
    'address',
    'city',
    'state',
    'pincode',
    'father_name',
    'mother_name',
    'previous_school',
  ];

  requiredDemoKeys.forEach((key) => {
    assert.ok(
      demoDerived[key] && demoDerived[key].trim(),
      `Demo form target key '${key}' must be produced by vault schema + deriveFacts`
    );
  });

  console.log('✓ Demo form fact mapping verified for all 12 admission fields.');
  console.log('✓ ALL VAULT, SCHEMA, VALIDATOR, DERIVEFACTS, AND MAPPING TESTS PASSED!');
}

runVaultTests().catch((err) => {
  console.error('Vault test failed:', err);
  process.exit(1);
});
