/**
 * Automated tests asserting the ToolRegistry dispatches through policy enforcement.
 *
 * Verifies the guarantee from IMPORTANT.md that the model is never the security
 * boundary: unregistered, forbidden, and malformed invocations must be refused
 * before any browser side effect can occur.
 */

const assert = require('assert');
const path = require('path');
const DIST = path.resolve(__dirname, '../dist-electron');

const { ToolRegistry, ToolExecutionError } = require(path.join(DIST, 'agent/ToolRegistry'));
const { PolicyEngine } = require(path.join(DIST, 'policy/PolicyEngine'));
const {
  matchOption,
  OPTION_CONFIDENCE_THRESHOLD,
} = require(path.join(DIST, 'agent/OptionMatcher'));

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
 * Build a context whose browser calls record invocations so side effects are observable.
 *
 * @returns {{context: object, calls: string[]}} Tool context plus a call log.
 */
function makeContext() {
  const calls = [];
  const context = {
    policyEngine: new PolicyEngine(),
    browserManager: {
      fillText: async (fieldRef) => {
        calls.push(`fillText:${fieldRef}`);
        return { success: true, actualValue: 'x', expectedValue: 'x' };
      },
      selectOption: async (fieldRef) => {
        calls.push(`selectOption:${fieldRef}`);
        return { success: true, selectedOption: 'x', expectedOption: 'x' };
      },
      selectRadio: async (fieldRef) => {
        calls.push(`selectRadio:${fieldRef}`);
        return { success: true, selectedValue: 'x' };
      },
      setCheckbox: async (fieldRef) => {
        calls.push(`setCheckbox:${fieldRef}`);
        return { success: true, isChecked: true, expectedChecked: true };
      },
      verifyField: async (fieldRef) => {
        calls.push(`verifyField:${fieldRef}`);
        return { verified: true, actualValue: 'x', expectedValue: 'x' };
      },
      scrollToField: async (fieldRef) => {
        calls.push(`scrollToField:${fieldRef}`);
      },
      scanActiveForm: async () => {
        calls.push('scanActiveForm');
        return { url: 'file://form.html', title: 'Form', fields: [] };
      },
      clickPagination: async (label) => {
        calls.push(`clickPagination:${label}`);
        return { success: true, label };
      },
    },
    backendClient: {
      extractDocument: async () => {
        calls.push('extractDocument');
        return { document_name: 'doc', facts: [], fact_count: 0 };
      },
    },
    sessionId: 'session_test',
    emitEvent: () => undefined,
    requestClarification: async () => 'answer',
  };
  return { context, calls };
}

async function runToolRegistryTests() {
  console.log('Running AutoFiller ToolRegistry dispatch tests...');
  const registry = new ToolRegistry();

  await test('refuses an unregistered tool without touching the browser', async () => {
    const { context, calls } = makeContext();
    await assert.rejects(
      () => registry.dispatch('execute_shell', { command: 'rm -rf /' }, context),
      (error) => error instanceof ToolExecutionError && error.code === 'TOOL_NOT_REGISTERED'
    );
    assert.deepStrictEqual(calls, []);
  });

  await test('refuses a mutating tool with no field reference', async () => {
    const { context, calls } = makeContext();
    await assert.rejects(
      () => registry.dispatch('fill_text', { value: 'Aarav' }, context),
      (error) => error.code === 'INVALID_FIELD_REFERENCE'
    );
    assert.deepStrictEqual(calls, []);
  });

  await test('refuses a crafted selector passed as a field reference', async () => {
    const { context, calls } = makeContext();
    await assert.rejects(
      () => registry.dispatch('fill_text', { fieldRef: '#password', value: 'x' }, context),
      (error) => error.code === 'INVALID_FIELD_REFERENCE'
    );
    assert.deepStrictEqual(calls, []);
  });

  await test('executes a valid fill_text through to the browser', async () => {
    const { context, calls } = makeContext();
    const result = await registry.dispatch('fill_text', { fieldRef: 'field_001', value: 'Aarav' }, context);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(calls, ['fillText:field_001']);
  });

  await test('executes typed mutating tools with the correct browser call', async () => {
    const cases = [
      ['select_option', { fieldRef: 'field_002', option: 'Male' }, 'selectOption:field_002'],
      ['select_radio', { fieldRef: 'field_003', optionValue: 'Yes' }, 'selectRadio:field_003'],
      ['set_checkbox', { fieldRef: 'field_004', checked: true }, 'setCheckbox:field_004'],
      ['verify_field', { fieldRef: 'field_005', expectedValue: 'x' }, 'verifyField:field_005'],
      ['scroll_to_field', { fieldRef: 'field_006' }, 'scrollToField:field_006'],
    ];
    for (const [tool, args, expected] of cases) {
      const { context, calls } = makeContext();
      await registry.dispatch(tool, args, context);
      assert.deepStrictEqual(calls, [expected], `${tool} produced ${calls.join(',')}`);
    }
  });

  await test('rejects malformed arguments before executing', async () => {
    const { context, calls } = makeContext();
    await assert.rejects(
      () => registry.dispatch('select_option', { fieldRef: 'field_002' }, context),
      (error) => error.code === 'INVALID_TOOL_INPUT'
    );
    assert.deepStrictEqual(calls, []);
  });

  await test('executes click_pagination with valid label through policy enforcement', async () => {
    const { context, calls } = makeContext();
    const res = await registry.dispatch('click_pagination', { label: 'Continue' }, context);
    assert.strictEqual(res.success, true);
    assert.deepStrictEqual(calls, ['clickPagination:Continue']);

    // Policy blocks submission terms from click_pagination
    await assert.rejects(
      () => registry.dispatch('click_pagination', { label: 'Submit Application' }, context),
      (error) => error instanceof ToolExecutionError && error.code === 'DENIED_FINAL_SUBMISSION'
    );
  });

  await test('OptionMatcher normalizes case, punctuation, and synonyms for dropdowns and radios', async () => {
    // Gender synonym matching
    const maleMatch = matchOption('m', ['Male', 'Female', 'Other']);
    assert.strictEqual(maleMatch.matchedOption, 'Male');
    assert.strictEqual(maleMatch.needsClarification, false);

    const femaleMatch = matchOption('F', ['Male', 'Female', 'Other']);
    assert.strictEqual(femaleMatch.matchedOption, 'Female');
    assert.strictEqual(femaleMatch.needsClarification, false);

    // Category / Caste synonyms with punctuation
    const obcMatch = matchOption('O.B.C. - N.C.L.', ['General', 'OBC', 'SC', 'ST']);
    assert.strictEqual(obcMatch.matchedOption, 'OBC');
    assert.strictEqual(obcMatch.needsClarification, false);

    const genMatch = matchOption('Gen', ['General', 'OBC', 'SC', 'ST']);
    assert.strictEqual(genMatch.matchedOption, 'General');
    assert.strictEqual(genMatch.needsClarification, false);

    // Booleans / Acknowledgements
    const yesMatch = matchOption('Y', ['Yes', 'No']);
    assert.strictEqual(yesMatch.matchedOption, 'Yes');
    assert.strictEqual(yesMatch.needsClarification, false);

    const noMatch = matchOption('0', ['Yes', 'No']);
    assert.strictEqual(noMatch.matchedOption, 'No');
    assert.strictEqual(noMatch.needsClarification, false);
  });

  await test('OptionMatcher performs fuzzy similarity matching with confidence >= 0.80', async () => {
    // High fuzzy similarity
    const fuzzyMatch = matchOption('Grade 10th', ['Grade 1', 'Grade 5', 'Grade 10']);
    assert.strictEqual(fuzzyMatch.matchedOption, 'Grade 10');
    assert.strictEqual(fuzzyMatch.needsClarification, false);
    assert.ok(fuzzyMatch.confidence >= OPTION_CONFIDENCE_THRESHOLD);
  });

  await test('OptionMatcher flags unrecognized/low-confidence options for clarification without guessing', async () => {
    // Mismatched option below threshold must NOT be guessed
    const badMatch = matchOption('Grade 99 (not an option)', ['Grade 1', 'Grade 5', 'Grade 10']);
    assert.strictEqual(badMatch.matchedOption, null);
    assert.strictEqual(badMatch.needsClarification, true);
    assert.ok(badMatch.confidence < OPTION_CONFIDENCE_THRESHOLD);

    // Empty/null values
    const emptyMatch = matchOption('', ['Male', 'Female']);
    assert.strictEqual(emptyMatch.matchedOption, null);
    assert.strictEqual(emptyMatch.needsClarification, true);
  });

  console.log(`\nAll ${passed} ToolRegistry assertions passed.`);
}

runToolRegistryTests().catch((error) => {
  console.error('ToolRegistry tests failed:', error);
  process.exit(1);
});
