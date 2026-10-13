/**
 * FormScanner transforms target webpage DOM into structured FormSnapshot objects.
 *
 * In accordance with IMPORTANT.md:
 * - Gemini reasons over structured field observations, NOT raw HTML or raw screenshots.
 * - FormScanner assigns stable internal references ('field_001', 'field_002').
 * - Maintains an internal mapping of field_ref -> Playwright Locator.
 * - Radio groups are collapsed into a single logical field so selection can be
 *   scoped to the correct group instead of the first matching value on the page.
 */

import { Page, Locator } from 'playwright';

export interface FormFieldSnapshot {
  ref: string;
  role?: string;
  label: string;
  type: 'text' | 'number' | 'email' | 'tel' | 'select' | 'combobox' | 'radio' | 'checkbox' | 'date' | 'textarea' | 'password' | 'other';
  autocomplete?: string;
  required: boolean;
  currentValue?: string;
  options?: string[];
  disabled: boolean;
  visible: boolean;
  isHoneypot?: boolean;
  labelSource?: string;
  enabledState?: 'enabled' | 'readonly' | 'disabled';
  location?: string;
}

export interface FormSnapshot {
  url: string;
  title: string;
  fields: FormFieldSnapshot[];
}

export type BlockerType = 'login' | 'otp' | 'captcha' | 'no-form' | 'none';

export interface BlockerDetectionResult {
  type: BlockerType;
  reason: string;
  matchedRule?: string | null;
  triggerElementOrHost?: string | null;
}

/**
 * Pure DOM function to detect human blockers on the active page.
 * Contains no Playwright calls, making it completely portable for evaluation inside the browser DOM.
 *
 * @param doc Document object (defaults to window.document in browser context).
 * @param win Window object (defaults to global window in browser context).
 * @returns BlockerDetectionResult with blocker type and reason.
 */
/** Result returned by the navigation-safe readiness gate evaluation. */
export interface FormReadinessState {
  blocker: BlockerDetectionResult;
  fillableVisibleCount: number;
  fieldSignature: string;
}

/**
 * Pure DOM function evaluating page readiness:
 * - blocker: login, otp, captcha, no-form, or none
 * - fillableVisibleCount: number of visible fillable fields
 * - fieldSignature: deterministic hash of visible fillable field metadata (refs/labels only, strictly NO values)
 *
 * Self-contained for direct evaluation in Playwright browser context without external references.
 */
export function getFormReadinessState(
  doc?: Document,
  win?: any
): FormReadinessState {
  const d = doc || (typeof document !== 'undefined' ? document : (undefined as any));
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  if (!d) {
    return {
      blocker: { type: 'none', reason: 'No document available' },
      fillableVisibleCount: 0,
      fieldSignature: '',
    };
  }

  const isVisible = (el: Element): boolean => {
    if (!el) return false;
    const htmlEl = el as HTMLElement;
    if (htmlEl.hidden) return false;
    if (w && typeof w.getComputedStyle === 'function') {
      try {
        const style = w.getComputedStyle(htmlEl);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          style.visibility === 'collapse'
        ) {
          return false;
        }
        if (parseFloat(style.opacity || '1') === 0) return false;
        if (style.position !== 'fixed' && htmlEl.offsetParent === null) {
          return false;
        }
        if (typeof htmlEl.getBoundingClientRect === 'function') {
          const rect = htmlEl.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) {
            return false;
          }
        }
      } catch {}
    }
    let parent = htmlEl.parentElement;
    while (parent && parent !== d.body && parent !== d.documentElement) {
      if (parent.hidden) return false;
      if (w && typeof w.getComputedStyle === 'function') {
        try {
          const ps = w.getComputedStyle(parent);
          if (
            ps.display === 'none' ||
            ps.visibility === 'hidden' ||
            ps.visibility === 'collapse'
          ) {
            return false;
          }
          if (parseFloat(ps.opacity || '1') === 0) return false;
        } catch {}
      }
      parent = parent.parentElement;
    }
    return true;
  };

  // 1. CAPTCHA detection: visible iframe or element for reCAPTCHA, hCaptcha, or Cloudflare Turnstile
  const captchaSelectors = [
    'iframe[src*="recaptcha"]',
    'iframe[src*="google.com/recaptcha"]',
    '.g-recaptcha',
    '[data-sitekey]',
    'iframe[title*="recaptcha" i]',
    'iframe[src*="hcaptcha"]',
    '.h-captcha',
    '[data-hcaptcha-sitekey]',
    'iframe[title*="hcaptcha" i]',
    'iframe[src*="turnstile"]',
    'iframe[src*="challenges.cloudflare.com"]',
    '.cf-turnstile',
    '[data-turnstile-sitekey]',
    '#turnstile-wrapper',
  ];
  for (let cIdx = 0; cIdx < captchaSelectors.length; cIdx++) {
    try {
      const elems = d.querySelectorAll(captchaSelectors[cIdx]);
      for (let i = 0; i < elems.length; i++) {
        if (isVisible(elems[i])) {
          return {
            blocker: {
              type: 'captcha',
              reason: 'Security check or CAPTCHA detected on page',
              matchedRule: 'captcha_pattern',
              triggerElementOrHost: captchaSelectors[cIdx],
            },
            fillableVisibleCount: 0,
            fieldSignature: '',
          };
        }
      }
    } catch {}
  }

  // 2. OTP detection: visible input with autocomplete="one-time-code" or label/name matching OTP
  const otpPattern = /\b(otp|one[\s_-]*time|verification[\s_-]*code|security[\s_-]*code|auth[\s_-]*code|2fa|mfa|passcode)\b/i;
  const inputs = d.querySelectorAll('input:not([type="hidden"])');
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i] as HTMLInputElement;
    if (!isVisible(inp)) continue;
    if (inp.getAttribute('autocomplete') === 'one-time-code') {
      return {
        blocker: {
          type: 'otp',
          reason: 'One-time verification code input detected',
          matchedRule: 'otp_autocomplete',
          triggerElementOrHost: 'input[autocomplete="one-time-code"]',
        },
        fillableVisibleCount: 0,
        fieldSignature: '',
      };
    }
    const name = inp.getAttribute('name') || '';
    const id = inp.id || '';
    const placeholder = inp.getAttribute('placeholder') || '';
    const ariaLabel = inp.getAttribute('aria-label') || '';
    let labelText = '';
    if (id) {
      try {
        const escapeFn = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape : (s: string) => s;
        const lbl = d.querySelector(`label[for="${escapeFn(id)}"]`);
        if (lbl) labelText = lbl.textContent || '';
      } catch {}
    }
    if (!labelText && inp.closest) {
      const lbl = inp.closest('label');
      if (lbl) labelText = lbl.textContent || '';
    }
    if (
      otpPattern.test(name) ||
      otpPattern.test(id) ||
      otpPattern.test(placeholder) ||
      otpPattern.test(ariaLabel) ||
      otpPattern.test(labelText)
    ) {
      return {
        blocker: {
          type: 'otp',
          reason: 'One-time verification code input detected',
          matchedRule: 'otp_pattern',
          triggerElementOrHost: id ? `#${id}` : (name || 'input[otp]'),
        },
        fillableVisibleCount: 0,
        fieldSignature: '',
      };
    }
  }

  // 3. Known authentication host detection (evaluated INDEPENDENTLY of token count and visible password presence)
  const host = (w?.location?.hostname || (d as any)?.location?.hostname || '').toLowerCase();
  const knownLoginHosts = [
    'accounts.google.com',
    'login.microsoftonline.com',
    'login.live.com',
    'appleid.apple.com',
    'auth0.com',
    'okta.com',
  ];
  if (
    knownLoginHosts.some((h) => host === h || host.endsWith('.' + h)) ||
    /^(login|auth|signin|sso|id)\./i.test(host)
  ) {
    return {
      blocker: {
        type: 'login',
        reason: `Known sign-in service host (${host})`,
        matchedRule: 'known_login_host',
        triggerElementOrHost: host,
      },
      fillableVisibleCount: 0,
      fieldSignature: '',
    };
  }

  // 4. Password visibility check
  const pwInputs = d.querySelectorAll('input[type="password"]');
  let hasVisiblePassword = false;
  for (let i = 0; i < pwInputs.length; i++) {
    if (isVisible(pwInputs[i])) {
      hasVisiblePassword = true;
      break;
    }
  }

  // 5. Gather visible fillable fields (including modern custom controls: radio, checkbox, combobox, listbox, switch)
  const fillableCandidates = d.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="password"]), select, textarea, [role="textbox"], [role="radio"], [role="radiogroup"], [role="checkbox"], [role="switch"], [role="listbox"], [role="combobox"], [aria-haspopup="listbox"], [contenteditable="true"]'
  );

  const tokens: string[] = [];
  for (let i = 0; i < fillableCandidates.length; i++) {
    const el = fillableCandidates[i] as HTMLElement;
    if (!isVisible(el)) continue;
    if (el.getAttribute('autocomplete') === 'one-time-code') continue;

    const tag = el.tagName.toLowerCase();
    const roleAttr = el.getAttribute('role')?.toLowerCase();
    const inputType = tag === 'input' ? ((el as HTMLInputElement).type || 'text').toLowerCase() : (roleAttr || tag);
    const name = el.getAttribute('name') || '';
    const id = el.id || '';

    let labelText = '';
    if (id) {
      try {
        const escapeFn = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape : (s: string) => s;
        const lbl = d.querySelector(`label[for="${escapeFn(id)}"]`);
        if (lbl) labelText = lbl.textContent || '';
      } catch {}
    }
    if (!labelText && el.closest) {
      const lbl = el.closest('label');
      if (lbl) labelText = lbl.textContent || '';
    }
    if (!labelText) {
      const ariaLabelledBy = el.getAttribute('aria-labelledby');
      if (ariaLabelledBy) {
        const idList = ariaLabelledBy.trim().split(/\s+/);
        labelText = idList
          .map((targetId) => d.getElementById(targetId)?.textContent?.trim() || '')
          .filter(Boolean)
          .join(' ');
      }
    }
    if (!labelText && el.closest) {
      const itemParent = el.closest('[role="listitem"], .question-block');
      if (itemParent) {
        const heading = itemParent.querySelector('[role="heading"], .q-label');
        if (heading) {
          labelText = heading.textContent?.trim() || '';
        }
      }
    }
    if (!labelText) {
      labelText = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    }

    const cleanLabel = labelText.trim().replace(/\s+/g, ' ');
    // Strictly metadata only: tag, inputType, name, id, label (strictly NO values)
    tokens.push(`${tag}:${inputType}:${name}:${id}:${cleanLabel}`);
  }

  // 6. Evaluate Login blocker:
  // If a password field is visible on screen:
  // - If <= 1 other fillable field exists (standard username + password gate): classify as login blocker.
  // - If 2 or more fillable fields exist (e.g. registration form): do not block, user is on a fillable form.
  if (hasVisiblePassword && tokens.length <= 1) {
    return {
      blocker: {
        type: 'login',
        reason: 'Visible password field detected',
        matchedRule: 'visible_password',
        triggerElementOrHost: 'input[type="password"]',
      },
      fillableVisibleCount: 0,
      fieldSignature: '',
    };
  }

  // If no fillable fields exist yet, evaluate sign-in pathname segments or conclude no-form
  if (tokens.length === 0) {
    const path = (w?.location?.pathname || (d as any)?.location?.pathname || '').toLowerCase();
    if (/(?:^|\/)(login|signin|sign-in|sso|authenticate)(?:\/|$|\.|\?)/i.test(path)) {
      return {
        blocker: {
          type: 'login',
          reason: `Sign-in URL path segment (${path})`,
          matchedRule: 'login_path_segment',
          triggerElementOrHost: path,
        },
        fillableVisibleCount: 0,
        fieldSignature: '',
      };
    }

    return {
      blocker: {
        type: 'no-form',
        reason: 'No visible fillable form fields found',
        matchedRule: 'zero_fillable_fields',
        triggerElementOrHost: `${host}${path}`,
      },
      fillableVisibleCount: 0,
      fieldSignature: '',
    };
  }

  tokens.sort();

  // Deterministic 32-bit djb2 hash
  const rawSignature = tokens.join(';');
  let hash = 5381;
  for (let i = 0; i < rawSignature.length; i++) {
    hash = ((hash << 5) + hash) + rawSignature.charCodeAt(i);
    hash = hash & hash;
  }
  const fieldSignature = (hash >>> 0).toString(16);

  return {
    blocker: {
      type: 'none',
      reason: 'Fillable form detected',
      matchedRule: null,
      triggerElementOrHost: null,
    },
    fillableVisibleCount: tokens.length,
    fieldSignature,
  };
}

/**
 * Pure DOM function to detect human blockers on the active page.
 * Contains no Playwright calls, making it completely portable for evaluation inside the browser DOM.
 *
 * @param doc Document object (defaults to window.document in browser context).
 * @param win Window object (defaults to global window in browser context).
 * @returns BlockerDetectionResult with blocker type and reason.
 */
export function detectBlocker(
  doc?: Document,
  win?: any
): BlockerDetectionResult {
  return getFormReadinessState(doc, win).blocker;
}

/** Raw per-control observation gathered inside the page. */
interface RawControl {
  selector: string;
  tag: string;
  role?: string;
  inputType: string;
  autocomplete?: string;
  name: string;
  label: string;
  /** Text of the enclosing fieldset legend, when the control sits in a fieldset. */
  groupLegend: string;
  required: boolean;
  currentValue: string;
  options: string[];
  disabled: boolean;
  visible: boolean;
  isHoneypot?: boolean;
  checked: boolean;
  labelSource: string;
  enabledState: 'enabled' | 'readonly' | 'disabled';
  location: string;
}

export class FormScanner {
  private locatorMap: Map<string, Locator> = new Map();
  private selectorMap: Map<string, string> = new Map();
  private nameMap: Map<string, string> = new Map();
  private frameMap: Map<string, any> = new Map();
  private labelMap: Map<string, string> = new Map();

  /**
   * Scan the active page DOM and compile a structured FormSnapshot.
   *
   * @param page Active Playwright page.
   * @returns Structured snapshot with stable field references and collapsed radio groups.
   */
  public async scanForm(page: Page): Promise<FormSnapshot> {
    this.locatorMap.clear();
    this.selectorMap.clear();
    this.nameMap.clear();
    this.frameMap.clear();
    this.labelMap.clear();

    const title = await page.title();
    const url = page.url();

    const frames = page.frames();

    // 1. Remove existing data-af-ref attributes from all frames before scanning
    for (const frame of frames) {
      try {
        await frame.evaluate(() => {
          document.querySelectorAll('[data-af-ref]').forEach((el) => el.removeAttribute('data-af-ref'));
        });
      } catch {}
    }

    // 2. Discover and tag all controls frame-by-frame
    let globalIndex = 0;
    const allCollected: Array<{ frame: any; item: any }> = [];

    for (const frame of frames) {
      try {
        const frameResult = await frame.evaluate((startIndex: number) => {
          const collected: Array<{
            ref: string;
            selector: string;
            tag: string;
            role?: string;
            inputType: string;
            autocomplete?: string;
            name: string;
            label: string;
            required: boolean;
            currentValue: string;
            options: string[];
            groupLegend: string;
            disabled: boolean;
            visible: boolean;
            isHoneypot: boolean;
            checked: boolean;
            labelSource: string;
            enabledState: 'enabled' | 'readonly' | 'disabled';
            location: string;
          }> = [];

          const formControls = Array.from(
            document.querySelectorAll(
              'input:not([type="hidden"]), select, textarea, [role="radiogroup"], [role="checkbox"], [role="switch"], [role="listbox"], [role="combobox"], [aria-haspopup="listbox"]'
            )
          );

          let currentIndex = startIndex;
          const radioGroupRefs = new Map<string, string>();

          formControls.forEach((el) => {
            const htmlEl = el as HTMLElement;
            const style = window.getComputedStyle(htmlEl);

            const tagName = htmlEl.tagName.toLowerCase();
            const roleAttr = (htmlEl.getAttribute('role') || '').toLowerCase().trim();
            const ariaHasPopup = (htmlEl.getAttribute('aria-haspopup') || '').toLowerCase().trim();
            const rawTypeAttr = (htmlEl.getAttribute('type') || '').toLowerCase().trim();

            // Skip submit/button/reset/image controls (PolicyEngine guard and cleaner scan).
            // Also skip password and one-time-code / OTP inputs (never fill sensitive auth fields).
            if (
              tagName === 'button' ||
              rawTypeAttr === 'submit' ||
              rawTypeAttr === 'button' ||
              rawTypeAttr === 'reset' ||
              rawTypeAttr === 'image' ||
              rawTypeAttr === 'password' ||
              htmlEl.getAttribute('autocomplete') === 'one-time-code'
            ) {
              return;
            }

            // Never touch a control whose role or label indicates a submit action
            if (
              roleAttr === 'button' ||
              htmlEl.getAttribute('aria-roledescription') === 'button'
            ) {
              const btnText = (htmlEl.textContent || htmlEl.getAttribute('aria-label') || '').toLowerCase();
              if (/(submit|apply\s*now|register\s*now|place\s*order|complete\s*order|finish\s*app)/i.test(btnText)) {
                return;
              }
            }

            // Skip child radios inside a [role="radiogroup"] (the radiogroup represents the whole question)
            if (roleAttr === 'radio' && htmlEl.closest('[role="radiogroup"]')) {
              return;
            }

            // Skip popup options container itself if it is a secondary container inside a popup
            if (
              roleAttr === 'listbox' &&
              !htmlEl.hasAttribute('aria-haspopup') &&
              !htmlEl.hasAttribute('aria-expanded') &&
              htmlEl.getAttribute('tabindex') !== '0' &&
              htmlEl.closest('.popup-options, [role="presentation"]')
            ) {
              return;
            }

            let effectiveType = rawTypeAttr;
            if (roleAttr === 'radiogroup') {
              effectiveType = 'radio';
            } else if (roleAttr === 'checkbox' || roleAttr === 'switch') {
              effectiveType = 'checkbox';
            } else if (roleAttr === 'combobox') {
              effectiveType = 'combobox';
            } else if (roleAttr === 'listbox' || ariaHasPopup === 'listbox') {
              effectiveType = 'select';
            } else if (tagName === 'select') {
              effectiveType = 'select';
            } else if (tagName === 'textarea') {
              effectiveType = 'textarea';
            } else if (!effectiveType) {
              effectiveType = 'text';
            }

            // Stable targeting: tag discovered control with unique data-af-ref="field_NNN"
            let fieldRef: string;
            const nameAttr = htmlEl.getAttribute('name') || '';
            if (effectiveType === 'radio' && nameAttr) {
              if (radioGroupRefs.has(nameAttr)) {
                fieldRef = radioGroupRefs.get(nameAttr)!;
              } else {
                currentIndex += 1;
                fieldRef = `field_${String(currentIndex).padStart(3, '0')}`;
                radioGroupRefs.set(nameAttr, fieldRef);
              }
            } else {
              currentIndex += 1;
              fieldRef = `field_${String(currentIndex).padStart(3, '0')}`;
            }
            htmlEl.setAttribute('data-af-ref', fieldRef);
            const uniqueSelector = `[data-af-ref="${fieldRef}"]`;

            let labelText = '';
            let labelSource = '';
            let isLabelVisible = false;
            const id = htmlEl.id;
            let labelEl: HTMLElement | null = null;
            if (id) {
              labelEl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
              if (labelEl) {
                labelText = labelEl.textContent?.trim() || '';
                if (labelText) labelSource = 'label-for';
              }
            }
            const enclosingLabel = htmlEl.closest('label');
            if (!labelText && enclosingLabel) {
              labelText = enclosingLabel.textContent?.trim() || '';
              if (labelText) labelSource = 'label-for';
            }
            const associatedLabel = labelEl || enclosingLabel;
            if (associatedLabel) {
              const lStyle = window.getComputedStyle(associatedLabel);
              const lRect = associatedLabel.getBoundingClientRect();
              isLabelVisible =
                lStyle.display !== 'none' &&
                lStyle.visibility !== 'hidden' &&
                lStyle.visibility !== 'collapse' &&
                parseFloat(lStyle.opacity || '1') > 0 &&
                lRect.width > 0 &&
                lRect.height > 0 &&
                lRect.right > 0 &&
                lRect.bottom > 0 &&
                lRect.left < (window.innerWidth || 1920) + 500 &&
                lRect.top < (window.innerHeight || 1080) + 500;
            }

            if (!labelText) {
              const ariaLabelledBy = htmlEl.getAttribute('aria-labelledby');
              if (ariaLabelledBy) {
                const idList = ariaLabelledBy.trim().split(/\s+/);
                labelText = idList
                  .map((targetId) => document.getElementById(targetId)?.textContent?.trim() || '')
                  .filter(Boolean)
                  .join(' ');
                if (labelText) labelSource = 'aria-labelledby';
              }
            }

            if (!labelText) {
              const itemParent = htmlEl.closest('[role="listitem"], .question-block, .geS5n');
              if (itemParent) {
                const heading = itemParent.querySelector('[role="heading"], .q-label');
                if (heading) {
                  labelText = heading.textContent?.trim() || '';
                  if (labelText) labelSource = 'container heading';
                }
              }
            }

            if (!labelText) {
              const ariaLabel = htmlEl.getAttribute('aria-label');
              const placeholder = htmlEl.getAttribute('placeholder');
              if (ariaLabel) {
                labelText = ariaLabel;
                labelSource = 'aria-label';
              } else if (placeholder) {
                labelText = placeholder;
                labelSource = 'placeholder';
              } else if (htmlEl.getAttribute('name')) {
                labelText = htmlEl.getAttribute('name') || '';
                labelSource = 'nearby text';
              } else if (roleAttr === 'checkbox' || roleAttr === 'switch') {
                labelText = htmlEl.textContent?.trim() || '';
                if (labelText) labelSource = 'visible text';
              } else {
                labelText = `Field ${currentIndex}`;
                labelSource = 'nearby text';
              }
            }

            // Direct geometry and visibility of the control element itself
            const rect = htmlEl.getBoundingClientRect();
            const hasZeroDims =
              (rect.width === 0 && rect.height === 0) ||
              (rect.width <= 1 &&
                rect.height <= 1 &&
                (style.overflow === 'hidden' ||
                  style.clip === 'rect(0px, 0px, 0px, 0px)' ||
                  style.clipPath !== 'none'));
            const isOffscreen =
              rect.right <= 0 ||
              rect.bottom <= 0 ||
              rect.left <= -500 ||
              rect.top <= -500 ||
              rect.left >= 10000 ||
              rect.top >= 10000;
            const isTransparent = parseFloat(style.opacity || '1') === 0;
            const isDisplayNone = style.display === 'none' || htmlEl.offsetParent === null;
            const isVisibilityHidden =
              style.visibility === 'hidden' || style.visibility === 'collapse';

            let isAncestorOffscreenOrHidden = false;
            let parent = htmlEl.parentElement;
            while (parent && parent !== document.body) {
              const pStyle = window.getComputedStyle(parent);
              const pRect = parent.getBoundingClientRect();
              if (
                pStyle.display === 'none' ||
                pStyle.visibility === 'hidden' ||
                pRect.right <= 0 ||
                pRect.bottom <= 0 ||
                pRect.left <= -500 ||
                pRect.top <= -500
              ) {
                isAncestorOffscreenOrHidden = true;
                break;
              }
              parent = parent.parentElement;
            }

            const isDirectlyVisible =
              !isDisplayNone &&
              !isVisibilityHidden &&
              !isTransparent &&
              !hasZeroDims &&
              !isOffscreen &&
              !isAncestorOffscreenOrHidden;

            // Anti-bot honeypot detection:
            const idAttr = htmlEl.id || '';
            const tabIndexAttr = htmlEl.getAttribute('tabindex');
            const isAutocompleteOff = htmlEl.getAttribute('autocomplete') === 'off';
            const hasAntiBotName =
              /(?:^|_|-)(?:hp|honeypot|bot_trap|anti_bot|trap)(?:_|-|$)/i.test(nameAttr) ||
              /(?:^|_|-)(?:hp|honeypot|bot_trap|anti_bot|trap)(?:_|-|$)/i.test(idAttr);
            const hasLeaveBlankWarning =
              /(?:leave\s+(?:this\s+)?(?:field\s+)?(?:blank|empty)|do\s+not\s+fill|if\s+you\s+are\s+human)/i.test(
                labelText
              );

            let isHoneypot = false;
            if (hasLeaveBlankWarning) {
              isHoneypot = true;
            } else if (!isDirectlyVisible && !isLabelVisible) {
              if (
                hasAntiBotName ||
                (isAutocompleteOff && tabIndexAttr === '-1') ||
                isOffscreen ||
                hasZeroDims ||
                (isTransparent && style.pointerEvents === 'none') ||
                Boolean(htmlEl.closest('[aria-hidden="true"]'))
              ) {
                isHoneypot = true;
              }
            } else if (hasAntiBotName && (!isDirectlyVisible || !isLabelVisible)) {
              isHoneypot = true;
            }

            const isTextual =
              effectiveType === 'text' ||
              effectiveType === 'email' ||
              effectiveType === 'number' ||
              effectiveType === 'date' ||
              effectiveType === 'textarea';

            const isVisible = isTextual
              ? (!isHoneypot && isDirectlyVisible)
              : (!isHoneypot && (isDirectlyVisible || isLabelVisible));

            const optionsList: string[] = [];
            let currentValue = (htmlEl as HTMLInputElement).value || '';

            if (roleAttr === 'radiogroup') {
              const radioChildren = Array.from(htmlEl.querySelectorAll('[role="radio"]'));
              radioChildren.forEach((rc) => {
                const optVal = (
                  rc.getAttribute('aria-label') ||
                  rc.getAttribute('data-value') ||
                  rc.textContent?.trim() ||
                  ''
                ).trim();
                if (optVal && !optionsList.includes(optVal)) {
                  optionsList.push(optVal);
                }
              });
              const checkedRadio = radioChildren.find((rc) => rc.getAttribute('aria-checked') === 'true');
              if (checkedRadio) {
                currentValue = (
                  checkedRadio.getAttribute('data-value') ||
                  checkedRadio.getAttribute('aria-label') ||
                  checkedRadio.textContent?.trim() ||
                  ''
                ).trim();
              }
            } else if (roleAttr === 'checkbox' || roleAttr === 'switch') {
              const isAriaChecked = htmlEl.getAttribute('aria-checked') === 'true';
              currentValue = isAriaChecked ? 'true' : 'false';
            } else if (tagName === 'select') {
              const selectEl = htmlEl as HTMLSelectElement;
              Array.from(selectEl.options).forEach((opt) => {
                const optVal = opt.textContent?.trim() || opt.value.trim();
                if (optVal && !optionsList.includes(optVal)) {
                  optionsList.push(optVal);
                }
              });
            } else if (roleAttr === 'listbox' || roleAttr === 'combobox' || ariaHasPopup === 'listbox') {
              const container = htmlEl.closest('.dropdown-container, [role="listitem"]') || htmlEl.parentElement;
              if (container) {
                const optElements = Array.from(container.querySelectorAll('[role="option"]'));
                optElements.forEach((opt) => {
                  const optVal = (
                    opt.getAttribute('data-value') ||
                    opt.getAttribute('aria-label') ||
                    opt.textContent?.trim() ||
                    ''
                  ).trim();
                  if (optVal && !optionsList.includes(optVal)) {
                    optionsList.push(optVal);
                  }
                });
              }
              currentValue = htmlEl.textContent?.trim() || '';
            }

            // Capture any enclosing fieldset legend, which names the group as a whole.
            let groupLegend = '';
            const fieldset = htmlEl.closest('fieldset');
            if (fieldset) {
              const legend = fieldset.querySelector('legend');
              groupLegend = legend?.textContent?.trim() || '';
            }

            let loc = 'main';
            try {
              if (window.self !== window.top) {
                loc = 'iframe';
              } else if (htmlEl.getRootNode && htmlEl.getRootNode() instanceof ShadowRoot) {
                loc = 'shadow';
              }
            } catch {
              loc = 'main';
            }

            const enabledState: 'enabled' | 'readonly' | 'disabled' =
              (htmlEl as any).disabled || htmlEl.getAttribute('aria-disabled') === 'true'
                ? 'disabled'
                : Boolean((htmlEl as any).readOnly || htmlEl.hasAttribute('readonly'))
                  ? 'readonly'
                  : 'enabled';

            const isRequired =
              (htmlEl as any).required ||
              htmlEl.getAttribute('aria-required') === 'true' ||
              /\*/.test(labelText) ||
              Boolean(
                htmlEl.closest('[role="listitem"], .question-block, .geS5n')?.querySelector('.req, [aria-label*="required" i]')
              ) ||
              Boolean(htmlEl.parentElement && htmlEl.parentElement.querySelector('.req'));

            collected.push({
              ref: fieldRef,
              selector: uniqueSelector,
              tag: htmlEl.tagName.toLowerCase(),
              role: roleAttr || undefined,
              inputType: effectiveType,
              autocomplete: htmlEl.getAttribute('autocomplete') || '',
              name: htmlEl.getAttribute('name') || '',
              groupLegend,
              label: labelText.replace(/[\s]+/g, ' ').trim(),
              required: isRequired,
              currentValue: currentValue,
              options: optionsList,
              disabled: enabledState === 'disabled',
              visible: isVisible,
              isHoneypot,
              checked: Boolean(
                (htmlEl as HTMLInputElement).checked || htmlEl.getAttribute('aria-checked') === 'true'
              ),
              labelSource: labelSource || 'nearby text',
              enabledState,
              location: loc,
            });
          });

          return { controls: collected, nextIndex: currentIndex };
        }, globalIndex);

        if (frameResult && frameResult.controls) {
          for (const item of frameResult.controls) {
            allCollected.push({ frame, item });
          }
          globalIndex = frameResult.nextIndex;
        }
      } catch {}
    }

    const fields: FormFieldSnapshot[] = [];
    const seenRadioGroups = new Set<string>();

    allCollected.forEach(({ frame, item }) => {
      const fieldRef = item.ref;

      // Collapse a native radio group into one logical field keyed by its name attribute
      if (item.inputType === 'radio' && item.name) {
        if (seenRadioGroups.has(item.name)) {
          return;
        }
        seenRadioGroups.add(item.name);

        const groupControls = allCollected
          .filter((candidate) => candidate.item.inputType === 'radio' && candidate.item.name === item.name)
          .map((candidate) => candidate.item);
        const groupSelector = `[data-af-ref="${fieldRef}"]`;
        this.selectorMap.set(fieldRef, groupSelector);
        this.nameMap.set(fieldRef, item.name);
        this.frameMap.set(fieldRef, frame);
        this.locatorMap.set(fieldRef, frame.locator(groupSelector));

        const groupLabel = this.resolveRadioGroupLabel(item, groupControls);
        this.labelMap.set(fieldRef, groupLabel);

        let groupLabelSource = item.labelSource || 'label-for';
        if (item.groupLegend) {
          const optionTexts = new Set(groupControls.map((c: any) => c.label.trim().toLowerCase()));
          if (optionTexts.has(item.label.trim().toLowerCase())) {
            groupLabelSource = 'container heading';
          }
        }

        fields.push({
          ref: fieldRef,
          role: 'radio',
          label: groupLabel,
          type: 'radio',
          required: groupControls.some((candidate: any) => candidate.required),
          currentValue: groupControls.find((candidate: any) => candidate.checked)?.currentValue || '',
          options: Array.from(
            new Set(groupControls.map((candidate: any) => candidate.currentValue).filter(Boolean))
          ),
          disabled: groupControls.every((candidate: any) => candidate.disabled),
          visible: groupControls.some((candidate: any) => candidate.visible),
          isHoneypot: groupControls.some((candidate: any) => candidate.isHoneypot),
          labelSource: groupLabelSource,
          enabledState: groupControls.every((candidate: any) => candidate.disabled) ? 'disabled' : 'enabled',
          location: item.location || 'main',
        });
        return;
      }

      let fieldType: FormFieldSnapshot['type'] = 'text';
      if (item.tag === 'select' || item.inputType === 'select') fieldType = 'select';
      else if (item.inputType === 'combobox') fieldType = 'combobox';
      else if (item.tag === 'textarea' || item.inputType === 'textarea') fieldType = 'textarea';
      else if (item.inputType === 'checkbox' || item.inputType === 'switch') fieldType = 'checkbox';
      else if (item.inputType === 'radio') fieldType = 'radio';
      else if (item.inputType === 'number') fieldType = 'number';
      else if (item.inputType === 'email') fieldType = 'email';
      else if (item.inputType === 'date') fieldType = 'date';

      this.selectorMap.set(fieldRef, item.selector);
      this.locatorMap.set(fieldRef, frame.locator(item.selector).first());
      this.frameMap.set(fieldRef, frame);
      this.labelMap.set(fieldRef, item.label);
      if (item.name) {
        this.nameMap.set(fieldRef, item.name);
      }

      fields.push({
        ref: fieldRef,
        role: item.role,
        label: item.label,
        type: fieldType,
        autocomplete: item.autocomplete || undefined,
        required: item.required,
        currentValue: item.currentValue,
        options: item.options.length > 0 ? item.options : undefined,
        disabled: item.disabled,
        visible: item.visible,
        isHoneypot: item.isHoneypot,
        labelSource: item.labelSource || 'nearby text',
        enabledState: item.enabledState || 'enabled',
        location: item.location || 'main',
      });
    });

    return { url, title, fields };
  }

  /**
   * Derive a meaningful label for a radio group.
   *
   * Individual radio controls usually expose only their option text ("Yes"), so the
   * group's own question text is preferable. Falls back to the option text when no
   * group-level label can be found.
   *
   * @param first First control observed in the group.
   * @param groupControls All controls belonging to the group.
   * @returns A human readable group label.
   */
  private resolveRadioGroupLabel(first: RawControl, groupControls: RawControl[]): string {
    const optionTexts = new Set(groupControls.map((control) => control.label.trim().toLowerCase()));

    // A label that is also an option value ("Yes") is not a group question.
    if (first.label && !optionTexts.has(first.label.trim().toLowerCase())) {
      return first.label;
    }

    // Prefer an explicitly associated fieldset legend when present.
    if (first.groupLegend) {
      return first.groupLegend;
    }

    // Last resort: describe the group by its option set.
    const options = groupControls
      .map((control) => control.currentValue || control.label)
      .filter(Boolean);
    if (first.name) {
      const humanized = first.name.replace(/[\s_-]+/g, ' ').replace(/(\w)([A-Z])/g, '$1 $2');
      const prefix = humanized.charAt(0).toUpperCase() + humanized.slice(1);
      return options.length > 0 ? `${prefix} (${options.join(' / ')})` : prefix;
    }
    return first.label || 'Radio group';
  }

  /**
   * Escape a value for safe interpolation into a quoted CSS attribute selector.
   *
   * @param value Raw attribute value.
   * @returns Escaped value safe for a double-quoted selector attribute.
   */
  private escapeAttribute(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /**
   * Retrieve the internal Playwright Locator for a field reference.
   *
   * @param fieldRef Stable field reference such as 'field_001'.
   * @returns The mapped locator, or undefined when unknown.
   */
  public getLocator(fieldRef: string): Locator | undefined {
    return this.locatorMap.get(fieldRef);
  }

  /**
   * Override or re-bind the internal Playwright Locator for a field reference.
   *
   * @param fieldRef Stable field reference such as 'field_001'.
   * @param locator New Locator to associate.
   */
  public setLocator(fieldRef: string, locator: Locator): void {
    this.locatorMap.set(fieldRef, locator);
  }

  /**
   * Retrieve the internal CSS selector for a field reference.
   *
   * @param fieldRef Stable field reference such as 'field_001'.
   * @returns The mapped selector, or undefined when unknown.
   */
  public getSelector(fieldRef: string): string | undefined {
    return this.selectorMap.get(fieldRef);
  }

  /**
   * Retrieve the DOM name attribute for a field reference.
   *
   * @param fieldRef Stable field reference such as 'field_001'.
   * @returns The mapped name attribute, or undefined when unknown.
   */
  public getName(fieldRef: string): string | undefined {
    return this.nameMap.get(fieldRef);
  }

  /**
   * Retrieve the human label for a field reference.
   *
   * @param fieldRef Stable field reference such as 'field_001'.
   * @returns The mapped label, or undefined when unknown.
   */
  public getLabel(fieldRef: string): string | undefined {
    return this.labelMap.get(fieldRef);
  }

  /**
   * Retrieve the frame where the field reference resides.
   *
   * @param fieldRef Stable field reference such as 'field_001'.
   * @returns The mapped Frame, or undefined when unknown.
   */
  public getFrame(fieldRef: string): any {
    return this.frameMap.get(fieldRef);
  }

  /**
   * Evaluate pure DOM detectBlocker on the given Playwright page safely.
   *
   * @param page Playwright Page instance.
   * @param waitMs Optional bounded timeout for condition wait if initially seeing zero fillable fields.
   * @returns BlockerDetectionResult.
   */
  public async detectBlockerOnPage(
    page: Page,
    waitMs: number = 0
  ): Promise<BlockerDetectionResult> {
    try {
      let state: FormReadinessState = await page.evaluate(getFormReadinessState as any);
      if (
        state.blocker.type === 'no-form' &&
        state.blocker.matchedRule === 'zero_fillable_fields' &&
        waitMs > 0
      ) {
        try {
          await page.waitForFunction(
            () => {
              const el = document.querySelector(
                'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="password"]), select, textarea, [role="textbox"], [role="radio"], [role="radiogroup"], [role="checkbox"], [role="switch"], [role="listbox"], [role="combobox"], [aria-haspopup="listbox"], [contenteditable="true"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"]'
              );
              return Boolean(el);
            },
            undefined,
            { timeout: Math.min(waitMs, 5000) }
          );
          state = await page.evaluate(getFormReadinessState as any);
        } catch {
          // Bounded condition timeout reached; keep initial or re-evaluated no-form state
        }
      }
      return state.blocker;
    } catch (err: any) {
      const msg = err?.message || '';
      if (
        msg.includes('Execution context was destroyed') ||
        msg.includes('navigation') ||
        msg.includes('navigating') ||
        msg.includes('Target closed')
      ) {
        return { type: 'no-form', reason: 'Page currently navigating' };
      }
      throw err;
    }
  }

  /**
   * Run one navigation-safe evaluation returning the page readiness state.
   *
   * @param page Playwright Page instance.
   * @returns FormReadinessState with { blocker, fillableVisibleCount, fieldSignature }.
   */
  public async getReadinessStateOnPage(page: Page): Promise<FormReadinessState> {
    return await page.evaluate(getFormReadinessState as any);
  }
}
