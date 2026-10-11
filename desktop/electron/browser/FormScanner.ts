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
  type: 'text' | 'number' | 'email' | 'select' | 'radio' | 'checkbox' | 'date' | 'textarea';
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
    if (htmlEl.hidden || htmlEl.getAttribute('aria-hidden') === 'true') return false;
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
      if (parent.hidden || parent.getAttribute('aria-hidden') === 'true') return false;
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
            blocker: { type: 'captcha', reason: 'Security check or CAPTCHA detected on page' },
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
        blocker: { type: 'otp', reason: 'One-time verification code input detected' },
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
        blocker: { type: 'otp', reason: 'One-time verification code input detected' },
        fillableVisibleCount: 0,
        fieldSignature: '',
      };
    }
  }

  // 3. Password visibility check
  const pwInputs = d.querySelectorAll('input[type="password"]');
  let hasVisiblePassword = false;
  for (let i = 0; i < pwInputs.length; i++) {
    if (isVisible(pwInputs[i])) {
      hasVisiblePassword = true;
      break;
    }
  }

  // 4. Gather visible fillable fields (including modern custom controls: radio, checkbox, textbox)
  const fillableCandidates = d.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="password"]), select, textarea, [role="textbox"], [role="radio"], [role="checkbox"], [contenteditable="true"]'
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
    if (!labelText) {
      labelText = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    }

    const cleanLabel = labelText.trim().replace(/\s+/g, ' ');
    // Strictly metadata only: tag, inputType, name, id, label (strictly NO values)
    tokens.push(`${tag}:${inputType}:${name}:${id}:${cleanLabel}`);
  }

  // 5. Evaluate Login blocker:
  // If a password field is visible on screen:
  // - If <= 1 other fillable field exists (standard username + password gate): classify as login blocker.
  // - If 2 or more fillable fields exist (e.g. registration form): do not block, user is on a fillable form.
  if (hasVisiblePassword && tokens.length <= 1) {
    return {
      blocker: { type: 'login', reason: 'Visible password field detected' },
      fillableVisibleCount: 0,
      fieldSignature: '',
    };
  }

  // If no fillable fields exist yet, evaluate sign-in host and pathname segments
  if (tokens.length === 0) {
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
        blocker: { type: 'login', reason: `Known sign-in service host (${host})` },
        fillableVisibleCount: 0,
        fieldSignature: '',
      };
    }

    const path = (w?.location?.pathname || (d as any)?.location?.pathname || '').toLowerCase();
    if (/(?:^|\/)(login|signin|sign-in|sso|authenticate)(?:\/|$|\.|\?)/i.test(path)) {
      return {
        blocker: { type: 'login', reason: `Sign-in URL path segment (${path})` },
        fillableVisibleCount: 0,
        fieldSignature: '',
      };
    }

    return {
      blocker: { type: 'no-form', reason: 'No visible fillable form fields found' },
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
    blocker: { type: 'none', reason: 'Fillable form detected' },
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
  inputType: string;
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

    const title = await page.title();
    const url = page.url();

    const controls = await page.evaluate(() => {
      const collected: Array<{
        selector: string;
        tag: string;
        inputType: string;
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
        document.querySelectorAll('input:not([type="hidden"]), select, textarea')
      );

      formControls.forEach((el, index) => {
        const htmlEl = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const style = window.getComputedStyle(htmlEl);

        // Skip submit/button/reset/image controls (PolicyEngine guard and cleaner scan).
        // Also skip password and one-time-code / OTP inputs (never fill sensitive auth fields).
        const tagName = htmlEl.tagName.toLowerCase();
        const typeAttr = (htmlEl.getAttribute('type') || '').toLowerCase().trim();
        if (
          tagName === 'button' ||
          typeAttr === 'submit' ||
          typeAttr === 'button' ||
          typeAttr === 'reset' ||
          typeAttr === 'image' ||
          typeAttr === 'password' ||
          htmlEl.getAttribute('autocomplete') === 'one-time-code'
        ) {
          return;
        }

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
          const itemParent = htmlEl.closest('[role="listitem"]');
          if (itemParent) {
            const heading = itemParent.querySelector('[role="heading"]');
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
          } else {
            labelText = `Field ${index + 1}`;
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
        // Exclude genuinely hidden trap fields while preserving legitimate controls that
        // may use tabindex=-1, aria-hidden, or off-screen positioning (e.g. styled controls with visible labels).
        const nameAttr = htmlEl.getAttribute('name') || '';
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

        const isVisible = !isHoneypot && (isDirectlyVisible || isLabelVisible);

        const optionsList: string[] = [];
        if (htmlEl.tagName.toLowerCase() === 'select') {
          const selectEl = htmlEl as HTMLSelectElement;
          Array.from(selectEl.options).forEach((opt) => {
            const optVal = opt.textContent?.trim() || opt.value.trim();
            if (optVal && !optionsList.includes(optVal)) {
              optionsList.push(optVal);
            }
          });
        }

        let uniqueSelector = '';
        if (id) {
          uniqueSelector = `#${CSS.escape(id)}`;
        } else if (htmlEl.getAttribute('name')) {
          uniqueSelector = `${htmlEl.tagName.toLowerCase()}[name="${CSS.escape(htmlEl.getAttribute('name')!)}"]`;
        } else {
          uniqueSelector = `${htmlEl.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
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

        const enabledState: 'enabled' | 'readonly' | 'disabled' = htmlEl.disabled
          ? 'disabled'
          : Boolean((htmlEl as any).readOnly || htmlEl.hasAttribute('readonly'))
            ? 'readonly'
            : 'enabled';

        collected.push({
          selector: uniqueSelector,
          tag: htmlEl.tagName.toLowerCase(),
          inputType: typeAttr || (htmlEl.tagName.toLowerCase() === 'select' ? 'select' : 'text'),
          name: htmlEl.getAttribute('name') || '',
          groupLegend,
          label: labelText.replace(/[\s]+/g, ' ').trim(),
          required:
            htmlEl.required ||
            htmlEl.getAttribute('aria-required') === 'true' ||
            /\*/.test(labelText) ||
            Boolean(htmlEl.parentElement && htmlEl.parentElement.querySelector('.req')),
          currentValue: (htmlEl as HTMLInputElement).value || '',
          options: optionsList,
          disabled: htmlEl.disabled,
          visible: isVisible,
          isHoneypot,
          checked: Boolean((htmlEl as HTMLInputElement).checked),
          labelSource: labelSource || 'nearby text',
          enabledState,
          location: loc,
        });
      });

      return collected;
    });

    const fields: FormFieldSnapshot[] = [];
    const seenRadioGroups = new Set<string>();

    controls.forEach((item, index) => {
      const fieldRef = `field_${String(index + 1).padStart(3, '0')}`;

      // Collapse a radio group into one logical field keyed by its name attribute,
      // so a downstream selection cannot land in an unrelated group.
      if (item.inputType === 'radio' && item.name) {
        if (seenRadioGroups.has(item.name)) {
          return;
        }
        seenRadioGroups.add(item.name);

        const groupControls = controls.filter(
          (candidate) => candidate.inputType === 'radio' && candidate.name === item.name
        );
        const groupSelector = `input[type="radio"][name="${this.escapeAttribute(item.name)}"]`;
        this.selectorMap.set(fieldRef, groupSelector);
        this.nameMap.set(fieldRef, item.name);
        this.locatorMap.set(fieldRef, page.locator(groupSelector).first());

        // A radio's own accessible text is just its option ("Yes"). Fall back to the
        // group's question so the model sees a meaningful label like
        // "Does the student require transport?" instead of a bare "Yes".
        const groupLabel = this.resolveRadioGroupLabel(item, groupControls);

        let groupLabelSource = item.labelSource || 'label-for';
        if (item.groupLegend) {
          const optionTexts = new Set(groupControls.map((c) => c.label.trim().toLowerCase()));
          if (optionTexts.has(item.label.trim().toLowerCase())) {
            groupLabelSource = 'container heading';
          }
        }

        fields.push({
          ref: fieldRef,
          label: groupLabel,
          type: 'radio',
          required: groupControls.some((candidate) => candidate.required),
          currentValue: groupControls.find((candidate) => candidate.checked)?.currentValue || '',
          options: Array.from(
            new Set(groupControls.map((candidate) => candidate.currentValue).filter(Boolean))
          ),
          disabled: groupControls.every((candidate) => candidate.disabled),
          visible: groupControls.some((candidate) => candidate.visible),
          isHoneypot: groupControls.some((candidate) => candidate.isHoneypot),
          labelSource: groupLabelSource,
          enabledState: groupControls.every((candidate) => candidate.disabled) ? 'disabled' : 'enabled',
          location: item.location || 'main',
        });
        return;
      }

      let fieldType: FormFieldSnapshot['type'] = 'text';
      if (item.tag === 'select') fieldType = 'select';
      else if (item.tag === 'textarea') fieldType = 'textarea';
      else if (item.inputType === 'checkbox') fieldType = 'checkbox';
      else if (item.inputType === 'number') fieldType = 'number';
      else if (item.inputType === 'email') fieldType = 'email';
      else if (item.inputType === 'date') fieldType = 'date';

      this.selectorMap.set(fieldRef, item.selector);
      this.locatorMap.set(fieldRef, page.locator(item.selector).first());
      if (item.name) {
        this.nameMap.set(fieldRef, item.name);
      }

      fields.push({
        ref: fieldRef,
        label: item.label,
        type: fieldType,
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
   * Evaluate pure DOM detectBlocker on the given Playwright page safely.
   *
   * @param page Playwright Page instance.
   * @param _waitMs Optional parameter kept for interface compatibility (no polling).
   * @returns BlockerDetectionResult.
   */
  public async detectBlockerOnPage(
    page: Page,
    _waitMs: number = 0
  ): Promise<BlockerDetectionResult> {
    try {
      const state: FormReadinessState = await page.evaluate(getFormReadinessState as any);
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
