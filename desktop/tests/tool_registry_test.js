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

  console.log(`\nAll ${passed} ToolRegistry assertions passed.`);
}

runToolRegistryTests().catch((error) => {
  console.error('ToolRegistry tests failed:', error);
  process.exit(1);
});
