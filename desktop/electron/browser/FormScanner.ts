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
}

export interface FormSnapshot {
  url: string;
  title: string;
  fields: FormFieldSnapshot[];
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
  checked: boolean;
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
        checked: boolean;
      }> = [];

      const formControls = Array.from(
        document.querySelectorAll('input:not([type="hidden"]), select, textarea')
      );

      formControls.forEach((el, index) => {
        const htmlEl = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const style = window.getComputedStyle(htmlEl);
        const isVisible =
          style.display !== 'none' && style.visibility !== 'hidden' && htmlEl.offsetParent !== null;

        // Skip submit/button/reset/image controls (PolicyEngine guard and cleaner scan).
        const tagName = htmlEl.tagName.toLowerCase();
        const typeAttr = (htmlEl.getAttribute('type') || '').toLowerCase().trim();
        if (
          tagName === 'button' ||
          typeAttr === 'submit' ||
          typeAttr === 'button' ||
          typeAttr === 'reset' ||
          typeAttr === 'image'
        ) {
          return;
        }

        let labelText = '';
        const id = htmlEl.id;
        if (id) {
          const labelEl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (labelEl) {
            labelText = labelEl.textContent?.trim() || '';
          }
        }
        if (!labelText && htmlEl.closest('label')) {
          labelText = htmlEl.closest('label')?.textContent?.trim() || '';
        }
        if (!labelText) {
          labelText =
            htmlEl.getAttribute('aria-label') ||
            htmlEl.getAttribute('placeholder') ||
            htmlEl.getAttribute('name') ||
            `Field ${index + 1}`;
        }

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

        collected.push({
          selector: uniqueSelector,
          tag: htmlEl.tagName.toLowerCase(),
          inputType: typeAttr || (htmlEl.tagName.toLowerCase() === 'select' ? 'select' : 'text'),
          name: htmlEl.getAttribute('name') || '',
          groupLegend,
          label: labelText.replace(/[\s]+/g, ' ').trim(),
          required: htmlEl.required || htmlEl.getAttribute('aria-required') === 'true',
          currentValue: (htmlEl as HTMLInputElement).value || '',
          options: optionsList,
          disabled: htmlEl.disabled,
          visible: isVisible,
          checked: Boolean((htmlEl as HTMLInputElement).checked),
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
}
