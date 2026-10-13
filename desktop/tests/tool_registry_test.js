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
  isConsentCheckbox,
  checkFieldCompatibility,
  mapHeuristicFallback,
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

  await test('Compatibility Gate enforces type structural constraints before fill', async () => {
    // Gate tests: name into email field rejected
    const nameInEmail = checkFieldCompatibility({ type: 'email', label: 'Email' }, 'Aarav Sharma');
    assert.strictEqual(nameInEmail.valid, false, 'Name into email field must be rejected');

    // Phone into date field rejected
    const phoneInDate = checkFieldCompatibility({ type: 'date', label: 'Date of Birth' }, '+91 98450 78901');
    assert.strictEqual(phoneInDate.valid, false, 'Phone into date field must be rejected');

    // Non-numeric into number field rejected
    const textInNumber = checkFieldCompatibility({ type: 'number', label: 'Age' }, 'fifteen');
    assert.strictEqual(textInNumber.valid, false, 'Non-numeric into number field must be rejected');

    // Invalid telephone (too short or too long) rejected
    const shortPhone = checkFieldCompatibility({ type: 'tel', label: 'Phone' }, '12345');
    assert.strictEqual(shortPhone.valid, false, 'Phone with < 7 digits must be rejected');
    const longPhone = checkFieldCompatibility({ type: 'tel', label: 'Phone' }, '1234567890123456');
    assert.strictEqual(longPhone.valid, false, 'Phone with > 15 digits must be rejected');

    // Select/radio value not matching choices rejected
    const invalidOption = checkFieldCompatibility(
      { type: 'select', label: 'Gender', options: ['Male', 'Female', 'Other'] },
      'Unknown Category'
    );
    assert.strictEqual(invalidOption.valid, false, 'Invalid option into select must be rejected');

    // Non-boolean into checkbox rejected
    const invalidCheckbox = checkFieldCompatibility({ type: 'checkbox', label: 'Opt in' }, 'maybe');
    assert.strictEqual(invalidCheckbox.valid, false, 'Non-boolean into checkbox must be rejected');

    // Valid values must pass the gate
    assert.strictEqual(checkFieldCompatibility({ type: 'email', label: 'Email' }, 'aarav@example.com').valid, true);
    assert.strictEqual(checkFieldCompatibility({ type: 'tel', label: 'Phone' }, '+91 98450 78901').valid, true);
    assert.strictEqual(checkFieldCompatibility({ type: 'date', label: 'Date of Birth' }, '2010-05-20').valid, true);
    assert.strictEqual(checkFieldCompatibility({ type: 'date', label: 'Date of Birth' }, '20/05/2010').valid, true);
    assert.strictEqual(checkFieldCompatibility({ type: 'number', label: 'Age' }, '15').valid, true);
    assert.strictEqual(
      checkFieldCompatibility({ type: 'select', label: 'Gender', options: ['Male', 'Female'] }, 'Male').valid,
      true
    );
    assert.strictEqual(checkFieldCompatibility({ type: 'checkbox', label: 'Terms' }, true).valid, true);
    assert.strictEqual(checkFieldCompatibility({ type: 'checkbox', label: 'Terms' }, 'yes').valid, true);
  });

  await test('Consent detector recognizes legal/agreement checkboxes and skips auto-ticking', async () => {
    assert.strictEqual(
      isConsentCheckbox({ type: 'checkbox', label: 'I agree to the terms and conditions*' }),
      true
    );
    assert.strictEqual(
      isConsentCheckbox({ type: 'checkbox', label: 'Student Undertaking and Declaration' }),
      true
    );
    assert.strictEqual(
      isConsentCheckbox({ type: 'checkbox', label: 'Parent Consent Required' }),
      true
    );
    assert.strictEqual(
      isConsentCheckbox({ type: 'checkbox', label: 'Hostel Accommodation Required' }),
      false
    );
    assert.strictEqual(
      isConsentCheckbox({ type: 'text', label: 'I agree to the terms and conditions*' }),
      false
    );
  });

  await test('Heuristic Mapper label->expected-key table test and confidence calibration', async () => {
    const facts = [
      { key: 'student_name', label: 'Student Full Name', value: 'Aarav Sharma', confidence: 0.99 },
      { key: 'email', label: 'Email Address', value: 'aarav@example.com', confidence: 0.99 },
      { key: 'phone', label: 'Contact Phone Number', value: '+919876543210', confidence: 0.99 },
      { key: 'address', label: 'Residential Address', value: '123 MG Road', confidence: 0.99 },
      { key: 'pincode', label: 'Pincode / Zip Code', value: '560001', confidence: 0.99 },
      { key: 'father_name', label: "Father's Name", value: 'Rajesh Sharma', confidence: 0.99 },
      { key: 'previous_school', label: 'Previous School Attended', value: 'Delhi Public School', confidence: 0.99 },
    ];

    const testCases = [
      { label: 'Student Email Address*', type: 'email', expectedKey: 'email' },
      { label: 'E-mail address:', type: 'text', expectedKey: 'email' },
      { label: 'Contact Phone Number*', type: 'tel', expectedKey: 'phone' },
      { label: 'Residential Address*', type: 'textarea', expectedKey: 'address' },
      { label: 'Name of Student *', type: 'text', expectedKey: 'student_name' },
      { label: 'Pincode / Zip Code*', type: 'text', expectedKey: 'pincode' },
      { label: "Father's Name*", type: 'text', expectedKey: 'father_name' },
      { label: 'Delivery instructions:', type: 'text', expectedKey: null },
      { label: 'I agree to the school admission terms and conditions*', type: 'checkbox', expectedKey: 'consent' },
    ];

    for (const { label, type, expectedKey } of testCases) {
      const field = {
        ref: 'f_test',
        label,
        type,
        required: true,
      };
      const result = mapHeuristicFallback([field], facts);

      if (expectedKey === null) {
        assert.ok(
          result.unmapped_fields.includes('f_test'),
          `'${label}' was expected to be unmapped, but got mapped: ${JSON.stringify(result.mappings)}`
        );
        const mapped = result.mappings.find((m) => m.field_ref === 'f_test' && m.fact_key);
        assert.strictEqual(
          mapped,
          undefined,
          `'${label}' was expected to have no fact_key, got ${JSON.stringify(mapped)}`
        );
      } else {
        const match = result.mappings.find((m) => m.field_ref === 'f_test' && m.fact_key === expectedKey);
        assert.ok(
          match,
          `'${label}' was expected to map to '${expectedKey}', got mappings: ${JSON.stringify(result.mappings)}`
        );
        assert.ok(
          match.confidence >= 0.6,
          `Confidence ${match.confidence} for '${label}' must be >= 0.6 threshold`
        );
        assert.notStrictEqual(
          match.confidence,
          0.95,
          `Confidence for '${label}' must be calibrated, never constant 0.95`
        );
      }
    }
  });

  await test('One fact, one field: duplicate fact assignments keep higher score and unmap other', async () => {
    const facts = [
      { key: 'student_name', label: 'Student Full Name', value: 'Aarav Sharma', confidence: 0.99 },
      { key: 'email', label: 'Email Address', value: 'aarav@example.com', confidence: 0.99 },
    ];

    const fields = [
      { ref: 'f1', label: 'Student Email Address*', type: 'email', required: true },
      { ref: 'f2', label: 'E-mail address:', type: 'email', required: true },
    ];

    const result = mapHeuristicFallback(fields, facts);
    const emailMappings = result.mappings.filter((m) => m.fact_key === 'email');
    assert.strictEqual(emailMappings.length, 1, 'Only one field should be mapped to the same fact key');
    assert.ok(emailMappings[0].confidence in [0.7, 0.9] || emailMappings[0].confidence >= 0.7);
    assert.notStrictEqual(emailMappings[0].confidence, 0.95);

    const otherRef = emailMappings[0].field_ref === 'f1' ? 'f2' : 'f1';
    assert.ok(result.unmapped_fields.includes(otherRef), 'Other field must be marked unmapped');
    assert.ok(
      result.clarifications_required.some((c) => c.field_ref === otherRef),
      'Clarification must be raised for the other unmapped field'
    );

    // Near-identical labels: both can be mapped
    const identicalFields = [
      { ref: 'f1', label: 'Student Full Name*', type: 'text', required: true },
      { ref: 'f2', label: 'Student Full Name:', type: 'text', required: true },
    ];
    const identicalResult = mapHeuristicFallback(identicalFields, facts);
    const nameMappings = identicalResult.mappings.filter((m) => m.fact_key === 'student_name');
    assert.strictEqual(nameMappings.length, 2, 'Near-identical labels should both be mapped');
  });

  console.log(`\nAll ${passed} ToolRegistry assertions passed.`);
}

runToolRegistryTests().catch((error) => {
  console.error('ToolRegistry tests failed:', error);
  process.exit(1);
});
