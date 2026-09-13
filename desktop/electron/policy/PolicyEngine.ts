/**
 * PolicyEngine enforcing security boundaries and execution guardrails for AutoFiller AI.
 *
 * In accordance with IMPORTANT.md:
 * - The LLM is NEVER the security boundary.
 * - Autonomous form submission is strictly blocked (DENIED_FINAL_SUBMISSION).
 * - Only approved form automation tools may execute.
 *
 * This module is the single gate every tool invocation and every browser action passes
 * through. Nothing in the agent loop may bypass it.
 */

export interface PolicyCheckResult {
  allowed: boolean;
  code?: string;
  reason?: string;
}

/** Approval tier used to classify how dangerous a tool invocation is. */
export type PolicyPermission = 'READ_ONLY' | 'MUTATING' | 'FORBIDDEN';

/** Structural facts about a submission-capable control discovered on the page. */
export interface SubmissionControl {
  label: string;
  selector: string;
  isSubmitType: boolean;
  type?: string;
}

export class PolicyEngine {
  private allowedTools: Map<string, PolicyPermission>;
  private forbiddenButtonTerms: RegExp;
  private allowedPaginationTerms: RegExp;

  constructor() {
    // Explicit permission tier per tool. Anything absent is refused outright.
    this.allowedTools = new Map<string, PolicyPermission>([
      ['inspect_document', 'READ_ONLY'],
      ['extract_document_facts', 'READ_ONLY'],
      ['inspect_form', 'READ_ONLY'],
      ['inspect_current_form_state', 'READ_ONLY'],
      ['verify_field', 'READ_ONLY'],
      ['scroll_to_field', 'READ_ONLY'],
      ['fill_text', 'MUTATING'],
      ['select_option', 'MUTATING'],
      ['select_radio', 'MUTATING'],
      ['set_checkbox', 'MUTATING'],
      ['request_clarification', 'READ_ONLY'],
    ]);

    this.forbiddenButtonTerms =
      /^(submit|submit\s+application|submit\s+form|submit\s+registration|submit\s+now|register|apply\s+now|complete\s+submission|send\s+application|finish|confirm\s+submission)$/i;

    this.allowedPaginationTerms =
      /^(next|next\s+step|continue|save\s*&\s*continue|proceed|go\s+to\s+step\s+\d+|step\s+\d+)$/i;
  }

  /**
   * Validate whether a requested tool invocation is authorized under current policy.
   *
   * @param toolName Name of the tool the agent wants to run.
   * @param args Arguments associated with the invocation.
   * @returns Policy decision indicating whether execution may proceed.
   */
  public validateToolInvocation(toolName: string, args: Record<string, any> = {}): PolicyCheckResult {
    const permission = this.allowedTools.get(toolName);

    if (!permission) {
      return {
        allowed: false,
        code: 'TOOL_NOT_PERMITTED',
        reason: `Tool '${toolName}' is not registered or permitted in AutoFiller execution policy.`,
      };
    }

    if (permission === 'FORBIDDEN') {
      return {
        allowed: false,
        code: 'TOOL_FORBIDDEN',
        reason: `Tool '${toolName}' is explicitly forbidden by AutoFiller execution policy.`,
      };
    }

    // Mutating tools must always target a validated field reference.
    if (permission === 'MUTATING') {
      const fieldRef = args.fieldRef;
      if (typeof fieldRef !== 'string' || !/^field_\d{3}$/.test(fieldRef)) {
        return {
          allowed: false,
          code: 'INVALID_FIELD_REFERENCE',
          reason: `Mutating tool '${toolName}' requires a validated field reference.`,
        };
      }
    }

    return { allowed: true, code: 'TOOL_ALLOWED' };
  }

  /**
   * Report the permission tier for a tool, or undefined when unregistered.
   *
   * @param toolName Name of the tool.
   * @returns Permission tier when registered.
   */
  public getToolPermission(toolName: string): PolicyPermission | undefined {
    return this.allowedTools.get(toolName);
  }

  /**
   * Check whether a button label is an allowed pagination step transition.
   *
   * @param targetText Button label or accessible text.
   * @returns True when the control is an allowed wizard navigation step.
   */
  public isPaginationButton(targetText: string): boolean {
    const clean = targetText.trim().toLowerCase();
    return this.allowedPaginationTerms.test(clean) && !this.isFinalSubmissionButton(clean);
  }

  /**
   * Check whether a button label is a protected final submission action.
   *
   * @param targetText Button label or accessible text.
   * @returns True when the control appears to finalize a submission.
   */
  public isFinalSubmissionButton(targetText: string): boolean {
    const clean = targetText.trim().toLowerCase();
    return this.forbiddenButtonTerms.test(clean) || clean.includes('submit');
  }

  /**
   * Validate whether a target browser action is permitted.
   *
   * Autonomous clicks on final submission controls are strictly forbidden. In
   * addition to label matching, structural submit controls are always denied.
   *
   * @param actionType Browser action being attempted, such as 'click'.
   * @param targetLabelOrText Label or text of the target control.
   * @param isSubmitType Whether the target is a structural submission control.
   * @returns Policy decision for the attempted action.
   */
  public validateBrowserAction(
    actionType: string,
    targetLabelOrText?: string,
    isSubmitType: boolean = false
  ): PolicyCheckResult {
    if (actionType === 'click') {
      if (isSubmitType) {
        return {
          allowed: false,
          code: 'DENIED_FINAL_SUBMISSION',
          reason:
            'Autonomous form submission is strictly prohibited. Final submission must be reviewed and executed by the human operator.',
        };
      }

      if (targetLabelOrText) {
        if (this.isPaginationButton(targetLabelOrText)) {
          return { allowed: true, code: 'ALLOWED_PAGINATION' };
        }

        if (this.isFinalSubmissionButton(targetLabelOrText)) {
          return {
            allowed: false,
            code: 'DENIED_FINAL_SUBMISSION',
            reason:
              'Autonomous form submission is strictly prohibited. Final submission must be reviewed and executed by the human operator.',
          };
        }
      }
    }

    return { allowed: true, code: 'ACTION_ALLOWED' };
  }

  /**
   * Inspect a discovered set of page controls and identify submission-capable ones.
   *
   * This derives the submission-guard decision from the real page instead of a
   * hardcoded string, so the audit trail reflects actual page state.
   *
   * @param controls Submission-candidate controls discovered during scanning.
   * @returns Policy decision describing whether a blocked submission control exists.
   */
  public evaluateSubmissionControls(controls: SubmissionControl[]): PolicyCheckResult & {
    controls: SubmissionControl[];
  } {
    const blocked = controls.filter((control) => {
      // type="button" and type="reset" are not treated as final submission controls
      const type = (control.type || '').toLowerCase().trim();
      if (type === 'button' || type === 'reset') {
        return false;
      }
      return control.isSubmitType || this.isFinalSubmissionButton(control.label);
    });

    if (blocked.length > 0) {
      return {
        allowed: false,
        code: 'DENIED_FINAL_SUBMISSION',
        reason: `Detected ${blocked.length} submission control(s) on the page. Autonomous submission remains prohibited.`,
        controls: blocked,
      };
    }

    return {
      allowed: true,
      code: 'NO_SUBMISSION_CONTROL',
      reason: 'No submission-capable control was detected on the page.',
      controls: [],
    };
  }

  /**
   * Validate whether navigation to a given URL is permitted.
   *
   * @param currentHost Host of the currently loaded page.
   * @param targetUrl URL the agent wants to navigate to.
   * @returns Policy decision for the navigation attempt.
   */
  public validateNavigation(currentHost: string, targetUrl: string): PolicyCheckResult {
    try {
      const targetHost = new URL(targetUrl).host;
      if (
        currentHost &&
        targetHost &&
        currentHost !== targetHost &&
        !targetUrl.startsWith('file://')
      ) {
        return {
          allowed: false,
          code: 'EXTERNAL_NAVIGATION_DENIED',
          reason: `Navigation to external host '${targetHost}' is not allowed outside the target form domain.`,
        };
      }
    } catch {
      // Allow file:// or local paths.
    }
    return { allowed: true, code: 'NAVIGATION_ALLOWED' };
  }
}
