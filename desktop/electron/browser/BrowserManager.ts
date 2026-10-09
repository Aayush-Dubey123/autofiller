/**
 * BrowserManager managing Playwright Chromium lifecycle and controlled form interactions.
 *
 * Provides:
 * - Visible browser execution for human supervision.
 * - Cooperative cancellation so Pause/Stop interrupt in-flight navigation and input.
 * - Group-scoped radio selection and normalized date input.
 * - Integration with FormScanner and PolicyEngine.
 */

import * as path from 'path';
import * as fs from 'fs';
import { chromium, Browser, BrowserContext, Page, Locator } from 'playwright';
import { FormScanner, FormSnapshot } from './FormScanner';
import { PolicyEngine, SubmissionControl } from '../policy/PolicyEngine';

/** Error raised when the operator cancels an in-flight browser operation. */
export class OperationCancelledError extends Error {
  constructor(message = 'WORKFLOW_STOPPED_BY_USER') {
    super(message);
    this.name = 'OperationCancelledError';
  }
}

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private scanner: FormScanner;
  private policyEngine: PolicyEngine;
  private pendingHighlight: Locator | null = null;

  constructor() {
    this.scanner = new FormScanner();
    this.policyEngine = new PolicyEngine();
  }

  /**
   * Run an awaited operation while observing a cooperative cancellation signal.
   *
   * Races the operation against the signal so a Stop press takes effect during a slow
   * navigation or keystroke sequence instead of only between steps.
   *
   * @param signal Optional abort signal supplied by the agent controller.
   * @param operation Promise-returning operation to await.
   * @returns The resolved value of the operation.
   * @throws OperationCancelledError when the signal aborts before completion.
   */
  private async withCancellation<T>(signal: AbortSignal | undefined, operation: Promise<T>): Promise<T> {
    if (!signal) {
      return operation;
    }
    if (signal.aborted) {
      throw new OperationCancelledError();
    }

    let abortHandler: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      abortHandler = () => reject(new OperationCancelledError());
      signal.addEventListener('abort', abortHandler, { once: true });
    });

    try {
      return await Promise.race([operation, abortPromise]);
    } finally {
      if (abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
    }
  }

  /**
   * Sleep for a duration while remaining cancellable.
   *
   * @param ms Milliseconds to wait.
   * @param signal Optional abort signal supplied by the agent controller.
   */
  private async cancellableDelay(ms: number, signal?: AbortSignal): Promise<void> {
    await this.withCancellation(
      signal,
      new Promise<void>((resolve) => setTimeout(resolve, ms))
    );
  }

  /**
   * Launch the visible Playwright Chromium browser.
   *
   * @param headless Whether to run without a visible window.
   */
  public async launch(headless: boolean = false): Promise<void> {
    if (!this.browser) {
      const launchOptions: any = {
        headless,
        args: ['--disable-blink-features=AutomationControlled'],
      };
      try {
        this.browser = await chromium.launch(launchOptions);
      } catch (err: any) {
        if (err?.message?.includes("Executable doesn't exist")) {
          try {
            this.browser = await chromium.launch({ ...launchOptions, channel: 'chrome' });
          } catch {
            this.browser = await chromium.launch({ ...launchOptions, channel: 'msedge' });
          }
        } else {
          throw err;
        }
      }
      this.context = await this.browser.newContext({
        viewport: null,
        locale: 'en-IN',
      });
      this.page = await this.context.newPage();
    }
  }

  /**
   * Navigate to a target form URL after enforcing the navigation policy.
   *
   * @param url Target form URL.
   * @param signal Optional abort signal supplied by the agent controller.
   * @throws Error when the navigation policy denies the host.
   */
  public async navigateTo(url: string, signal?: AbortSignal): Promise<void> {
    const currentHost = this.page ? new URL(this.page.url() || 'about:blank').host : '';
    const policy = this.policyEngine.validateNavigation(currentHost, url);
    if (!policy.allowed) {
      throw new Error(`[PolicyEngine] ${policy.code}: ${policy.reason}`);
    }

    if (!this.page) {
      await this.launch();
    }

    // Resilient navigation: If user or preset targeted an unreachable local mock URL,
    // fallback automatically to backend-hosted mock form or bundled fixture.
    try {
      await this.withCancellation(
        signal,
        this.page!.goto(url, { waitUntil: 'load', timeout: 30000 })
      );
    } catch (error: any) {
      const isConnRefused = error?.message?.includes('ERR_CONNECTION_REFUSED');
      const isMockForm = url.includes('mock_school_form.html');
      if (isConnRefused && isMockForm) {
        const fallbackBackendUrl = 'http://127.0.0.1:8000/mock_school_form.html';
        const candidatePaths = [
          path.resolve(__dirname, '../../public/mock_school_form.html'),
          path.resolve(__dirname, '../../../desktop/public/mock_school_form.html'),
          path.resolve(__dirname, '../../test-fixtures/mock_school_form.html'),
          path.resolve(__dirname, '../../../test-fixtures/mock_school_form.html'),
        ];
        const found = candidatePaths.find((p) => fs.existsSync(p));
        const fallbackFileUrl = found ? `file://${found.replace(/\\/g, '/')}` : '';
        console.warn(`Target form ${url} unreachable. Attempting fallback to ${fallbackBackendUrl}...`);
        try {
          await this.withCancellation(
            signal,
            this.page!.goto(fallbackBackendUrl, { waitUntil: 'load', timeout: 10000 })
          );
        } catch {
          if (fallbackFileUrl) {
            console.warn(`Fallback to backend mock form failed. Attempting local file: ${fallbackFileUrl}`);
            await this.withCancellation(
              signal,
              this.page!.goto(fallbackFileUrl, { waitUntil: 'load', timeout: 10000 })
            );
          }
        }
      } else {
        throw error;
      }
    }
    await this.cancellableDelay(500, signal);
  }

  /**
   * Inspect visible submission-capable controls without exposing them as fillable fields.
   *
   * Submit buttons are intentionally excluded from FormSnapshot, but the policy audit
   * still needs to see the real page controls so it can record the submission block.
   *
   * @returns Submission controls discovered on the active page.
   */
  public async scanSubmissionControls(): Promise<SubmissionControl[]> {
    if (!this.page) {
      throw new Error('Browser is not initialized or page is not open.');
    }

    return await this.page.evaluate(() => {
      const controls: SubmissionControl[] = [];
      const elements = Array.from(
        document.querySelectorAll('button, input[type="submit"], input[type="image"], input[type="button"]')
      );

      elements.forEach((element, index) => {
        const htmlElement = element as HTMLButtonElement | HTMLInputElement;
        const style = window.getComputedStyle(htmlElement);
        const visible =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          htmlElement.offsetParent !== null;
        if (!visible || htmlElement.disabled) return;

        const label =
          htmlElement.textContent?.trim() ||
          htmlElement.getAttribute('aria-label')?.trim() ||
          htmlElement.getAttribute('value')?.trim() ||
          `Submission control ${index + 1}`;
        const id = htmlElement.id;
        const selector = id
          ? `#${CSS.escape(id)}`
          : `${htmlElement.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
        const rawType = htmlElement.getAttribute('type');
        const typeAttr = (rawType || '').toLowerCase().trim();
        const isButton = htmlElement.tagName.toLowerCase() === 'button';

        // In HTML, buttons without an explicit type attribute default to "submit".
        // type="button" and type="reset" are not treated as final submission controls.
        const effectiveType = typeAttr || (isButton ? 'submit' : 'text');
        const isSubmitType =
          effectiveType === 'submit' ||
          effectiveType === 'image' ||
          (isButton && effectiveType !== 'button' && effectiveType !== 'reset');

        controls.push({
          label,
          selector,
          isSubmitType,
          type: effectiveType,
        });
      });

      return controls;
    });
  }

  /**
   * Scan the active web form into a structured FormSnapshot.
   *
   * @returns Structured snapshot of the active page form.
   */
  public async scanActiveForm(): Promise<FormSnapshot> {
    if (!this.page) {
      throw new Error('Browser is not initialized or page is not open.');
    }
    return await this.scanner.scanForm(this.page);
  }

  /**
   * Apply a visible highlight to a field so the operator can follow along.
   *
   * @param locator Target field locator.
   */
  private async highlightField(locator: Locator): Promise<void> {
    if (!this.page) return;
    try {
      await locator.evaluate((el) => {
        const target = el as HTMLElement;
        target.style.outline = '3px solid #6366f1';
        target.style.boxShadow = '0 0 12px rgba(99, 102, 241, 0.6)';
        target.style.transition = 'all 0.3s ease';
      });
      this.pendingHighlight = locator;
    } catch {
      // Non-critical visual feedback.
    }
  }

  /**
   * Remove any active field highlight.
   */
  private async clearHighlight(): Promise<void> {
    if (!this.page || !this.pendingHighlight) return;
    try {
      await this.pendingHighlight.evaluate((el) => {
        const target = el as HTMLElement;
        target.style.outline = '';
        target.style.boxShadow = '';
      });
    } catch {
      // Non-critical visual feedback.
    } finally {
      this.pendingHighlight = null;
    }
  }

  /**
   * Normalize a variety of date formats into the HTML date input format.
   *
   * @param value Raw date value from an extracted document fact.
   * @returns Date string in YYYY-MM-DD form when the input is parseable.
   */
  public normalizeDateValue(value: string): string {
    const trimmed = (value || '').trim();
    if (!trimmed) return trimmed;

    // Clean commas from date strings (e.g. "March 23, 2005")
    const cleaned = trimmed.replace(/,/g, '');

    // Split on slashes, dashes, dots, or spaces
    const parts = cleaned.split(/[-/.\s]+/);
    if (parts.length === 3) {
      let [first, middle, last] = parts;
      const monthMap: Record<string, string> = {
        jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
        jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
        january: '01', february: '02', march: '03', april: '04', june: '06',
        july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
      };

      const mNameMid = middle.toLowerCase();
      const mNameFirst = first.toLowerCase();
      if (monthMap[mNameMid]) {
        middle = monthMap[mNameMid];
      } else if (monthMap[mNameFirst]) {
        const temp = monthMap[mNameFirst];
        first = middle;
        middle = temp;
      }

      // Case 1: YYYY-MM-DD
      if (first.length === 4) {
        return `${first}-${middle.padStart(2, '0')}-${last.padStart(2, '0')}`;
      }

      // Case 2: DD-MM-YYYY or MM-DD-YYYY
      if (last.length === 4) {
        const p1 = parseInt(first, 10);
        const p2 = parseInt(middle, 10);
        // If middle > 12 and first <= 12, middle is Day and first is Month (US format MM-DD-YYYY)
        if (!isNaN(p1) && !isNaN(p2) && p2 > 12 && p1 <= 12) {
          return `${last}-${first.padStart(2, '0')}-${middle.padStart(2, '0')}`;
        }
        // Otherwise standard DD-MM-YYYY: first is Day, middle is Month
        return `${last}-${middle.padStart(2, '0')}-${first.padStart(2, '0')}`;
      }
    }

    // Fallback: standard Date parsing
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    return trimmed;
  }

  /**
   * Determine if a field represents a date input based on its attributes.
   */
  public isDateField(fieldRef: string): boolean {
    const name = (this.scanner.getName(fieldRef) || '').toLowerCase();
    const selector = (this.scanner.getSelector(fieldRef) || '').toLowerCase();
    return (
      name.includes('dob') ||
      name.includes('birth') ||
      name.includes('date') ||
      selector.includes('dob') ||
      selector.includes('birth') ||
      selector.includes('date')
    );
  }

  /**
   * Format any date value into strict DD/MM/YYYY format.
   *
   * @param value Raw date string.
   * @returns Date string in DD/MM/YYYY format.
   */
  public formatToStrictDDMMYYYY(value: string): string {
    const trimmed = (value || '').trim();
    if (!trimmed) return trimmed;
    const parts = trimmed.split(/[-/.\s]+/);
    if (parts.length === 3) {
      let [first, middle, last] = parts;
      const monthMap: Record<string, string> = {
        jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
        jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
        january: '01', february: '02', march: '03', april: '04', june: '06',
        july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
      };

      const mNameMid = middle.toLowerCase();
      const mNameFirst = first.toLowerCase();
      if (monthMap[mNameMid]) {
        middle = monthMap[mNameMid];
      } else if (monthMap[mNameFirst]) {
        const temp = monthMap[mNameFirst];
        first = middle;
        middle = temp;
      }

      // Case 1: YYYY-MM-DD -> DD/MM/YYYY
      if (first.length === 4) {
        return `${last.padStart(2, '0')}/${middle.padStart(2, '0')}/${first}`;
      }

      // Case 2: DD-MM-YYYY or MM-DD-YYYY
      if (last.length === 4) {
        const p1 = parseInt(first, 10);
        const p2 = parseInt(middle, 10);
        if (!isNaN(p1) && !isNaN(p2) && p2 > 12 && p1 <= 12) {
          return `${middle.padStart(2, '0')}/${first.padStart(2, '0')}/${last}`;
        }
        return `${first.padStart(2, '0')}/${middle.padStart(2, '0')}/${last}`;
      }
    }

    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      const day = String(parsed.getDate()).padStart(2, '0');
      const month = String(parsed.getMonth() + 1).padStart(2, '0');
      const year = parsed.getFullYear();
      return `${day}/${month}/${year}`;
    }

    return trimmed;
  }

  /**
   * Resolve the locator and selector for a field reference.
   *
   * @param fieldRef Stable field reference such as 'field_001'.
   * @returns The locator and selector pair.
   * @throws Error when the reference is not present in the active snapshot.
   */
  private resolveField(fieldRef: string): { locator: Locator; name?: string } {
    const locator = this.scanner.getLocator(fieldRef);
    const selector = this.scanner.getSelector(fieldRef);
    if (!locator || !selector) {
      throw new Error(`Field reference '${fieldRef}' not found in active FormSnapshot.`);
    }
    return { locator, name: this.scanner.getName(fieldRef) };
  }

  /**
   * Populate a text, email, number, date, or textarea field.
   *
   * @param fieldRef Stable field reference.
   * @param value Value to type into the field.
   * @param signal Optional abort signal supplied by the agent controller.
   * @returns Whether the DOM value matched the intended value after typing.
   */
  public async fillText(
    fieldRef: string,
    value: string,
    signal?: AbortSignal
  ): Promise<{ success: boolean; actualValue: string; expectedValue: string }> {
    const { locator } = this.resolveField(fieldRef);
    if (!this.page) {
      throw new Error('Browser is not initialized or page is not open.');
    }

    const inputType = ((await locator.getAttribute('type')) || '').toLowerCase();
    let expectedValue = value;
    if (inputType === 'date') {
      // HTML5 date input standard property requires YYYY-MM-DD format internally.
      expectedValue = this.normalizeDateValue(value);
    } else if (this.isDateField(fieldRef)) {
      // Text inputs for dates are strictly formatted as DD/MM/YYYY.
      expectedValue = this.formatToStrictDDMMYYYY(value);
    }

    await this.highlightField(locator);
    await this.withCancellation(signal, locator.scrollIntoViewIfNeeded({ timeout: 2500 }));
    if (inputType === 'date') {
      // Use fill() for HTML5 date inputs to set the ISO YYYY-MM-DD value directly.
      // With locale: 'en-IN' configured on the browser context, Chromium displays it as dd/mm/yyyy.
      await this.withCancellation(signal, locator.fill(expectedValue));
    } else {
      await this.withCancellation(signal, locator.fill(''));
      await this.withCancellation(
        signal,
        locator.pressSequentially(expectedValue, { delay: 25 })
      );
    }
    await this.cancellableDelay(150, signal);

    const actualValue = await locator.inputValue();
    await this.clearHighlight();

    const isDate = inputType === 'date' || this.isDateField(fieldRef);
    const matched =
      actualValue === expectedValue ||
      (isDate &&
        (this.formatToStrictDDMMYYYY(actualValue) === this.formatToStrictDDMMYYYY(expectedValue) ||
          this.normalizeDateValue(actualValue) === this.normalizeDateValue(expectedValue)));

    return {
      success: matched,
      actualValue,
      expectedValue,
    };
  }

  /**
   * Select an option in a dropdown by visible label, then by value.
   *
   * @param fieldRef Stable field reference.
   * @param option Option label or value.
   * @param signal Optional abort signal supplied by the agent controller.
   * @returns Whether the resulting selection matches the requested option.
   */
  public async selectOption(
    fieldRef: string,
    option: string,
    signal?: AbortSignal
  ): Promise<{ success: boolean; selectedOption: string; expectedOption: string; reason?: string }> {
    const { locator } = this.resolveField(fieldRef);
    if (!this.page) {
      throw new Error('Browser is not initialized or page is not open.');
    }

    await this.highlightField(locator);
    await this.withCancellation(signal, locator.scrollIntoViewIfNeeded({ timeout: 2500 }));

    // Bounded attempt: an option that does not exist must produce an honest failure
    // result, not a long Playwright timeout that stalls the whole workflow.
    let applied = true;
    try {
      const optionDetails = await locator
        .evaluate((el: HTMLSelectElement) =>
          Array.from(el.options).map((o) => ({
            text: (o.text || '').trim(),
            value: (o.value || '').trim(),
          }))
        )
        .catch(() => null);

      if (optionDetails && optionDetails.length > 0) {
        const targetTrimmed = option.trim().toLowerCase();
        const matched = optionDetails.find(
          (o) => o.text.toLowerCase() === targetTrimmed || o.value.toLowerCase() === targetTrimmed
        );
        if (!matched && optionDetails.length > 1) {
          // Select element already has populated options and none match the requested option
          applied = false;
        } else if (matched) {
          await this.withCancellation(
            signal,
            locator.selectOption({ value: matched.value }, { timeout: 1000 })
          );
        } else {
          await this.withCancellation(
            signal,
            locator.selectOption({ label: option }, { timeout: 1000 })
          );
        }
      } else {
        await this.withCancellation(
          signal,
          locator.selectOption({ label: option }, { timeout: 1000 })
        );
      }
    } catch {
      try {
        await this.withCancellation(
          signal,
          locator.selectOption({ value: option }, { timeout: 1000 })
        );
      } catch {
        applied = false;
      }
    }
    await this.cancellableDelay(100, signal);

    if (!applied) {
      await this.clearHighlight();
      return {
        success: false,
        selectedOption: '',
        expectedOption: option,
        reason: `Option '${option}' is not available in this dropdown.`,
      };
    }

    const selected = await locator.inputValue();
    const selectedLabel = await locator
      .evaluate((el) => {
        const select = el as HTMLSelectElement;
        return select.options[select.selectedIndex]?.textContent?.trim() || '';
      })
      .catch(() => '');

    await this.clearHighlight();
    const matched =
      selected.trim() === option.trim() ||
      selectedLabel.trim().toLowerCase() === option.trim().toLowerCase();

    return { success: matched, selectedOption: selectedLabel || selected, expectedOption: option };
  }

  /**
   * Select a radio option scoped to the correct radio group.
   *
   * The locator is narrowed by the group's name attribute so a value that exists in
   * multiple groups cannot select the wrong control.
   *
   * @param fieldRef Stable field reference for the radio group.
   * @param optionValue Option value or visible label to select.
   * @param signal Optional abort signal supplied by the agent controller.
   * @returns Whether a matching radio control is now checked.
   */
  public async selectRadio(
    fieldRef: string,
    optionValue: string,
    signal?: AbortSignal
  ): Promise<{ success: boolean; selectedValue: string }> {
    const { name } = this.resolveField(fieldRef);
    if (!this.page) {
      throw new Error('Browser is not initialized or page is not open.');
    }

    const groupSelector = name
      ? `input[type="radio"][name="${this.escapeAttribute(name)}"]`
      : 'input[type="radio"]';
    const group = this.page.locator(groupSelector);
    const groupSize = await group.count();
    if (groupSize === 0) {
      throw new Error(`No radio controls found for field '${fieldRef}'.`);
    }

    // Resolution order: exact value, case-insensitive value, then associated label text.
    let target: Locator | null = null;
    for (let index = 0; index < groupSize; index += 1) {
      const candidate = group.nth(index);
      const candidateValue = (await candidate.getAttribute('value')) || '';
      if (candidateValue === optionValue) {
        target = candidate;
        break;
      }
    }

    if (!target) {
      for (let index = 0; index < groupSize; index += 1) {
        const candidate = group.nth(index);
        const candidateValue = ((await candidate.getAttribute('value')) || '').toLowerCase();
        if (candidateValue && candidateValue === optionValue.toLowerCase()) {
          target = candidate;
          break;
        }
      }
    }

    if (!target) {
      const labelMatch = this.page.locator(
        `label:has-text("${this.escapeAttribute(optionValue)}") input[type="radio"][name="${this.escapeAttribute(name || '')}"]`
      );
      if ((await labelMatch.count()) > 0) {
        target = labelMatch.first();
      }
    }

    if (!target) {
      throw new Error(
        `Radio option '${optionValue}' not found in group for field '${fieldRef}'.`
      );
    }

    await this.highlightField(target);
    await this.withCancellation(signal, target.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {}));
    await this.withCancellation(signal, target.check({ timeout: 2500 }));
    const isChecked = await target.isChecked();
    const selectedValue = (await target.getAttribute('value')) || '';
    await this.clearHighlight();

    return { success: isChecked, selectedValue };
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
   * Set the checked state of a checkbox.
   *
   * @param fieldRef Stable field reference.
   * @param checked Desired checked state.
   * @param signal Optional abort signal supplied by the agent controller.
   * @returns Whether the resulting state matches the requested state.
   */
  public async setCheckbox(
    fieldRef: string,
    checked: boolean,
    signal?: AbortSignal
  ): Promise<{ success: boolean; isChecked: boolean; expectedChecked: boolean }> {
    const { locator } = this.resolveField(fieldRef);

    await this.highlightField(locator);

    let done = false;
    try {
      await this.withCancellation(signal, locator.scrollIntoViewIfNeeded({ timeout: 2500 }));
      await this.withCancellation(signal, locator.setChecked(checked, { timeout: 2500 }));
      done = (await locator.isChecked()) === checked;
    } catch {
      done = false;
    }

    if (!done) {
      // Fallback: check via associated label element if direct input interaction timed out
      // (common in styled checkboxes where <input> is visually hidden by CSS)
      const id = await locator.getAttribute('id').catch(() => null);
      let labelLoc: Locator | null = null;
      if (id && this.page) {
        const forLabel = this.page.locator(`label[for="${CSS.escape(id)}"]`).first();
        if ((await forLabel.count()) > 0) {
          labelLoc = forLabel;
        }
      }
      if (!labelLoc) {
        const parentLabel = locator.locator('xpath=ancestor::label[1]').first();
        if ((await parentLabel.count()) > 0) {
          labelLoc = parentLabel;
        }
      }

      if (labelLoc && (await labelLoc.count()) > 0) {
        try {
          await this.withCancellation(signal, labelLoc.scrollIntoViewIfNeeded({ timeout: 2500 }));
          const curChecked = await locator.isChecked();
          if (curChecked !== checked) {
            await this.withCancellation(signal, labelLoc.click({ timeout: 2500 }));
          }
        } catch {
          // If label interaction fails, fall through to final check
        }
      }
    }

    const isChecked = await locator.isChecked();
    await this.clearHighlight();
    return { success: isChecked === checked, isChecked, expectedChecked: checked };
  }

  /**
   * Scroll a field into view.
   *
   * @param fieldRef Stable field reference.
   * @param signal Optional abort signal supplied by the agent controller.
   */
  public async scrollToField(fieldRef: string, signal?: AbortSignal): Promise<void> {
    const locator = this.scanner.getLocator(fieldRef);
    if (locator) {
      await this.withCancellation(signal, locator.scrollIntoViewIfNeeded({ timeout: 2500 }));
    }
  }

  /**
   * Read back the current value of a field for verification.
   *
   * @param fieldRef Stable field reference.
   * @param expectedValue Value the field is expected to contain.
   * @returns Whether the read-back value matches the expected value.
   */
  public async verifyField(
    fieldRef: string,
    expectedValue: string
  ): Promise<{ verified: boolean; actualValue: string; expectedValue: string }> {
    const locator = this.scanner.getLocator(fieldRef);
    if (!locator) {
      throw new Error(`Field reference '${fieldRef}' not found.`);
    }

    const inputType = ((await locator.getAttribute('type').catch(() => '')) || '').toLowerCase();

    // Checkbox read-back verification: evaluate checked state against affirmative/negative tokens
    if (inputType === 'checkbox') {
      const isChecked = await locator.isChecked().catch(() => false);
      const affirmative = new Set(['true', 'yes', 'y', '1', 'on', 'checked', 'agree', 'accepted']);
      const negative = new Set(['false', 'no', 'n', '0', 'off', 'unchecked', 'declined']);
      const normalizedExpected = expectedValue.trim().toLowerCase();

      const expectedBool = affirmative.has(normalizedExpected)
        ? true
        : negative.has(normalizedExpected)
          ? false
          : Boolean(expectedValue.trim());

      const verified = isChecked === expectedBool;
      return {
        verified,
        actualValue: isChecked ? 'checked' : 'unchecked',
        expectedValue,
      };
    }

    // Radio group read-back verification: find which radio in the group is checked
    if (inputType === 'radio') {
      const { name } = this.resolveField(fieldRef);
      const groupSelector = name
        ? `input[type="radio"][name="${this.escapeAttribute(name)}"]`
        : 'input[type="radio"]';
      let checkedValue = '';
      if (this.page) {
        const group = this.page.locator(groupSelector);
        const count = await group.count();
        for (let i = 0; i < count; i++) {
          const item = group.nth(i);
          if (await item.isChecked().catch(() => false)) {
            checkedValue = ((await item.getAttribute('value')) || '').trim();
            break;
          }
        }
      }
      const normalize = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, ' ');
      const verified = normalize(checkedValue) === normalize(expectedValue);
      return { verified, actualValue: checkedValue, expectedValue };
    }

    // Select element read-back verification: verify against selected option value or visible text
    const tagName = ((await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => '')) || '');
    if (tagName === 'select') {
      const selectedVal = (await locator.inputValue().catch(() => '')) || '';
      const selectedLabel = await locator
        .evaluate((el) => {
          const select = el as HTMLSelectElement;
          return select.options[select.selectedIndex]?.textContent?.trim() || '';
        })
        .catch(() => '');
      const normalize = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, ' ');
      const normExpected = normalize(expectedValue);
      const verified =
        normalize(selectedVal) === normExpected ||
        normalize(selectedLabel) === normExpected;
      return { verified, actualValue: selectedLabel || selectedVal, expectedValue };
    }

    const actualValue = (await locator.inputValue().catch(() => '')) || '';
    const normalize = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, ' ');

    let verified = normalize(actualValue) === normalize(expectedValue);
    if (!verified && (inputType === 'date' || this.isDateField(fieldRef))) {
      const normExpectedIso = this.normalizeDateValue(expectedValue);
      const normActualIso = this.normalizeDateValue(actualValue);
      const normExpectedDd = this.formatToStrictDDMMYYYY(expectedValue);
      const normActualDd = this.formatToStrictDDMMYYYY(actualValue);

      verified =
        normalize(actualValue) === normalize(normExpectedIso) ||
        normalize(actualValue) === normalize(normExpectedDd) ||
        normalize(normActualIso) === normalize(normExpectedIso) ||
        normalize(normActualDd) === normalize(normExpectedDd);
    }

    return { verified, actualValue, expectedValue };
  }

  /**
   * Click an allowed wizard pagination button (e.g. Next, Continue).
   *
   * Enforces the policy guard to guarantee that final submission controls
   * can never be clicked via this method.
   *
   * @param label Button text or accessible label.
   * @param selector Optional DOM selector for the control.
   * @param signal Optional abort signal.
   * @returns Success confirmation.
   */
  public async clickPagination(
    label: string,
    selector?: string,
    signal?: AbortSignal
  ): Promise<{ success: boolean; label: string }> {
    if (!this.page) {
      throw new Error('Browser is not initialized or page is not open.');
    }

    // Double check with PolicyEngine
    const decision = this.policyEngine.validateBrowserAction('click', label, false);
    if (!decision.allowed || decision.code !== 'ALLOWED_PAGINATION') {
      throw new Error(`[PolicyEngine] ${decision.code}: Action '${label}' is not an allowed pagination step.`);
    }

    // 1. Try provided selector if visible and not disabled
    let target: Locator | null = null;
    if (selector) {
      const candidate = this.page.locator(selector);
      const isVis = await candidate.isVisible().catch(() => false);
      if (isVis) {
        const isDis = await candidate.isDisabled({ timeout: 500 }).catch(() => true);
        if (!isDis) {
          target = candidate;
        }
      }
    }

    // 2. Fall back to finding visible enabled button matching the label
    if (!target) {
      const candidates = this.page.locator('button, input[type="button"], a');
      const count = await candidates.count();
      for (let i = 0; i < count; i++) {
        const candidate = candidates.nth(i);
        const isVis = await candidate.isVisible().catch(() => false);
        if (isVis) {
          const isDis = await candidate.isDisabled({ timeout: 500 }).catch(() => true);
          if (!isDis) {
            const text =
              (await candidate.textContent().catch(() => ''))?.trim() ||
              (await candidate.getAttribute('value').catch(() => ''))?.trim() ||
              '';
            if (text.toLowerCase() === label.trim().toLowerCase()) {
              target = candidate;
              break;
            }
          }
        }
      }
    }

    if (!target) {
      throw new Error(`Pagination button '${label}' was not visible or was disabled.`);
    }

    // Highlight briefly for user visibility
    await this.highlightField(target).catch(() => {});
    await this.withCancellation(signal, target.click({ timeout: 5000 }));
    await this.clearHighlight().catch(() => {});

    // Allow page to settle
    await this.page.waitForLoadState('domcontentloaded', { timeout: 500 }).catch(() => {});
    await this.page.waitForTimeout(200).catch(() => {});

    return { success: true, label };
  }


  /**
   * Check whether the Playwright page is currently closed or uninitialized.
   */
  public isPageClosed(): boolean {
    return !this.page || this.page.isClosed();
  }

  /**
   * Attach non-intrusive listeners to the active page to detect custom submission events
   * emitted by forms upon successful manual submission.
   */
  public async setupSubmissionListener(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      await this.page.evaluate(() => {
        if ((window as any).__autofiller_listener_attached) return;
        (window as any).__autofiller_listener_attached = true;
        (window as any).__autofiller_submitted = false;

        const markSubmitted = () => {
          (window as any).__autofiller_submitted = true;
        };

        window.addEventListener('autofiller:submitted', markSubmitted, { passive: true });
        window.addEventListener('formpilot:submitted', markSubmitted, { passive: true });
      });
    } catch {
      // Ignored if page context is destroyed or unavailable
    }
  }

  /**
   * Check whether the active page displays an unambiguous post-submission confirmation state.
   *
   * Detects:
   * 1. Window custom event flags (__autofiller_submitted).
   * 2. Visible confirmation elements (#submitted-confirmation, .submitted-confirmation, etc.).
   * 3. Typical confirmation copy in visible inner text.
   * 4. Confirmation / thank-you URLs.
   *
   * @returns True if submission confirmation is active on the page.
   */
  public async checkSubmissionConfirmed(): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;
    try {
      return await this.page.evaluate(() => {
        // 0. Check for explicit visible error states / failure banners. If error is visible, do not report confirmed!
        const errorElements = document.querySelectorAll(
          '#error-summary, .error-message, .alert-danger, .submission-error, .form-errors, [data-error]'
        );
        for (const el of Array.from(errorElements)) {
          const style = window.getComputedStyle(el);
          if (style.display !== 'none' && style.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null) {
            return false;
          }
        }

        const bodyText = document.body ? document.body.innerText : '';
        const errorPatterns = [
          /submission failed/i,
          /failed to submit/i,
          /there was an error submitting/i,
          /please fix the errors/i,
          /please correct the errors/i,
        ];
        for (const errPat of errorPatterns) {
          if (errPat.test(bodyText)) {
            return false;
          }
        }

        // 1. Check window event flag
        if ((window as any).__autofiller_submitted) return true;

        // 2. Check explicit ID/class confirmation elements
        const idConf = document.getElementById('submitted-confirmation');
        if (idConf) {
          const style = window.getComputedStyle(idConf);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            return true;
          }
        }

        const classConf = document.querySelector('.submitted-confirmation, [data-submitted]');
        if (classConf) {
          const style = window.getComputedStyle(classConf);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            return true;
          }
        }

        // 3. Check page text for unambiguous submission confirmation indicators
        const confirmationPatterns = [
          /application submitted successfully/i,
          /form submitted successfully/i,
          /submitted successfully/i,
          /submission received/i,
          /thank you for your submission/i,
          /thank you for submitting/i,
          /your response has been recorded/i,
        ];
        for (const pattern of confirmationPatterns) {
          if (pattern.test(bodyText)) {
            return true;
          }
        }

        // 4. Check URL pathname for redirect confirmation
        const path = window.location.pathname.toLowerCase();
        if (
          path.includes('/submitted') ||
          path.includes('/thank-you') ||
          path.includes('/confirmation') ||
          path.includes('/success')
        ) {
          return true;
        }

        return false;
      });
    } catch {
      return false;
    }
  }

  /**
   * Wait for submission confirmation on the active page with a bounded timeout.
   *
   * @param timeoutMs Maximum milliseconds to wait.
   * @param signal Cancellation signal.
   * @returns True if confirmation was detected within timeoutMs.
   */
  public async waitForSubmissionConfirmation(
    timeoutMs: number = 30000,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;
    await this.setupSubmissionListener().catch(() => {});
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted || !this.page || this.page.isClosed()) return false;
      const confirmed = await this.checkSubmissionConfirmed();
      if (confirmed) return true;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return false;
  }

  /**
   * Close the Playwright browser and clear cached state.
   */
  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => { });
      this.browser = null;
      this.context = null;
      this.page = null;
      this.pendingHighlight = null;
    }
  }
}

