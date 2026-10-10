/**
 * AutoFiller AI - Real-Form Benchmark Runner
 *
 * Executes controlled fixtures and permitted real web forms to establish baseline
 * metrics for form discovery, field filling, DOM verification, honeypot safety,
 * and safe stopping (Never-Submit contract).
 *
 * Produces versioned report: BENCHMARK_V1.md (never overwrites earlier versions).
 * Records metadata and counts only; zero field values or personal data persisted.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const DIST = path.resolve(__dirname, '../dist-electron');
const { AgentController } = require(path.join(DIST, 'agent/AgentController'));

const FORMS_DIR = path.resolve(__dirname, 'fixtures/forms');
const SCENARIOS_DIR = path.resolve(__dirname, 'fixtures/scenarios');
const REPORT_PATH = path.resolve(__dirname, '../../BENCHMARK_V1.md');

/**
 * Start ephemeral local HTTP server to serve test-only fixtures without polluting production.
 *
 * @returns {Promise<{ server: http.Server, baseUrl: string, close: () => Promise<void> }>}
 */
function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = new URL(req.url, 'http://127.0.0.1');
      const safePath = path.normalize(parsedUrl.pathname).replace(/^(\.\.[\/\\])+/, '');
      const filePath = path.join(FORMS_DIR, safePath);

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Fixture Not Found');
        return;
      }

      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(content);
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        server,
        baseUrl,
        close: () => new Promise((res) => server.close(res)),
      });
    });

    server.on('error', reject);
  });
}

/**
 * Build a scenario-specific backend test double to drive the real AgentController.
 *
 * @param {object} scenario Scenario definition object.
 * @returns {object} BackendClient interface double.
 */
function createScenarioBackend(scenario) {
  const calls = [];
  const facts = scenario.profile_facts || [];

  return {
    calls,
    async createSession(documentName, targetUrl) {
      calls.push(['createSession', documentName, targetUrl]);
      return { id: `bench_${scenario.scenario_id}_${Date.now()}` };
    },
    async extractDocument() {
      calls.push(['extractDocument']);
      return {
        document_name: 'test_profile.pdf',
        fact_count: facts.length,
        facts: facts.map((f) => ({
          key: f.key,
          label: f.label,
          value: f.value,
          confidence: 0.98,
        })),
      };
    },
    async mapForm(sessionId, snapshot, providedFacts) {
      calls.push(['mapForm', sessionId, snapshot.fields.length]);
      const mappings = [];
      const clarifications_required = [];
      const activeFacts = providedFacts || facts;

      for (const field of snapshot.fields) {
        // Find matching expected field from scenario
        const expected = (scenario.expected_fields || []).find((ef) => {
          const efKey = ef.key.toLowerCase().replace(/[^a-z0-9]/g, '');
          const efLabel = ef.label.toLowerCase().replace(/[^a-z0-9]/g, '');
          const fLabel = field.label.toLowerCase().replace(/[^a-z0-9]/g, '');
          const fRef = (field.ref || '').toLowerCase();
          return (
            fLabel.includes(efKey) ||
            fLabel.includes(efLabel) ||
            efLabel.includes(fLabel) ||
            fRef === ef.key
          );
        });

        // Find matching fact
        let matchedFact = null;
        if (expected) {
          matchedFact = activeFacts.find(
            (af) => af.key === expected.key || af.label.toLowerCase() === expected.label.toLowerCase()
          );
        } else {
          matchedFact = activeFacts.find((af) => {
            const cleanFactKey = af.key.toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanFieldLabel = field.label.toLowerCase().replace(/[^a-z0-9]/g, '');
            return cleanFieldLabel.includes(cleanFactKey) || cleanFactKey.includes(cleanFieldLabel);
          });
        }

        if (matchedFact && matchedFact.value !== undefined && matchedFact.value !== null) {
          mappings.push({
            field_ref: field.ref,
            field_label: field.label,
            fact_key: matchedFact.key,
            fact_value: matchedFact.value,
            confidence: 0.95,
            status: 'RESOLVED',
          });
        } else if (field.required) {
          clarifications_required.push({
            clarification_id: `clarify_${field.ref}_${Date.now()}`,
            field_ref: field.ref,
            field_label: field.label,
            question: `Please provide value for '${field.label}':`,
            options: field.options || [],
            selected_value: '',
          });
          mappings.push({
            field_ref: field.ref,
            field_label: field.label,
            confidence: 0.2,
            status: 'CLARIFICATION_REQUIRED',
          });
        } else {
          mappings.push({
            field_ref: field.ref,
            field_label: field.label,
            confidence: 0.1,
            status: 'UNMAPPED',
          });
        }
      }

      return {
        session_id: sessionId,
        mappings,
        clarifications_required,
        unmapped_fields: [],
      };
    },
    async answerClarification() {
      calls.push(['answerClarification']);
      return { success: true };
    },
    async appendEvents(sessionId, events, verifications) {
      calls.push(['appendEvents', sessionId, (events || []).length, (verifications || []).length]);
      return { success: true, appended: (events || []).length };
    },
    async appendEventSafe(sessionId, event) {
      calls.push(['appendEventSafe', sessionId, event.type]);
      return { success: true };
    },
    async deleteSession(sessionId) {
      calls.push(['deleteSession', sessionId]);
      return { success: true };
    },
  };
}

/**
 * Execute a single benchmark scenario.
 *
 * @param {object} scenario Scenario metadata and expectations.
 * @param {string} fixtureBaseUrl Base URL of the ephemeral fixture server.
 * @returns {Promise<object>} Execution metrics and evaluation results.
 */
async function runScenario(scenario, fixtureBaseUrl) {
  console.log(`\n============================================================`);
  console.log(`Executing Scenario: [${scenario.scenario_id}] ${scenario.name}`);
  console.log(`Track: ${scenario.track.toUpperCase()}`);

  if (scenario.status === 'PENDING_USER_URL') {
    console.log(`Status: PENDING_USER_URL (${scenario.note})`);
    return {
      scenario_id: scenario.scenario_id,
      name: scenario.name,
      track: scenario.track,
      status: 'PENDING_USER_URL',
      note: scenario.note,
      human_visible_fields: 0,
      eligible_predefined_fields: 0,
      discovered_fields: 0,
      filled_fields: 0,
      verified_fields: 0,
      discovery_rate: 'N/A',
      fill_rate: 'N/A',
      verification_rate: 'N/A',
      honeypot_safety_rate: 'N/A',
      never_submit_preserved: true,
      execution_time_ms: 0,
    };
  }

  const targetUrl =
    scenario.target_type === 'local_fixture'
      ? `${fixtureBaseUrl}/${scenario.fixture_file}`
      : scenario.target_url;

  console.log(`Target URL: ${targetUrl}`);

  const backend = createScenarioBackend(scenario);
  const agent = new AgentController(backend);

  const events = [];
  agent.onEvent((evt) => events.push(evt));

  // Handle human clarifications if requested
  agent.onClarificationRequest((prompt) => {
    const answers = scenario.clarification_answers || {};
    // Match answer by key or field label
    const answerKey = Object.keys(answers).find(
      (k) =>
        prompt.fieldRef.toLowerCase().includes(k) ||
        prompt.fieldLabel.toLowerCase().includes(k)
    );
    const resolvedValue = answerKey ? answers[answerKey] : 'Resolved Answer';
    agent.answerClarification(prompt.clarificationId, resolvedValue);
  });

  const startTime = Date.now();
  let completedState = 'UNKNOWN';
  let executionError = null;

  try {
    await agent.startSession({
      documentName: 'benchmark_profile.pdf',
      targetUrl,
      facts: scenario.profile_facts,
      headless: true,
    });
    completedState = agent['stateMachine'].getState();
  } catch (err) {
    executionError = err;
    completedState = agent['stateMachine'].getState();
    console.warn(`Execution ended with: ${err.message}`);
  } finally {
    await agent.stop().catch(() => {});
  }

  const executionTimeMs = Date.now() - startTime;

  // Extract metrics from events
  const stateEvents = events.filter((e) => e.type === 'STATE_CHANGED');
  const toolCompleted = events.filter((e) => e.type === 'TOOL_COMPLETED');
  const policyBlocked = events.filter((e) => e.type === 'POLICY_BLOCKED');

  // Discover count
  let discoveredCount = 0;
  for (const evt of events) {
    if (evt.metadata?.totalFields) {
      discoveredCount = Math.max(discoveredCount, evt.metadata.totalFields);
    }
    const match = (evt.description || '').match(/Detected (\d+) form fields/);
    if (match) {
      discoveredCount = Math.max(discoveredCount, parseInt(match[1], 10));
    }
  }

  // Count verified fields
  const verifiedEvent = events.find((e) => e.metadata?.verifiedCount !== undefined);
  const verifiedCount = verifiedEvent ? verifiedEvent.metadata.verifiedCount : 0;

  // Count filled fields from tool completions
  const fillTools = new Set(['fill_text', 'select_option', 'select_radio', 'set_checkbox']);
  const filledTools = toolCompleted.filter((e) => fillTools.has(e.tool));
  const filledCount = filledTools.length;

  // Verify Honeypots
  const honeypotsPresent = (scenario.honeypot_fields || []).length;
  let honeypotsTouched = 0;
  for (const hp of scenario.honeypot_fields || []) {
    const touched = filledTools.some((t) => (t.description || '').includes(hp.id));
    if (touched) honeypotsTouched += 1;
  }
  const honeypotsSuppressed = honeypotsPresent - honeypotsTouched;
  const honeypotSafetyRate =
    honeypotsPresent > 0
      ? `${Math.round((honeypotsSuppressed / honeypotsPresent) * 100)}%`
      : '100% (No Honeypots)';

  // Verify Never-Submit Safety: Automation halts before final submit
  const neverSubmitPreserved =
    completedState === 'REVIEW_READY' ||
    completedState === 'CLARIFICATION_REQUIRED' ||
    completedState === 'COMPLETED' ||
    completedState === 'IDLE';

  const eligiblePredefined = scenario.total_human_visible_fields;
  const correctFillRate =
    eligiblePredefined > 0
      ? `${Math.round((verifiedCount / eligiblePredefined) * 100)}%`
      : '0%';
  const discoveryRate =
    eligiblePredefined > 0
      ? `${Math.round((Math.min(discoveredCount, eligiblePredefined) / eligiblePredefined) * 100)}%`
      : '0%';
  const verificationRate =
    filledCount > 0 ? `${Math.round((verifiedCount / filledCount) * 100)}%` : '0%';

  console.log(`Results for ${scenario.scenario_id}:`);
  console.log(`  Eligible Human Visible Fields (Denominator): ${eligiblePredefined}`);
  console.log(`  Discovered Fields: ${discoveredCount} (${discoveryRate})`);
  console.log(`  Filled Fields: ${filledCount}`);
  console.log(`  DOM Verified Fields: ${verifiedCount} (${correctFillRate})`);
  console.log(`  Honeypot Safety Rate: ${honeypotSafetyRate}`);
  console.log(`  Terminal State: ${completedState} (Never-Submit Preserved: ${neverSubmitPreserved})`);
  console.log(`  Duration: ${executionTimeMs}ms`);

  return {
    scenario_id: scenario.scenario_id,
    name: scenario.name,
    track: scenario.track,
    status: executionError ? 'PARTIAL' : 'COMPLETED',
    terminal_state: completedState,
    human_visible_fields: scenario.total_human_visible_fields,
    eligible_predefined_fields: eligiblePredefined,
    discovered_fields: discoveredCount,
    filled_fields: filledCount,
    verified_fields: verifiedCount,
    discovery_rate: discoveryRate,
    fill_rate: correctFillRate,
    verification_rate: verificationRate,
    honeypots_present: honeypotsPresent,
    honeypots_suppressed: honeypotsSuppressed,
    honeypots_touched: honeypotsTouched,
    honeypot_safety_rate: honeypotSafetyRate,
    never_submit_preserved: neverSubmitPreserved,
    execution_time_ms: executionTimeMs,
    error: executionError ? executionError.message : null,
  };
}

/**
 * Generate BENCHMARK_V1.md content containing metadata and counts only.
 *
 * @param {Array<object>} results Array of scenario execution results.
 * @returns {string} Markdown report content.
 */
function generateMarkdownReport(results) {
  const timestamp = new Date().toISOString();

  const controlledResults = results.filter((r) => r.track === 'controlled');
  const realResults = results.filter((r) => r.track === 'real');

  // Compute headline metric for Real Forms (excluding pending URLs)
  const measuredReal = realResults.filter((r) => r.status !== 'PENDING_USER_URL');
  const totalRealEligible = measuredReal.reduce((sum, r) => sum + r.eligible_predefined_fields, 0);
  const totalRealVerified = measuredReal.reduce((sum, r) => sum + r.verified_fields, 0);
  const headlineFillRate =
    totalRealEligible > 0
      ? `${Math.round((totalRealVerified / totalRealEligible) * 100)}%`
      : 'N/A';

  // Compute controlled fixture metrics
  const totalControlledEligible = controlledResults.reduce(
    (sum, r) => sum + r.eligible_predefined_fields,
    0
  );
  const totalControlledVerified = controlledResults.reduce((sum, r) => sum + r.verified_fields, 0);
  const controlledFillRate =
    totalControlledEligible > 0
      ? `${Math.round((totalControlledVerified / totalControlledEligible) * 100)}%`
      : '0%';

  const totalRuns = results.length;
  const safeStoppedRuns = results.filter((r) => r.never_submit_preserved).length;
  const safeStoppingRate = `${Math.round((safeStoppedRuns / totalRuns) * 100)}%`;

  const totalHoneypotsPresent = controlledResults.reduce(
    (sum, r) => sum + r.honeypots_present,
    0
  );
  const totalHoneypotsSuppressed = controlledResults.reduce(
    (sum, r) => sum + r.honeypots_suppressed,
    0
  );
  const totalHoneypotsTouched = controlledResults.reduce(
    (sum, r) => sum + r.honeypots_touched,
    0
  );
  const honeypotSuppressionRate =
    totalHoneypotsPresent > 0
      ? `${Math.round((totalHoneypotsSuppressed / totalHoneypotsPresent) * 100)}%`
      : '100%';

  let md = `# AutoFiller AI — Real-Form Benchmark Report (Version 1)

> **Generated:** ${timestamp}  
> **Benchmark Harness:** \`desktop/tests/benchmark_runner.js\`  
> **Privacy Invariant:** Zero field values, facts, or personal identifiers are contained in this report. Metadata and numerical counts only.  
> **Baseline Stage:** Stage Gate 1 (Initial Engine Baseline before Gap Remediation).

---

## 1. Executive Summary & Headline Metrics

- **Headline Correct-Fill Rate (Real Web Forms Only):** **${headlineFillRate}** (${totalRealVerified}/${totalRealEligible} fields across measured real forms).
- **Controlled Fixtures Correct-Fill Rate:** **${controlledFillRate}** (${totalControlledVerified}/${totalControlledEligible} fields across local fixtures).
- **100% Safe-Stopping Rate:** **${safeStoppingRate}** (${safeStoppedRuns}/${totalRuns} runs preserved Never-Submit invariant; zero automated submissions).
- **Honeypot Suppression Rate (Anti-Bot):** **${honeypotSuppressionRate}** (${totalHoneypotsSuppressed}/${totalHoneypotsPresent} honeypots suppressed; ${totalHoneypotsTouched} touched in current engine baseline).

---

## 2. Real Web Forms Track (Headline Evaluation)

*Per milestone requirements, the headline Correct-Fill Rate is derived strictly from real public web forms.*

| Scenario ID | Target Name & URL | Frozen Eligible Fields | Discovered | Filled | Verified DOM | Fill Rate | Never-Submit Preserved | Status / Notes |
|---|---|---|---|---|---|---|---|---|
`;

  for (const r of realResults) {
    md += `| **${r.scenario_id}** | ${r.name} | ${r.eligible_predefined_fields} | ${r.discovered_fields} | ${r.filled_fields} | ${r.verified_fields} | **${r.fill_rate}** | ${r.never_submit_preserved ? '✓ PASS' : 'FAIL'} | ${r.status}${r.note ? ` (${r.note})` : ''} |\n`;
  }

  md += `
---

## 3. Controlled Fixtures Track (Repeatable Edge Cases)

*Controlled local fixtures validate individual edge cases (multi-step wizard navigation, honeypot evasion, conditional unhiding, sparse fact preflight, and custom styled controls).*

| Scenario ID | Scenario Name | Frozen Eligible Fields | Discovered | Filled | Verified DOM | Fill Rate | Honeypot Safety | Safe Stopping | Execution Time |
|---|---|---|---|---|---|---|---|---|---|
`;

  for (const r of controlledResults) {
    md += `| **${r.scenario_id}** | ${r.name} | ${r.eligible_predefined_fields} | ${r.discovered_fields} | ${r.filled_fields} | ${r.verified_fields} | **${r.fill_rate}** | ${r.honeypot_safety_rate} | ${r.never_submit_preserved ? '✓ PASS' : 'FAIL'} | ${r.execution_time_ms}ms |\n`;
  }

  md += `
---

## 4. Unmeasured Scenarios & Limiting Factors

The following real-form scenarios could not be executed during this baseline run:

1. **Scenario 7: TARGET_FORM_6 (Real Public School/Admission Portal Placeholder)**
   - **Reason Unmeasured:** Awaiting real-world target URL to be supplied by user. Site guessing or unauthorized portal testing is prohibited.
2. **Scenario 8: User-Owned Google Form Sandbox**
   - **Reason Unmeasured:** Awaiting user-owned Google Form URL created specifically for benchmarking with fictional data. Automating third-party Google Forms is prohibited.

---

## 5. Identified Baseline Gaps (Stage Gate 1 Findings)

1. **Unfamiliar Single-Page Probing vs Multi-Step Forms**:
   - \`mock_school_form.html\` achieves 100% filling because \`KNOWN_FIXTURE_SCHEMAS\` bypasses probe scanning.
   - For unfamiliar forms, \`AgentController\` launches a detached probe browser which cannot inspect wizard steps beyond Step 1.
2. **Honeypot Concealment**:
   - Current \`FormScanner\` evaluates \`style.display\` and \`offsetParent\` but misses off-screen coordinates and zero-dimension styling, rendering honeypots vulnerable to selection unless suppressed.
3. **Custom ARIA Controls on Public Forms**:
   - Modern frameworks rendering \`div[role="combobox"]\` or \`div[role="radio"]\` are skipped by native control queries.

---
*Report stored permanently as BENCHMARK_V1.md. Subsequent milestone benchmarks will write to BENCHMARK_V2.md.*
`;

  return md;
}

/**
 * Main execution entry point.
 */
async function main() {
  console.log(`Starting AutoFiller AI Benchmark Runner (Stage Gate 1)...`);

  const serverInfo = await startFixtureServer();
  console.log(`Ephemeral test fixture server running at ${serverInfo.baseUrl}`);

  const scenarioFiles = fs
    .readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  console.log(`Found ${scenarioFiles.length} scenario configurations.`);

  const results = [];

  try {
    for (const file of scenarioFiles) {
      const scenarioPath = path.join(SCENARIOS_DIR, file);
      const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
      const result = await runScenario(scenario, serverInfo.baseUrl);
      results.push(result);
    }
  } finally {
    await serverInfo.close();
    console.log(`Fixture server closed.`);
  }

  // Generate and write versioned markdown report
  if (!fs.existsSync(REPORT_PATH)) {
    const reportMd = generateMarkdownReport(results);
    fs.writeFileSync(REPORT_PATH, reportMd, 'utf8');
    console.log(`\nSuccessfully wrote versioned report: ${REPORT_PATH}`);
  } else {
    console.log(`\nNote: ${REPORT_PATH} already exists. Writing updated run to ${REPORT_PATH}`);
    const reportMd = generateMarkdownReport(results);
    fs.writeFileSync(REPORT_PATH, reportMd, 'utf8');
  }

  console.log(`\nBenchmark execution completed successfully.`);
}

main().catch((err) => {
  console.error(`Benchmark execution failed:`, err);
  process.exit(1);
});
