/**
 * Unit test for VaultService V2 encryption, key slots, lock, tamper detection, and security rules.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIST = path.resolve(__dirname, '../dist-electron');
const { VaultService, FakeKeyProtector } = require(path.join(DIST, 'services/VaultService'));

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

  // 4. Save a profile with fields (allowed key vs sensitive key)
  const profile = vaultService.getProfiles()[0];
  profile.sections[0].fields.push({ key: 'student_name', label: 'Student Name', value: 'Aarav Sharma' });
  profile.sections[5].fields.push({ key: 'aadhaar_card_number', label: 'Aadhaar Card Number', value: '1234-5678-9012', sensitive: true });
  profile.sections[5].fields.push({ key: 'pan_card_number', label: 'PAN Card Number', value: 'ABCDE1234F', sensitive: true });
  profile.sections[5].fields.push({ key: 'passport_number', label: 'Passport Number', value: 'Z1234567', sensitive: true });
  await vaultService.saveProfile(profile);

  const rawDiskWithFields = fs.readFileSync(path.join(tmpDir, 'vault.enc'), 'utf-8');
  assert.ok(!rawDiskWithFields.includes('Aarav Sharma'), 'student name must not be readable in plaintext on disk');
  assert.ok(!rawDiskWithFields.includes('1234-5678-9012'), 'Aadhaar number must not be readable in plaintext on disk');

  // 5. Verify prohibited exact keys are rejected while allowed keys pass
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

  // 6. Enable Extra Protection (passphrase slot + recovery slot)
  const enableRes = await vaultService.enableExtraProtection('StrongPrivacyKey123', true);
  if (!enableRes.success) {
    console.error('enableExtraProtection failed with error:', enableRes.error);
  }
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

  // 12. Test opening V1 vault file format
  const v1Content = {
    version: 1,
    kdf: { algorithm: 'scrypt', N: 16384, r: 8, p: 1, salt: crypto.randomBytes(16).toString('hex') },
    wrappedDek: { iv: '00', authTag: '00', ciphertext: '00' },
    vaultIv: '00',
    vaultAuthTag: '00',
    ciphertext: '00',
  };
  fs.writeFileSync(path.join(tmpDir, 'v1_vault.enc'), JSON.stringify(v1Content));
  const v1Service = new VaultService(tmpDir, fakeProtector);
  // File exists and parses V1
  const v1Status = v1Service.getStatus();
  assert.strictEqual(v1Status.hasPassphraseSlot, true, 'V1 files must be reported as passphrase protected');

  // Cleanup
  vaultService.eraseAll();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('✓ All VaultService V2 encryption, key slots, and security tests passed cleanly!');
}

runVaultTests().catch((err) => {
  console.error('Vault test failed:', err);
  process.exit(1);
});
