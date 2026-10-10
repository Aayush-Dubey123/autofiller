/**
 * OptionMatcher: Local option selection and normalization for dropdowns and radio groups.
 *
 * Implements:
 * - Text and punctuation normalization.
 * - Small synonym dictionary (e.g., M/Male, OBC/OBC-NCL, Yes/No, General, SC/ST).
 * - Fuzzy similarity matching with confidence scoring.
 * - Confidence threshold enforcement: below threshold, signals that a clarification is required.
 */

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
