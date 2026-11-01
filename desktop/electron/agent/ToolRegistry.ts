/**
 * ToolRegistry: Restricted AutoFiller AI domain tools, option matching, and form schemas.
 *
 * Consolidates agent tool dispatch, OptionMatcher heuristics, and FormSchemaRegistry
 * into a single unified agent capabilities toolkit.
 */

import { BrowserManager } from '../browser/BrowserManager';
import { PolicyEngine } from '../policy/PolicyEngine';
import { BackendClient } from '../services/BackendClient';
import {
  AgentEventPayload,
  ClarificationPromptPayload,
  ClarificationRequest,
  ExtractedFact,
  FactDescriptor,
  FieldMapping,
  FormFieldSnapshot,
  FormSnapshot,
} from '../shared/types';

/* ========================================================================= */
/* 1. Form Schema Fixture Registry                                          */
/* ========================================================================= */

export const KNOWN_FORM_SCHEMAS: Record<string, FormFieldSnapshot[]> = {
  'mock_school_form.html': [
    { ref: 'field_001', label: 'Student Full Name', type: 'text', required: true, disabled: false, visible: true },
    { ref: 'field_002', label: 'Date of Birth', type: 'date', required: true, disabled: false, visible: true },
    { ref: 'field_003', label: 'Gender', type: 'select', required: true, disabled: false, visible: true, options: ['Male', 'Female', 'Other'] },
    { ref: 'field_004', label: 'Student Email Address', type: 'email', required: true, disabled: false, visible: false },
    { ref: 'field_005', label: 'Contact Phone Number', type: 'text', required: true, disabled: false, visible: false },
    { ref: 'field_006', label: 'Residential Address', type: 'textarea', required: true, disabled: false, visible: false },
    { ref: 'field_007', label: 'City', type: 'text', required: true, disabled: false, visible: false },
    { ref: 'field_008', label: 'State', type: 'text', required: true, disabled: false, visible: false },
    { ref: 'field_009', label: 'Pincode / Zip Code', type: 'text', required: true, disabled: false, visible: false },
    { ref: 'field_010', label: "Father's Name", type: 'text', required: true, disabled: false, visible: false },
    { ref: 'field_011', label: "Mother's Name", type: 'text', required: true, disabled: false, visible: false },
    { ref: 'field_012', label: 'Previous School Attended', type: 'text', required: false, disabled: false, visible: false },
    { ref: 'field_013', label: 'Applying Grade / Class', type: 'select', required: true, disabled: false, visible: false, options: ['Grade 1', 'Grade 5', 'Grade 10'] },
    { ref: 'field_014', label: 'Does student have allergies?', type: 'radio', required: false, disabled: false, visible: false, options: ['Yes', 'No'] },
    { ref: 'field_015', label: 'Does student require transport?', type: 'radio', required: false, disabled: false, visible: false, options: ['Yes', 'No'] },
    { ref: 'field_016', label: 'I agree to the school admission terms and conditions', type: 'checkbox', required: true, disabled: false, visible: false },
  ],
};

/**
 * Resolve whether a target URL matches a registered schema fixture.
 *
 * @param url The form target URL.
 * @returns A cloned FormSnapshot when a match exists, otherwise null.
 */
export function lookupKnownFormSchema(url: string): FormSnapshot | null {
  if (!url) return null;
  const lowerUrl = url.toLowerCase();
  for (const [key, fields] of Object.entries(KNOWN_FORM_SCHEMAS)) {
    const baseKey = key.toLowerCase().replace(/\.html$/, '');
    if (lowerUrl.includes(key.toLowerCase()) || lowerUrl.includes(baseKey)) {
      return {
        url,
        title: 'Greenwood Academy - Mock School Admission Form',
        fields: fields.map((f) => ({ ...f })),
      };
    }
  }
  return null;
}

/* ========================================================================= */
/* 2. Option Matcher & Heuristic Mapping Engine                             */
/* ========================================================================= */

export const OPTION_CONFIDENCE_THRESHOLD = 0.8;

const SYNONYM_CLUSTERS: string[][] = [
  // Gender
  ['male', 'm', 'man', 'boy'],
  ['female', 'f', 'woman', 'girl'],
  ['other', 'transgender', 'third gender', 'non binary', 'nonbinary'],

  // Category / Caste
  ['general', 'gen', 'open', 'ur', 'unreserved'],
  ['obc', 'obc ncl', 'obcncl', 'other backward class', 'other backward classes'],
  ['sc', 'scheduled caste', 'scheduled castes'],
  ['st', 'scheduled tribe', 'scheduled tribes'],
  ['ews', 'economically weaker section'],

  // Booleans / Acknowledgements
  ['yes', 'y', 'true', '1', 'agree', 'accepted', 'applicable', 'required'],
  ['no', 'n', 'false', '0', 'disagree', 'declined', 'not applicable', 'na', 'none'],

  // Marital Status
  ['single', 'unmarried', 'never married'],
  ['married'],

  // Blood groups
  ['o+', 'o positive', 'opos'],
  ['o-', 'o negative', 'oneg'],
  ['a+', 'a positive', 'apos'],
  ['a-', 'a negative', 'aneg'],
  ['b+', 'b positive', 'bpos'],
  ['b-', 'b negative', 'bneg'],
  ['ab+', 'ab positive', 'abpos'],
  ['ab-', 'ab negative', 'abneg'],
];

const SYNONYM_MAP = new Map<string, string>();
for (const cluster of SYNONYM_CLUSTERS) {
  const canonical = cluster[0];
  for (const item of cluster) {
    SYNONYM_MAP.set(item, canonical);
  }
}

/**
 * Normalize an option string by lowercasing, trimming, and normalizing punctuation.
 */
export function normalizeOptionText(text: string): string {
  if (!text) return '';
  let s = String(text).toLowerCase().trim();
  s = s.replace(/\bpositive\b/g, '+').replace(/\bnegative\b/g, '-');
  // Strip periods completely so acronyms like O.B.C. or N.C.L. normalize directly
  s = s.replace(/\./g, '');
  // Normalize ordinal numbers: 1st -> 1, 2nd -> 2, 3rd -> 3, 10th -> 10
  s = s.replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1');
  // Strip punctuation while preserving + and - for blood groups
  s = s.replace(/[\-_/,;:()'"!?\\#@$%^&*=[\]{}|`~]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Generate a frequency map of adjacent character bigrams.
 */
function getBigrams(str: string): Map<string, number> {
  const bigrams = new Map<string, number>();
  for (let i = 0; i < str.length - 1; i++) {
    const bg = str.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
  }
  return bigrams;
}

/**
 * Calculate similarity score between two candidate strings (0.0 to 1.0).
 */
export function calculateOptionSimilarity(a: string, b: string): number {
  const normA = normalizeOptionText(a);
  const normB = normalizeOptionText(b);

  if (!normA || !normB) return 0.0;
  if (normA === normB) return 1.0;

  // Check synonym dictionary
  const synA = SYNONYM_MAP.get(normA);
  const synB = SYNONYM_MAP.get(normB);
  if (synA && synB && synA === synB) return 1.0;
  if (synA && synA === normB) return 1.0;
  if (synB && synB === normA) return 1.0;

  // Substring containment for longer tokens, respecting number/digit boundaries
  if (normA.length >= 3 && normB.length >= 3) {
    const [shorter, longer] = normA.length <= normB.length ? [normA, normB] : [normB, normA];
    const idx = longer.indexOf(shorter);
    if (idx !== -1) {
      // Ensure we didn't match a partial number (e.g. '1' inside '10')
      const charBefore = idx > 0 ? longer[idx - 1] : ' ';
      const charAfter = idx + shorter.length < longer.length ? longer[idx + shorter.length] : ' ';
      const digitBoundaryOk =
        !(/\d/.test(shorter[0]) && /\d/.test(charBefore)) &&
        !(/\d/.test(shorter[shorter.length - 1]) && /\d/.test(charAfter));

      if (digitBoundaryOk) {
        const ratio = shorter.length / longer.length;
        if (ratio >= 0.7) {
          return Math.min(1.0, 0.85 + 0.15 * ratio);
        }
      }
    }
  }

  // Short strings (< 3 chars) without synonym match
  if (normA.length < 3 || normB.length < 3) {
    return normA === normB ? 1.0 : 0.0;
  }

  // Sørensen-Dice bigram similarity
  const bigramsA = getBigrams(normA);
  const bigramsB = getBigrams(normB);
  if (bigramsA.size === 0 || bigramsB.size === 0) {
    return normA === normB ? 1.0 : 0.0;
  }

  let intersection = 0;
  for (const [bg, countA] of bigramsA.entries()) {
    const countB = bigramsB.get(bg) || 0;
    intersection += Math.min(countA, countB);
  }

  let total = 0;
  for (const count of bigramsA.values()) total += count;
  for (const count of bigramsB.values()) total += count;

  return total > 0 ? (2.0 * intersection) / total : 0.0;
}

export interface OptionCandidateScore {
  option: string;
  score: number;
}

export interface OptionMatchResult {
  matchedOption: string | null;
  confidence: number;
  needsClarification: boolean;
  candidates: OptionCandidateScore[];
}

/**
 * Match a raw fact value against a list of available form options.
 *
 * @param factValue Raw fact value from the local profile/vault.
 * @param availableOptions Candidate options from the select dropdown or radio group.
 * @param threshold Minimum confidence score required to auto-select (default: 0.8).
 * @returns Best matching option, confidence, and whether human clarification is needed.
 */
export function matchOption(
  factValue: string,
  availableOptions: string[],
  threshold: number = OPTION_CONFIDENCE_THRESHOLD
): OptionMatchResult {
  if (!availableOptions || availableOptions.length === 0) {
    return {
      matchedOption: factValue,
      confidence: 1.0,
      needsClarification: false,
      candidates: [],
    };
  }

  const rawVal = String(factValue ?? '').trim();
  if (!rawVal) {
    return {
      matchedOption: null,
      confidence: 0.0,
      needsClarification: true,
      candidates: [],
    };
  }

  // First check exact case-sensitive match
  const exact = availableOptions.find((opt) => opt === rawVal);
  if (exact) {
    return {
      matchedOption: exact,
      confidence: 1.0,
      needsClarification: false,
      candidates: [{ option: exact, score: 1.0 }],
    };
  }

  // Score all options
  const candidates: OptionCandidateScore[] = availableOptions.map((opt) => ({
    option: opt,
    score: calculateOptionSimilarity(rawVal, opt),
  }));

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Check for ambiguous top scores (e.g. two candidates within 0.05 of each other and not an exact synonym match)
  const isAmbiguous =
    candidates.length > 1 &&
    best.score >= threshold &&
    best.score < 0.99 &&
    candidates[1].score >= threshold &&
    best.score - candidates[1].score < 0.05;

  if (best && best.score >= threshold && !isAmbiguous) {
    return {
      matchedOption: best.option,
      confidence: best.score,
      needsClarification: false,
      candidates,
    };
  }

  return {
    matchedOption: null,
    confidence: best ? best.score : 0.0,
    needsClarification: true,
    candidates,
  };
}

/**
 * Detect consent or agreement checkboxes by matching legal keywords.
 * Never auto-ticked; left for operator action.
 */
export function isConsentCheckbox(field: { type?: string; label?: string }): boolean {
  if (field.type !== 'checkbox') return false;
  const label = (field.label || '').toLowerCase();
  return /(agree|consent|terms|declaration|undertaking)/i.test(label);
}

export interface CompatibilityResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate that a proposed value is structurally compatible with a field control type.
 * Gate rules:
 * - email field: email-shaped value
 * - tel field: 7-15 digits
 * - date field: parseable date
 * - number field: numeric
 * - select/radio: matches an option via OptionMatcher
 * - checkbox: boolean-like value
 */
export function checkFieldCompatibility(
  field: FormFieldSnapshot,
  value: unknown
): CompatibilityResult {
  const str = String(value ?? '').trim();
  if (!str) {
    return { valid: false, reason: 'Value is empty' };
  }

  const fieldType = (field.type || 'text').toLowerCase();

  // (a) email field needs an email-shaped value
  if (fieldType === 'email') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(str)) {
      return { valid: false, reason: 'Invalid email format' };
    }
    return { valid: true };
  }

  // (b) tel field needs digits (7-15)
  if (fieldType === 'tel') {
    const digits = str.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) {
      return { valid: false, reason: 'Telephone number must contain 7 to 15 digits' };
    }
    return { valid: true };
  }

  // (c) date field needs a parseable date
  if (fieldType === 'date') {
    const dmyPattern = /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/;
    const ymdPattern = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/;
    const textPattern = /^\d{1,2}\s+[A-Za-z]+\s+\d{2,4}$/;
    if (dmyPattern.test(str) || ymdPattern.test(str) || textPattern.test(str)) {
      return { valid: true };
    }
    const timestamp = Date.parse(str);
    if (!isNaN(timestamp)) {
      if (/^\+?\d{6,}$/.test(str)) {
        return { valid: false, reason: 'Value is not a valid date' };
      }
      return { valid: true };
    }
    return { valid: false, reason: 'Date is not parseable' };
  }

  // (d) number field needs numeric value
  if (fieldType === 'number') {
    const num = Number(str.replace(/,/g, ''));
    if (isNaN(num)) {
      return { valid: false, reason: 'Value is not numeric' };
    }
    return { valid: true };
  }

  // (e) select / combobox / radio value must match an option via OptionMatcher
  if ((fieldType === 'select' || fieldType === 'combobox' || fieldType === 'radio') && field.options && field.options.length > 0) {
    const match = matchOption(str, field.options);
    if (!match.matchedOption || match.needsClarification) {
      return { valid: false, reason: 'Option does not match available choices' };
    }
    return { valid: true };
  }

  // (f) checkbox needs a boolean-like value
  if (fieldType === 'checkbox') {
    const lower = str.toLowerCase();
    const booleanLike = new Set([
      'true', 'false', 'yes', 'no', 'y', 'n', '1', '0', 'on', 'off',
      'checked', 'unchecked', 'agree', 'accepted', 'declined'
    ]);
    if (!booleanLike.has(lower) && typeof value !== 'boolean') {
      return { valid: false, reason: 'Checkbox requires a boolean-like value' };
    }
    return { valid: true };
  }

  return { valid: true };
}

/**
 * Deterministic heuristic mapper ranking signals:
 * (a) autocomplete attribute tokens
 * (b) input type
 * (c) label words matched as whole words against key names and aliases (most specific wins).
 * Calibrate confidence: exact/whole-phrase 0.9, whole-word 0.7, partial 0.4. Below 0.6 means unmapped.
 * One fact, one field: duplicate fact assignments keep higher score; other left unmapped (clarify).
 */
export function mapHeuristicFallback(
  formSnapshot: FormSnapshot | FormFieldSnapshot[] | { fields: FormFieldSnapshot[] },
  facts: Array<FactDescriptor | ExtractedFact>
): {
  mappings: FieldMapping[];
  clarifications_required: ClarificationRequest[];
  unmapped_fields: string[];
} {
  const targetFields: FormFieldSnapshot[] = Array.isArray(formSnapshot)
    ? formSnapshot
    : formSnapshot?.fields || [];
  const factDict = new Map<string, FactDescriptor | ExtractedFact>();
  for (const f of facts) {
    factDict.set(f.key.toLowerCase().trim(), f);
  }

  const phoneFacts = facts.filter((f) =>
    ['phone', 'mobile', 'tel', 'contact'].some((k) => f.key.toLowerCase().includes(k))
  );

  function labelsNearIdentical(a: string, b: string): boolean {
    const cleanA = (a || '').toLowerCase().replace(/[*:\s]+$/, '').trim().replace(/\s+/g, ' ');
    const cleanB = (b || '').toLowerCase().replace(/[*:\s]+$/, '').trim().replace(/\s+/g, ' ');
    return cleanA === cleanB;
  }

  interface CatSpec {
    id: string;
    specificity: number;
    autocompleteTokens: Set<string>;
    inputTypes: Set<string>;
    exactPhrases: string[];
    wholeWords: string[];
    keys: string[];
  }

  const categorySpecs: CatSpec[] = [
    {
      id: 'email',
      specificity: 100,
      autocompleteTokens: new Set(['email']),
      inputTypes: new Set(['email']),
      exactPhrases: [
        'student email address',
        'student email',
        'email address',
        'e-mail address',
        'email',
        'e-mail',
        'applicant email',
        'candidate email',
      ],
      wholeWords: ['email', 'mail'],
      keys: ['email', 'student_email', 'applicant_email', 'parent_email'],
    },
    {
      id: 'phone',
      specificity: 90,
      autocompleteTokens: new Set(['tel', 'tel-national', 'mobile']),
      inputTypes: new Set(['tel']),
      exactPhrases: [
        'contact phone number',
        'contact phone',
        'contact number',
        'mobile number',
        'phone number',
        'telephone number',
        'mobile',
        'phone',
        'telephone',
        'tel',
        'primary mobile',
      ],
      wholeWords: ['phone', 'mobile', 'tel', 'telephone'],
      keys: ['phone', 'mobile', 'contact_phone', 'alternate_phone', 'emergency_phone', 'contact'],
    },
    {
      id: 'dob',
      specificity: 85,
      autocompleteTokens: new Set(['bday', 'bday-day', 'bday-month', 'bday-year']),
      inputTypes: new Set(['date']),
      exactPhrases: ['date of birth', 'birth date', 'dob', 'birthday'],
      wholeWords: ['dob', 'birth', 'birthday'],
      keys: ['dob', 'date_of_birth', 'birth_date'],
    },
    {
      id: 'pincode',
      specificity: 80,
      autocompleteTokens: new Set(['postal-code']),
      inputTypes: new Set(),
      exactPhrases: [
        'pincode / zip code',
        'pincode/zip code',
        'pincode / zip',
        'pincode',
        'zip code',
        'postal code',
        'pin code',
        'zipcode',
        'current pincode',
        'zip',
        'pin',
      ],
      wholeWords: ['pincode', 'zipcode', 'postal', 'zip', 'pin'],
      keys: ['pincode', 'zip_code', 'postal_code', 'zip', 'pin'],
    },
    {
      id: 'father_name',
      specificity: 75,
      autocompleteTokens: new Set(),
      inputTypes: new Set(),
      exactPhrases: [
        "father's name",
        'father name',
        'fathers name',
        "guardian's name",
        'guardian name',
        'father',
      ],
      wholeWords: ['father', 'fathers', 'guardian'],
      keys: ['father_name', 'father', 'guardian_name'],
    },
    {
      id: 'mother_name',
      specificity: 75,
      autocompleteTokens: new Set(),
      inputTypes: new Set(),
      exactPhrases: ["mother's name", 'mother name', 'mothers name', 'mother'],
      wholeWords: ['mother', 'mothers'],
      keys: ['mother_name', 'mother'],
    },
    {
      id: 'gender',
      specificity: 70,
      autocompleteTokens: new Set(['sex']),
      inputTypes: new Set(),
      exactPhrases: ['gender', 'sex'],
      wholeWords: ['gender', 'sex'],
      keys: ['gender', 'sex'],
    },
    {
      id: 'address',
      specificity: 60,
      autocompleteTokens: new Set(['street-address', 'address-line1', 'address-line2']),
      inputTypes: new Set(),
      exactPhrases: [
        'residential address',
        'permanent address',
        'current address',
        'street address',
        'home address',
        'address',
      ],
      wholeWords: ['address', 'residential'],
      keys: ['address', 'residential_address', 'permanent_address', 'street_address'],
    },
    {
      id: 'city',
      specificity: 60,
      autocompleteTokens: new Set(['address-level2']),
      inputTypes: new Set(),
      exactPhrases: ['city', 'town', 'current city'],
      wholeWords: ['city', 'town'],
      keys: ['city', 'town'],
    },
    {
      id: 'state',
      specificity: 60,
      autocompleteTokens: new Set(['address-level1']),
      inputTypes: new Set(),
      exactPhrases: ['state', 'province', 'current state'],
      wholeWords: ['state', 'province'],
      keys: ['state', 'province'],
    },
    {
      id: 'previous_school',
      specificity: 55,
      autocompleteTokens: new Set(),
      inputTypes: new Set(),
      exactPhrases: [
        'previous school attended',
        'previous school',
        'school attended',
        'last school attended',
      ],
      wholeWords: ['previous_school'],
      keys: ['previous_school', 'school'],
    },
    {
      id: 'grade',
      specificity: 50,
      autocompleteTokens: new Set(),
      inputTypes: new Set(),
      exactPhrases: [
        'applying grade / class',
        'applying grade',
        'applying class',
        'grade',
        'class',
        'standard',
      ],
      wholeWords: ['grade', 'class', 'standard'],
      keys: ['grade', 'class', 'applying_grade'],
    },
    {
      id: 'allergies',
      specificity: 50,
      autocompleteTokens: new Set(),
      inputTypes: new Set(),
      exactPhrases: ['does student have allergies', 'allergies', 'allergy'],
      wholeWords: ['allergies', 'allergy'],
      keys: ['allergies', 'allergy'],
    },
    {
      id: 'transport',
      specificity: 50,
      autocompleteTokens: new Set(),
      inputTypes: new Set(),
      exactPhrases: ['does student require transport', 'transport required', 'transport'],
      wholeWords: ['transport'],
      keys: ['transport'],
    },
    {
      id: 'consent',
      specificity: 50,
      autocompleteTokens: new Set(),
      inputTypes: new Set(['checkbox']),
      exactPhrases: [
        'i agree to the school admission terms and conditions',
        'terms and conditions',
        'terms & conditions',
        'declaration and undertaking',
        'agree to terms',
      ],
      wholeWords: ['agree', 'consent', 'terms', 'declaration', 'undertaking'],
      keys: ['consent', 'terms', 'agreement'],
    },
    {
      id: 'student_name',
      specificity: 20,
      autocompleteTokens: new Set(['name', 'given-name']),
      inputTypes: new Set(),
      exactPhrases: [
        'student full name',
        'name of student',
        "student's full name",
        "student's name",
        'student name',
        'full name',
        'applicant name',
        'candidate name',
        'name',
      ],
      wholeWords: ['student', 'applicant', 'candidate'],
      keys: ['student_name', 'full_name', 'applicant_name', 'candidate_name', 'name'],
    },
  ];

  const mappings: FieldMapping[] = [];
  const clarificationsRequired: ClarificationRequest[] = [];
  const unmappedFields: string[] = [];

  interface RawMatch {
    field: FormFieldSnapshot;
    matchedFact: FactDescriptor | ExtractedFact;
    confidence: number;
    specificity: number;
    isAmbiguous: boolean;
    question?: string;
    options: string[];
  }

  const rawMatches: RawMatch[] = [];

  for (const field of targetFields) {
    const rawLabel = field.label || '';
    const cleanLabel = rawLabel
      .toLowerCase()
      .replace(/[*:\s]+$/, '')
      .replace(/\be-mail\b/g, 'email')
      .trim();
    const wordTokens = new Set((cleanLabel.match(/\b[a-z0-9_]+\b/g) || []));
    const fieldType = (field.type || 'text').toLowerCase();
    const autoVal = (field.autocomplete || '').toLowerCase().trim();
    const autoTokens = new Set((autoVal.match(/\b[a-z0-9_-]+\b/g) || []));

    const isConsent = isConsentCheckbox(field);

    const candidates: Array<{
      cat: CatSpec;
      confidence: number;
      signalRank: number;
      specificity: number;
    }> = [];

    // Direct match against facts keys and labels
    for (const f of facts) {
      const fKey = f.key.toLowerCase().trim();
      const fKeyClean = fKey.replace(/_/g, ' ');
      const fLabelClean = (f.label || '').toLowerCase().replace(/[*:\s]+$/, '').trim();
      if (cleanLabel === fKey || cleanLabel === fKeyClean || cleanLabel === fLabelClean) {
        candidates.push({
          cat: {
            id: f.key,
            specificity: 95,
            autocompleteTokens: new Set(),
            inputTypes: new Set(),
            exactPhrases: [cleanLabel],
            wholeWords: [],
            keys: [f.key],
          },
          confidence: 0.9,
          signalRank: 2,
          specificity: 95,
        });
        break;
      }
    }

    for (const cat of categorySpecs) {
      if (isConsent && cat.id !== 'consent') continue;
      if (!isConsent && cat.id === 'consent' && fieldType !== 'checkbox') continue;

      let conf = 0.0;
      let signalRank = 99;

      // (a) Autocomplete tokens
      if (cat.autocompleteTokens.size > 0 && Array.from(cat.autocompleteTokens).some((t) => autoTokens.has(t))) {
        conf = 0.9;
        signalRank = 1;
      }
      // (c) Exact / whole-phrase match
      else if (
        cat.exactPhrases.some(
          (phrase) => phrase === cleanLabel || phrase === cleanLabel.replace('/', ' ')
        )
      ) {
        conf = 0.9;
        signalRank = 2;
      }
      // (b) Input type match
      else if (cat.inputTypes.has(fieldType) && fieldType !== 'text' && fieldType !== 'textarea') {
        conf = 0.7;
        signalRank = 3;
      }
      // (c) Whole-word match
      else if (cat.wholeWords.some((w) => wordTokens.has(w))) {
        if (cat.id === 'student_name') {
          if (wordTokens.has('email') || wordTokens.has('phone') || wordTokens.has('father') || wordTokens.has('mother')) {
            conf = 0.4;
            signalRank = 5;
          } else {
            conf = 0.7;
            signalRank = 4;
          }
        } else {
          conf = 0.7;
          signalRank = 4;
        }
      } else {
        // Partial match
        for (const w of cat.wholeWords) {
          if (Array.from(wordTokens).some((wt) => wt.length >= 4 && (w.includes(wt) || wt.includes(w)))) {
            conf = 0.4;
            signalRank = 5;
            break;
          }
        }
      }

      if (conf >= 0.6) {
        candidates.push({
          cat,
          confidence: conf,
          signalRank,
          specificity: cat.specificity,
        });
      }
    }

    if (candidates.length === 0) {
      unmappedFields.push(field.ref);
      if (field.required && !isConsent) {
        const clarifyId = `clarify_${field.ref}`;
        clarificationsRequired.push({
          clarification_id: clarifyId,
          field_ref: field.ref,
          field_label: field.label,
          question: `Please provide value for '${field.label}':`,
          options: field.options || [],
          selected_value: '',
        });
        mappings.push({
          field_ref: field.ref,
          field_label: field.label,
          fact_key: null,
          fact_value: null,
          confidence: 0.0,
          status: 'CLARIFICATION_REQUIRED',
          clarification_id: clarifyId,
        });
      }
      continue;
    }

    candidates.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (a.signalRank !== b.signalRank) return a.signalRank - b.signalRank;
      return b.specificity - a.specificity;
    });

    const winner = candidates[0];
    const winningCat = winner.cat;

    let matchedFact: FactDescriptor | ExtractedFact | undefined;
    for (const candKey of winningCat.keys) {
      matchedFact = factDict.get(candKey);
      if (matchedFact) break;
    }
    if (!matchedFact) {
      matchedFact = facts.find((f) => f.key.toLowerCase().includes(winningCat.id));
    }
    if (isConsent && !matchedFact) {
      matchedFact = factDict.get('consent') || factDict.get('terms') || {
        key: 'consent',
        label: 'Consent',
        confidence: 1.0,
      };
    }

    if (!matchedFact) {
      unmappedFields.push(field.ref);
      if (field.required && !isConsent) {
        const clarifyId = `clarify_${field.ref}`;
        clarificationsRequired.push({
          clarification_id: clarifyId,
          field_ref: field.ref,
          field_label: field.label,
          question: `Please provide value for '${field.label}':`,
          options: field.options || [],
          selected_value: '',
        });
        mappings.push({
          field_ref: field.ref,
          field_label: field.label,
          fact_key: null,
          fact_value: null,
          confidence: 0.0,
          status: 'CLARIFICATION_REQUIRED',
          clarification_id: clarifyId,
        });
      }
      continue;
    }

    let isAmbiguous = false;
    let question: string | undefined;
    let options: string[] = [];

    if (winningCat.id === 'phone') {
      if (phoneFacts.length > 1 && !cleanLabel.includes('alternate') && !cleanLabel.includes('emergency')) {
        matchedFact = phoneFacts[0];
        isAmbiguous = true;
        question = `Multiple phone options available (${phoneFacts.map((f) => f.label).join(', ')}). Which phone should be used for ${field.label}?`;
        options = phoneFacts.map((f) => f.label);
      } else if (cleanLabel.includes('alternate') || cleanLabel.includes('emergency')) {
        matchedFact = factDict.get('alternate_phone') || (phoneFacts.length > 1 ? phoneFacts[1] : phoneFacts[0]);
      } else {
        matchedFact = factDict.get('phone') || (phoneFacts.length > 0 ? phoneFacts[0] : undefined);
      }
    }

    if (!matchedFact) {
      unmappedFields.push(field.ref);
      continue;
    }

    rawMatches.push({
      field,
      matchedFact,
      confidence: winner.confidence,
      specificity: winningCat.specificity,
      isAmbiguous,
      question,
      options,
    });
  }

  // ONE FACT, ONE FIELD:
  const factGrouped = new Map<string, RawMatch[]>();
  for (const m of rawMatches) {
    const fkey = m.matchedFact.key.toLowerCase();
    const arr = factGrouped.get(fkey) || [];
    arr.push(m);
    factGrouped.set(fkey, arr);
  }

  const accepted: RawMatch[] = [];

  for (const [, group] of factGrouped.entries()) {
    if (group.length === 1) {
      accepted.push(group[0]);
    } else {
      const firstLabel = group[0].field.label || '';
      const allNearIdentical = group.every((item) =>
        labelsNearIdentical(firstLabel, item.field.label || '')
      );
      if (allNearIdentical) {
        accepted.push(...group);
      } else {
        group.sort((a, b) => {
          if (b.confidence !== a.confidence) return b.confidence - a.confidence;
          return b.specificity - a.specificity;
        });
        accepted.push(group[0]);
        for (let i = 1; i < group.length; i++) {
          const other = group[i];
          unmappedFields.push(other.field.ref);
          const cId = `clarify_${other.field.ref}`;
          clarificationsRequired.push({
            clarification_id: cId,
            field_ref: other.field.ref,
            field_label: other.field.label,
            question: `Please clarify value for '${other.field.label}':`,
            options: other.field.options || [],
            selected_value: '',
          });
          mappings.push({
            field_ref: other.field.ref,
            field_label: other.field.label,
            fact_key: null,
            fact_value: null,
            confidence: other.confidence,
            status: 'CLARIFICATION_REQUIRED',
            clarification_id: cId,
          });
        }
      }
    }
  }

  for (const item of accepted) {
    const cId = item.isAmbiguous ? `clarify_${item.field.ref}` : undefined;
    if (item.isAmbiguous) {
      clarificationsRequired.push({
        clarification_id: cId!,
        field_ref: item.field.ref,
        field_label: item.field.label,
        question: item.question || `Clarify selection for ${item.field.label}`,
        options: item.options,
        selected_value: '',
      });
    }
    mappings.push({
      field_ref: item.field.ref,
      field_label: item.field.label,
      fact_key: item.matchedFact.key,
      fact_value: null,
      confidence: item.confidence,
      status: item.isAmbiguous ? 'CLARIFICATION_REQUIRED' : 'PENDING',
      clarification_id: cId,
    });
  }

  return {
    mappings,
    clarifications_required: clarificationsRequired,
    unmapped_fields: unmappedFields,
  };
}
export class OptionMatcher {
  public static readonly OPTION_CONFIDENCE_THRESHOLD = OPTION_CONFIDENCE_THRESHOLD;
  public static matchOption = matchOption;
  public static normalizeOptionText = normalizeOptionText;
  public static calculateOptionSimilarity = calculateOptionSimilarity;
  public static isConsentCheckbox = isConsentCheckbox;
  public static checkFieldCompatibility = checkFieldCompatibility;
  public static mapHeuristicFallback = mapHeuristicFallback;
}

/* ========================================================================= */
/* 3. Agent Tool Dispatch & Policy Enforcement Registry                     */
/* ========================================================================= */

/** JSON-schema-like field descriptor used to validate tool arguments. */
export interface ToolArgumentSpec {
  type: 'string' | 'boolean' | 'number';
  required: boolean;
}

/** Context handed to every tool invocation. */
export interface ToolContext {
  browserManager: BrowserManager;
  policyEngine: PolicyEngine;
  backendClient: BackendClient;
  sessionId: string;
  signal?: AbortSignal;
  emitEvent: (event: AgentEventPayload) => void;
  requestClarification: (prompt: ClarificationPromptPayload) => Promise<string>;
}

/** A single restricted, validated agent capability. */
export interface AgentTool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  argumentSpec: Record<string, ToolArgumentSpec>;
  validate(input: unknown): TInput;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}

/** Raised when a tool invocation is refused by policy or input validation. */
export class ToolExecutionError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'TOOL_EXECUTION_FAILED') {
    super(message);
    this.name = 'ToolExecutionError';
    this.code = code;
  }
}

export class ToolRegistry {
  private tools: Map<string, AgentTool> = new Map();

  constructor() {
    this.registerTools();
  }

  /**
   * Register every permitted AutoFiller AI domain tool.
   */
  private registerTools(): void {
    this.register({
      name: 'inspect_document',
      description: 'Check document readability and extract its structured facts.',
      argumentSpec: {
        filePath: { type: 'string', required: false },
        rawText: { type: 'string', required: false },
        documentName: { type: 'string', required: false },
      },
      validate: (input: any) => {
        if (!input?.filePath && !input?.rawText) {
          throw new ToolExecutionError('Missing filePath or rawText', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        return await context.backendClient.extractDocument({
          filePath: input.filePath,
          rawText: input.rawText,
          documentName: input.documentName,
        });
      },
    });

    this.register({
      name: 'extract_document_facts',
      description: 'Extract structured facts (student name, DOB, contacts) from a document.',
      argumentSpec: {
        filePath: { type: 'string', required: false },
        rawText: { type: 'string', required: false },
        documentName: { type: 'string', required: false },
      },
      validate: (input: any) => {
        if (!input?.filePath && !input?.rawText) {
          throw new ToolExecutionError('Missing filePath or rawText', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext): Promise<ExtractedFact[]> => {
        const result = await context.backendClient.extractDocument({
          filePath: input.filePath,
          rawText: input.rawText,
          documentName: input.documentName,
        });
        return result.facts || [];
      },
    });

    this.register({
      name: 'inspect_form',
      description: 'Scan the active web form DOM into a structured FormSnapshot with field_refs.',
      argumentSpec: {},
      validate: () => ({}),
      execute: async (_input: unknown, context: ToolContext): Promise<FormSnapshot> => {
        return await context.browserManager.scanActiveForm();
      },
    });

    this.register({
      name: 'inspect_current_form_state',
      description: 'Read the current populated values of all form fields.',
      argumentSpec: {},
      validate: () => ({}),
      execute: async (_input: unknown, context: ToolContext): Promise<FormSnapshot> => {
        return await context.browserManager.scanActiveForm();
      },
    });

    this.register({
      name: 'request_clarification',
      description: 'Pause execution and request human clarification for an ambiguous field.',
      argumentSpec: {
        fieldRef: { type: 'string', required: true },
        question: { type: 'string', required: true },
      },
      validate: (input: any) => {
        if (!input?.fieldRef || !input?.question) {
          throw new ToolExecutionError('Missing fieldRef or question', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        const answer = await context.requestClarification({
          clarificationId: input.clarificationId || `clarify_${Date.now()}`,
          fieldRef: input.fieldRef,
          fieldLabel: input.fieldLabel || input.fieldRef,
          question: input.question,
          options: input.options || [],
          total: typeof input.total === 'number' ? input.total : undefined,
          currentIndex: typeof input.currentIndex === 'number' ? input.currentIndex : undefined,
        });
        return { fieldRef: input.fieldRef, selectedValue: answer };
      },
    });

    this.register({
      name: 'fill_text',
      description: 'Populate a text, email, number, date, or textarea field by field_ref.',
      argumentSpec: {
        fieldRef: { type: 'string', required: true },
        value: { type: 'string', required: true },
      },
      validate: (input: any) => {
        if (!input?.fieldRef || input.value === undefined) {
          throw new ToolExecutionError('Missing fieldRef or value', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        return await context.browserManager.fillText(
          input.fieldRef,
          String(input.value),
          context.signal
        );
      },
    });

    this.register({
      name: 'select_option',
      description: 'Choose a dropdown option for a select element by field_ref.',
      argumentSpec: {
        fieldRef: { type: 'string', required: true },
        option: { type: 'string', required: true },
      },
      validate: (input: any) => {
        if (!input?.fieldRef || !input?.option) {
          throw new ToolExecutionError('Missing fieldRef or option', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        return await context.browserManager.selectOption(
          input.fieldRef,
          input.option,
          context.signal
        );
      },
    });

    this.register({
      name: 'select_radio',
      description: 'Select a radio option scoped to the correct radio group by field_ref.',
      argumentSpec: {
        fieldRef: { type: 'string', required: true },
        optionValue: { type: 'string', required: true },
      },
      validate: (input: any) => {
        if (!input?.fieldRef || !input?.optionValue) {
          throw new ToolExecutionError('Missing fieldRef or optionValue', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        return await context.browserManager.selectRadio(
          input.fieldRef,
          input.optionValue,
          context.signal
        );
      },
    });

    this.register({
      name: 'set_checkbox',
      description: 'Set the checked state of a checkbox by field_ref.',
      argumentSpec: {
        fieldRef: { type: 'string', required: true },
        checked: { type: 'boolean', required: true },
      },
      validate: (input: any) => {
        if (!input?.fieldRef || input.checked === undefined) {
          throw new ToolExecutionError('Missing fieldRef or checked', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        return await context.browserManager.setCheckbox(
          input.fieldRef,
          Boolean(input.checked),
          context.signal
        );
      },
    });

    this.register({
      name: 'verify_field',
      description: 'Read back a field value and verify it matches the expected fact.',
      argumentSpec: {
        fieldRef: { type: 'string', required: true },
        expectedValue: { type: 'string', required: true },
      },
      validate: (input: any) => {
        if (!input?.fieldRef || input.expectedValue === undefined) {
          throw new ToolExecutionError('Missing fieldRef or expectedValue', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        return await context.browserManager.verifyField(
          input.fieldRef,
          String(input.expectedValue)
        );
      },
    });

    this.register({
      name: 'scroll_to_field',
      description: 'Scroll a specific field into the viewport.',
      argumentSpec: { fieldRef: { type: 'string', required: true } },
      validate: (input: any) => {
        if (!input?.fieldRef) {
          throw new ToolExecutionError('Missing fieldRef', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        await context.browserManager.scrollToField(input.fieldRef, context.signal);
        return { success: true, fieldRef: input.fieldRef };
      },
    });

    this.register({
      name: 'click_pagination',
      description: 'Advance a multi-step form section by clicking an allowed wizard pagination button (e.g. Continue, Next).',
      argumentSpec: {
        label: { type: 'string', required: true },
        selector: { type: 'string', required: false },
      },
      validate: (input: any) => {
        if (!input?.label || typeof input.label !== 'string') {
          throw new ToolExecutionError('Missing or invalid pagination button label', 'INVALID_TOOL_INPUT');
        }
        return input;
      },
      execute: async (input: any, context: ToolContext) => {
        return await context.browserManager.clickPagination(
          input.label,
          input.selector,
          context.signal
        );
      },
    });
  }

  /**
   * Register a tool, replacing any existing registration with the same name.
   *
   * @param tool Tool implementation to register.
   */
  public register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Retrieve a registered tool by name.
   *
   * @param name Tool name.
   * @returns The tool, or undefined when not registered.
   */
  public getTool(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  /**
   * List the names of every registered tool.
   *
   * @returns Registered tool names.
   */
  public listToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Dispatch a tool invocation through policy enforcement and input validation.
   *
   * This is the ONLY supported way to execute a tool. It refuses unregistered tools,
   * refuses policy-denied invocations, and validates arguments before side effects.
   *
   * @param name Tool name to dispatch.
   * @param args Untrusted arguments from the agent.
   * @param context Execution context for the tool.
   * @returns The tool result.
   * @throws ToolExecutionError when the tool is unknown, denied, invalid, or fails.
   */
  public async dispatch<T = unknown>(
    name: string,
    args: Record<string, any>,
    context: ToolContext
  ): Promise<T> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolExecutionError(
        `Tool '${name}' is not registered in the AutoFiller AI tool registry.`,
        'TOOL_NOT_REGISTERED'
      );
    }

    const decision = context.policyEngine.validateToolInvocation(name, args);
    if (!decision.allowed) {
      throw new ToolExecutionError(
        decision.reason || `Tool '${name}' was denied by execution policy.`,
        decision.code || 'TOOL_NOT_PERMITTED'
      );
    }

    const validated = tool.validate(args);
    return (await tool.execute(validated, context)) as T;
  }
}
