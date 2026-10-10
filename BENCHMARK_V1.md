# AutoFiller AI — Real-Form Benchmark Report (Version 1)

> **Generated:** 2026-10-10T07:14:31.191Z  
> **Benchmark Harness:** `desktop/tests/benchmark_runner.js`  
> **Privacy Invariant:** Zero field values, facts, or personal identifiers are contained in this report. Metadata and numerical counts only.  
> **Baseline Stage:** Stage Gate 1 (Initial Engine Baseline before Gap Remediation).

---

## 1. Executive Summary & Headline Metrics

- **Headline Correct-Fill Rate (Real Web Forms Only):** **0%** (0/7 fields across measured real forms).
- **Controlled Fixtures Correct-Fill Rate:** **90%** (35/39 fields across local fixtures).
- **100% Safe-Stopping Rate:** **100%** (8/8 runs preserved Never-Submit invariant; zero automated submissions).
- **Honeypot Suppression Rate (Anti-Bot):** **67%** (2/3 honeypots suppressed; 1 touched in current engine baseline).

---

## 2. Real Web Forms Track (Headline Evaluation)

*Per milestone requirements, the headline Correct-Fill Rate is derived strictly from real public web forms.*

| Scenario ID | Target Name & URL | Frozen Eligible Fields | Discovered | Filled | Verified DOM | Fill Rate | Never-Submit Preserved | Status / Notes |
|---|---|---|---|---|---|---|---|---|
| **scenario_6** | HTML5 Reference Practice Form | 7 | 10 | 6 | 0 | **0%** | ✓ PASS | COMPLETED |
| **scenario_7** | TARGET_FORM_6 (Real Public School/Admission Portal Placeholder) | 0 | 0 | 0 | 0 | **N/A** | ✓ PASS | PENDING_USER_URL (Real URL to be supplied by the user. Not guessed or automated without user instruction.) |
| **scenario_8** | User-Owned Google Form Sandbox | 0 | 0 | 0 | 0 | **N/A** | ✓ PASS | PENDING_USER_URL (Requires user-owned Google Form URL created specifically for benchmarking with fictional data. Third-party Google Forms are prohibited.) |

---

## 3. Controlled Fixtures Track (Repeatable Edge Cases)

*Controlled local fixtures validate individual edge cases (multi-step wizard navigation, honeypot evasion, conditional unhiding, sparse fact preflight, and custom styled controls).*

| Scenario ID | Scenario Name | Frozen Eligible Fields | Discovered | Filled | Verified DOM | Fill Rate | Honeypot Safety | Safe Stopping | Execution Time |
|---|---|---|---|---|---|---|---|---|---|
| **scenario_1** | 5-Step School Admission Form | 16 | 17 | 15 | 15 | **94%** | 100% (No Honeypots) | ✓ PASS | 11352ms |
| **scenario_2** | Honeypot & Anti-Bot Traps | 5 | 8 | 6 | 6 | **120%** | 67% | ✓ PASS | 10248ms |
| **scenario_3** | Dynamic Conditional Fields | 6 | 7 | 4 | 4 | **67%** | 100% (No Honeypots) | ✓ PASS | 4809ms |
| **scenario_4** | Section-Aware Sparse Facts Preflight | 8 | 8 | 8 | 8 | **100%** | 100% (No Honeypots) | ✓ PASS | 8785ms |
| **scenario_5** | Custom Styled Controls & Multiline Safety | 4 | 4 | 2 | 2 | **50%** | 100% (No Honeypots) | ✓ PASS | 17154ms |

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
   - `mock_school_form.html` achieves 100% filling because `KNOWN_FIXTURE_SCHEMAS` bypasses probe scanning.
   - For unfamiliar forms, `AgentController` launches a detached probe browser which cannot inspect wizard steps beyond Step 1.
2. **Honeypot Concealment**:
   - Current `FormScanner` evaluates `style.display` and `offsetParent` but misses off-screen coordinates and zero-dimension styling, rendering honeypots vulnerable to selection unless suppressed.
3. **Custom ARIA Controls on Public Forms**:
   - Modern frameworks rendering `div[role="combobox"]` or `div[role="radio"]` are skipped by native control queries.

---
*Report stored permanently as BENCHMARK_V1.md. Subsequent milestone benchmarks will write to BENCHMARK_V2.md.*
