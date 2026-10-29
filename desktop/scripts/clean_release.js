/**
 * Release directory hygiene and artifact cleanup script for AutoFiller AI.
 *
 * Keeps only the two final distributables in desktop/release/:
 * - AutoFiller AI Setup <version>.exe (NSIS installer)
 * - AutoFiller AI <version>.exe (Portable application)
 *
 * Automatically removes:
 * - Obsolete blockmaps (*.blockmap)
 * - Builder debug YAML logs (builder-debug.yml, builder-effective-config.yaml)
 * - Outdated installer versions
 */

const fs = require('fs');
const path = require('path');

const releaseDir = path.resolve(__dirname, '../release');
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const version = packageJson.version;

if (!fs.existsSync(releaseDir)) {
  console.log('[Release Hygiene] Release directory does not exist yet. Nothing to clean.');
  process.exit(0);
}

const expectedInstaller = `AutoFiller AI Setup ${version}.exe`;
const expectedPortable = `AutoFiller AI ${version}.exe`;

const entries = fs.readdirSync(releaseDir);

console.log(`[Release Hygiene] Cleaning artifacts in ${releaseDir} for version ${version}...`);

let prunedCount = 0;
for (const entry of entries) {
  const fullPath = path.join(releaseDir, entry);
  const stat = fs.statSync(fullPath);

  if (stat.isDirectory()) {
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`  - Pruned intermediate directory: ${entry}`);
      prunedCount++;
    } catch (err) {
      console.warn(`  - Could not prune directory ${entry}: ${err.message}`);
    }
    continue;
  }
  // Delete blockmaps, debug configs, and old versions
  if (
    entry.endsWith('.blockmap') ||
    entry.endsWith('.yml') ||
    entry.endsWith('.yaml') ||
    (entry.endsWith('.exe') && entry !== expectedInstaller && entry !== expectedPortable)
  ) {
    fs.unlinkSync(fullPath);
    console.log(`  - Pruned intermediate/stale artifact: ${entry}`);
    prunedCount++;
  }
}

console.log(`[Release Hygiene] Pruned ${prunedCount} intermediate/stale files.`);

// Verify remaining distributables
const remaining = fs.readdirSync(releaseDir).filter((f) => f.endsWith('.exe'));
console.log('\n[Release Distribution] Active Executables in desktop/release/:');
for (const exe of remaining) {
  const fullPath = path.join(releaseDir, exe);
  const sizeMb = (fs.statSync(fullPath).size / (1024 * 1024)).toFixed(1);
  console.log(`  ✔ ${exe} (${sizeMb} MB)`);
}
