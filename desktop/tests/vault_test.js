/**
 * Unit test for VaultService encryption, lock, tamper detection, and security rules.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIST = path.resolve(__dirname, '../dist-electron');
const { VaultService } = require(path.join(DIST, 'services/VaultService'));

async function runVaultTests() {
  console.log('=== Running VaultService Encryption & Security Tests ===');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
  const vaultService = new VaultService(tmpDir);

  // 1. Initial status when vault does not exist
  let status = vaultService.getStatus();
  assert.strictEqual(status.exists, false, 'vault should not exist initially');
  assert.strictEqual(status.unlocked, false, 'vault should be locked initially');

  // 2. Create vault with privacy key
  const createRes = vaultService.createVault('MySecretKey123', true);
  assert.strictEqual(createRes.success, true, 'vault creation should succeed');
  assert.ok(createRes.recoveryCode, 'recovery code should be generated');

  status = vaultService.getStatus();
  assert.strictEqual(status.exists, true, 'vault file should exist');
  assert.strictEqual(status.unlocked, true, 'vault should be unlocked after creation');
  assert.strictEqual(status.recoveryAvailable, true, 'recovery code option should be available');

  // 3. Verify file on disk contains NO plaintext field values
  const rawDiskContent = fs.readFileSync(path.join(tmpDir, 'vault.enc'), 'utf-8');
  assert.ok(!rawDiskContent.includes('Primary Profile'), 'disk file must not contain unencrypted profile names');
  assert.ok(rawDiskContent.includes('ciphertext'), 'disk file must contain encrypted ciphertext');

  // 4. Save a profile with fields
  const profile = vaultService.getProfiles()[0];
  profile.sections[0].fields.push({ key: 'student_name', label: 'Student Name', value: 'Aarav Sharma' });
  profile.sections[5].fields.push({ key: 'aadhaar_number', label: 'Aadhaar Number', value: '1234-5678-9012', sensitive: true });
  vaultService.saveProfile(profile);

  const rawDiskWithFields = fs.readFileSync(path.join(tmpDir, 'vault.enc'), 'utf-8');
  assert.ok(!rawDiskWithFields.includes('Aarav Sharma'), 'student name must not be readable in plaintext on disk');
  assert.ok(!rawDiskWithFields.includes('1234-5678-9012'), 'Aadhaar number must not be readable in plaintext on disk');

  // 5. Verify prohibited keys are rejected
  assert.throws(() => {
    const invalidProfile = JSON.parse(JSON.stringify(profile));
    invalidProfile.sections[0].fields.push({ key: 'user_password', label: 'Password', value: 'secret123' });
    vaultService.saveProfile(invalidProfile);
  }, /prohibited from vault storage/, 'storing passwords must be rejected');

  assert.throws(() => {
    const invalidProfile = JSON.parse(JSON.stringify(profile));
    invalidProfile.sections[0].fields.push({ key: 'credit_card_number', label: 'Card Number', value: '4111222233334444' });
    vaultService.saveProfile(invalidProfile);
  }, /prohibited from vault storage/, 'storing card numbers must be rejected');

  // 6. Lock vault and verify memory zeroization
  vaultService.lock();
  status = vaultService.getStatus();
  assert.strictEqual(status.unlocked, false, 'vault should be locked after lock()');
  assert.throws(() => vaultService.getProfiles(), /Vault is locked/, 'getProfiles must throw when locked');

  // 7. Wrong key fails
  const wrongUnlock = vaultService.unlock({ privacyKey: 'WrongKey999' });
  assert.strictEqual(wrongUnlock.success, false, 'unlock with wrong key must fail');
  assert.strictEqual(vaultService.getStatus().unlocked, false);

  // 8. Correct key unlocks
  const correctUnlock = vaultService.unlock({ privacyKey: 'MySecretKey123' });
  assert.strictEqual(correctUnlock.success, true, 'unlock with correct key must succeed');
  assert.strictEqual(vaultService.getStatus().unlocked, true);
  const loadedProfiles = vaultService.getProfiles();
  assert.strictEqual(loadedProfiles[0].sections[0].fields[0].value, 'Aarav Sharma', 'unlocked profiles must match saved values');

  // 9. Tampered file fails GCM auth tag check
  vaultService.lock();
  const fileJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'vault.enc'), 'utf-8'));
  // Flip a byte in the ciphertext
  const origCipher = fileJson.ciphertext;
  fileJson.ciphertext = '00' + origCipher.substring(2);
  fs.writeFileSync(path.join(tmpDir, 'vault.enc'), JSON.stringify(fileJson));

  const tamperedUnlock = vaultService.unlock({ privacyKey: 'MySecretKey123' });
  assert.strictEqual(tamperedUnlock.success, false, 'tampered file must fail auth tag verification');

  // Cleanup
  vaultService.eraseAll();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('✓ All VaultService encryption and security tests passed cleanly!');
}

runVaultTests().catch((err) => {
  console.error('Vault test failed:', err);
  process.exit(1);
});
