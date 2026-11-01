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
import { FormScanner, FormSnapshot, BlockerDetectionResult, FormReadinessState } from './FormScanner';
import { PolicyEngine, SubmissionControl } from '../policy/PolicyEngine';
import { PageCensusRecord, FrameCensus } from '../shared/types';
import { matchOption } from '../agent/ToolRegistry';

/** Error raised when the operator cancels an in-flight browser operation. */
export class OperationCancelledError extends Error {
  constructor(message = 'WORKFLOW_STOPPED_BY_USER') {
    super(message);
    this.name = 'OperationCancelledError';
  }
}

export interface FailureEvidenceItem {
  frame: string;
  visible: boolean;
  boundingBox: { width: number; height: number };
  computed: { display: string; visibility: string; opacity: string };
  firstHidingAncestor: string | null;
  insideAriaHiddenOrHidden: boolean;
  visibleInputsInContainer: number;
}

export interface FailureEvidenceRecord {
  fieldRef: string;
  fieldLabel: string;
  matchingCount: number;
  matches: FailureEvidenceItem[];
  screenshotPath?: string;
}

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private scanner: FormScanner;
  private policyEngine: PolicyEngine;
  private pendingHighlight: Locator | null = null;
  private changeWaiters: Array<() => void> = [];
  private unblocked: boolean = false;
  private navStartTime: number = 0;
  private failureScreenshotSaved: boolean = false;
  private failureScreenshotPath: string | null = null;

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
  /**
   * Search for a bundled or user-provisioned browser binary.
   * Checks process.resourcesPath/browsers and userData/browsers.
   */
  private resolveBundledBrowserPath(): string | null {
    let resourcesBrowserDir: string | null = null;
    if (typeof process !== 'undefined' && 'resourcesPath' in process) {
      const resPath = (process as NodeJS.Process & { resourcesPath?: unknown }).resourcesPath;
      if (typeof resPath === 'string') {
        resourcesBrowserDir = path.join(resPath, 'browsers');
      }
    }
    const appDataBrowserDir =
      typeof process !== 'undefined' && process.env?.APPDATA
        ? path.join(process.env.APPDATA, 'autofiller-desktop', 'browsers')
        : null;

    const candidateDirs = [resourcesBrowserDir, appDataBrowserDir].filter(
      (dir): dir is string => Boolean(dir)
    );

    for (const dir of candidateDirs) {
      if (!fs.existsSync(dir)) continue;
      const findExe = (curDir: string, depth: number): string | null => {
        if (depth > 3) return null;
        try {
          const files = fs.readdirSync(curDir);
          for (const f of files) {
            const full = path.join(curDir, f);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
              const res = findExe(full, depth + 1);
              if (res) return res;
            } else if (f.toLowerCase() === 'chrome.exe' || f.toLowerCase() === 'msedge.exe') {
              return full;
            }
          }
        } catch {
          // Skip unreadable subdirectories
        }
        return null;
      };
      const found = findExe(dir, 0);
      if (found) return found;
    }
    return null;
  }

  public async launch(headless: boolean = false): Promise<void> {
    if (!this.browser) {
      const launchOptions = {
        headless,
        args: ['--disable-blink-features=AutomationControlled'],
      };

      const bundledExe = this.resolveBundledBrowserPath();
      let launched = false;

      // Tier 1 & 2: Bundled or provisioned standalone browser binary
      if (bundledExe && fs.existsSync(bundledExe)) {
        try {
          this.browser = await chromium.launch({
            ...launchOptions,
            executablePath: bundledExe,
          });
          launched = true;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[BrowserManager] Failed to launch bundled browser at ${bundledExe} (${msg}). Falling back to system browsers...`);
        }
      }

      // Tier 3: Standard Playwright local cache
      if (!launched) {
        try {
          this.browser = await chromium.launch(launchOptions);
          launched = true;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("Executable doesn't exist")) {
            throw err;
          }
        }
      }

      // Tier 4: System Microsoft Edge (Standard on Windows 10 & 11)
      if (!launched) {
        try {
          this.browser = await chromium.launch({ ...launchOptions, channel: 'msedge' });
          launched = true;
        } catch {}
      }

      // Tier 5: System Google Chrome
      if (!launched) {
        try {
          this.browser = await chromium.launch({ ...launchOptions, channel: 'chrome' });
          launched = true;
        } catch {}
      }

      // Tier 6: Actionable error if all tiers fail
      if (!this.browser) {
        throw new Error(
          'No compatible browser found. AutoFiller requires Chromium, Microsoft Edge, or Google Chrome. ' +
          'Please ensure Microsoft Edge or Google Chrome is installed on this Windows computer.'
        );
      }
      this.context = await this.browser.newContext({
        viewport: null,
        locale: 'en-IN',
      });

      // Expose binding so in-page MutationObserver and history listeners can notify main process
      await this.context.exposeBinding('__autofiller_dom_signal', () => {
        this.notifyChange('dom_mutation');
      });

      // Install MutationObserver and history/state listeners on every document in every frame
      await this.context.addInitScript(`
        (() => {
          if (window.__autofiller_signal_installed) return;
          window.__autofiller_signal_installed = true;

          let debounceTimer = null;
          const notify = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              try {
                if (typeof window.__autofiller_dom_signal === 'function') {
                  window.__autofiller_dom_signal();
                }
              } catch (e) {}
            }, 300);
          };

          // 1. MutationObserver
          try {
            const observer = new MutationObserver(() => {
              notify();
            });
            const target = document.documentElement || document;
            observer.observe(target, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true,
            });
          } catch (e) {}

          // 2. History listeners: pushState & replaceState
          try {
            const origPushState = history.pushState;
            history.pushState = function() {
              const res = origPushState.apply(this, arguments);
              notify();
              return res;
            };
            const origReplaceState = history.replaceState;
            history.replaceState = function() {
              const res = origReplaceState.apply(this, arguments);
              notify();
              return res;
            };
          } catch (e) {}

          // 3. popstate & hashchange
          try {
            window.addEventListener('popstate', notify, { passive: true });
            window.addEventListener('hashchange', notify, { passive: true });
          } catch (e) {}
        })();
      `);

      this.context.on('page', (newPage) => {
        this.attachPageListeners(newPage);
      });

      this.page = await this.context.newPage();
      this.attachPageListeners(this.page);
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
    this.navStartTime = Date.now();

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

  public hasOpenPage(): boolean {
    return this.page !== null && !this.page.isClosed();
  }

  public getScanner(): FormScanner {
    return this.scanner;
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
   * Evaluate pure DOM detectBlocker on the active browser page.
   *
   * @param waitMs Milliseconds to wait if currently seeing 'no-form' before concluding.
   * @returns BlockerDetectionResult.
   */
  public async detectBlocker(waitMs: number = 0): Promise<BlockerDetectionResult> {
    if (!this.page) {
      return { type: 'none', reason: 'Browser page is not open.' };
    }
    return await this.scanner.detectBlockerOnPage(this.page, waitMs);
  }

  /**
   * Save a full-page diagnostic screenshot to the given path.
   */
  public async saveScreenshot(targetPath: string): Promise<string> {
    if (!this.page) return '';
    try {
      const parentDir = path.dirname(targetPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      await this.page.screenshot({ path: targetPath, fullPage: true });
      return targetPath;
    } catch (err: any) {
      console.warn('Could not save diagnostic screenshot:', err?.message || err);
      return '';
    }
  }

  /**
   * Collect a complete page census across the main frame and all iframes (metadata only, no text values).
   */
  public async collectPageCensus(blockerResult?: BlockerDetectionResult): Promise<PageCensusRecord> {
    if (!this.page) {
      return {
        finalUrlHost: '',
        finalUrlPath: '',
        pageTitle: '',
        matchedBlockerRule: blockerResult?.matchedRule || null,
        triggerElementOrHost: blockerResult?.triggerElementOrHost || null,
        screenshotPath: null,
        frames: [],
      };
    }

    const pageUrl = this.page.url();
    let finalUrlHost = '';
    let finalUrlPath = '';
    try {
      const parsed = new URL(pageUrl);
      finalUrlHost = parsed.hostname;
      finalUrlPath = parsed.pathname;
    } catch {
      finalUrlHost = pageUrl;
    }
    const pageTitle = await this.page.title().catch(() => '');

    const frames = this.page.frames();
    const frameCensuses: FrameCensus[] = [];

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const isMain = frame === this.page.mainFrame();
      const fUrl = frame.url();
      let fHostAndPath = '';
      try {
        const pu = new URL(fUrl);
        fHostAndPath = `${pu.hostname}${pu.pathname}`;
      } catch {
        fHostAndPath = fUrl;
      }

      try {
        const counts = await frame.evaluate(() => {
          const isVisible = (el: Element): boolean => {
            const htmlEl = el as HTMLElement;
            if (!htmlEl) return false;
            if (htmlEl.hidden || htmlEl.getAttribute('aria-hidden') === 'true') return false;
            if (htmlEl.offsetParent === null && htmlEl.tagName.toLowerCase() !== 'body') {
              if (htmlEl.style.position !== 'fixed' && htmlEl.style.position !== 'sticky') {
                const rect = htmlEl.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) return false;
              }
            }
            const cs = window.getComputedStyle(htmlEl);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
            if (parseFloat(cs.opacity || '1') === 0) return false;
            return true;
          };

          const inputsByType: { visible: Record<string, number>; hidden: Record<string, number> } = {
            visible: {},
            hidden: {},
          };
          document.querySelectorAll('input').forEach((inp) => {
            const t = (inp.getAttribute('type') || 'text').toLowerCase().trim();
            const vis = isVisible(inp);
            const target = vis ? inputsByType.visible : inputsByType.hidden;
            target[t] = (target[t] || 0) + 1;
          });

          const countTagOrRole = (selector: string) => {
            let visible = 0;
            let hidden = 0;
            document.querySelectorAll(selector).forEach((el) => {
              if (isVisible(el)) visible++;
              else hidden++;
            });
            return { visible, hidden };
          };

          const textarea = countTagOrRole('textarea');
          const select = countTagOrRole('select');
          const roleRadio = countTagOrRole('[role="radio"]');
          const roleCheckbox = countTagOrRole('[role="checkbox"]');
          const roleListbox = countTagOrRole('[role="listbox"]');
          const roleCombobox = countTagOrRole('[role="combobox"]');
          const contenteditable = countTagOrRole('[contenteditable="true"], [contenteditable=""]');

          let hasShadowRoots = false;
          try {
            const all = document.querySelectorAll('*');
            for (let j = 0; j < all.length; j++) {
              if (all[j].shadowRoot) {
                hasShadowRoots = true;
                break;
              }
            }
          } catch {}

          return {
            inputsByType,
            textarea,
            select,
            roleRadio,
            roleCheckbox,
            roleListbox,
            roleCombobox,
            contenteditable,
            hasShadowRoots,
          };
        });

        frameCensuses.push({
          frameId: `frame_${i}${isMain ? '_main' : ''}`,
          url: fHostAndPath,
          name: frame.name() || undefined,
          isMainFrame: isMain,
          inputsByType: counts ? counts.inputsByType : { visible: {}, hidden: {} },
          textarea: counts ? counts.textarea : { visible: 0, hidden: 0 },
          select: counts ? counts.select : { visible: 0, hidden: 0 },
          roleRadio: counts ? counts.roleRadio : { visible: 0, hidden: 0 },
          roleCheckbox: counts ? counts.roleCheckbox : { visible: 0, hidden: 0 },
          roleListbox: counts ? counts.roleListbox : { visible: 0, hidden: 0 },
          roleCombobox: counts ? counts.roleCombobox : { visible: 0, hidden: 0 },
          contenteditable: counts ? counts.contenteditable : { visible: 0, hidden: 0 },
          hasShadowRoots: counts ? counts.hasShadowRoots : false,
        });
      } catch (err: any) {
        frameCensuses.push({
          frameId: `frame_${i}${isMain ? '_main' : ''}`,
          url: fHostAndPath,
          name: frame.name() || undefined,
          isMainFrame: isMain,
          inputsByType: { visible: {}, hidden: {} },
          textarea: { visible: 0, hidden: 0 },
          select: { visible: 0, hidden: 0 },
          roleRadio: { visible: 0, hidden: 0 },
          roleCheckbox: { visible: 0, hidden: 0 },
          roleListbox: { visible: 0, hidden: 0 },
          roleCombobox: { visible: 0, hidden: 0 },
          contenteditable: { visible: 0, hidden: 0 },
          hasShadowRoots: false,
        });
      }
    }

    return {
      finalUrlHost,
      finalUrlPath,
      pageTitle,
      matchedBlockerRule: blockerResult?.matchedRule || null,
      triggerElementOrHost: blockerResult?.triggerElementOrHost || null,
      screenshotPath: null,
      frames: frameCensuses,
    };
  }

  /**
   * Subscribe to Playwright page navigation and lifecycle events to merge into change signal.
   *
   * @param page Target Page instance.
   */
  private attachPageListeners(page: Page): void {
    page.on('framenavigated', () => this.notifyChange('framenavigated'));
    page.on('load', () => this.notifyChange('load'));
    page.on('domcontentloaded', () => this.notifyChange('domcontentloaded'));
  }

  /**
   * Notify any waiting listeners that a page or DOM change event occurred.
   *
   * @param reason Diagnostic reason for the change signal.
   */
  public notifyChange(reason?: string): void {
    const waiters = [...this.changeWaiters];
    this.changeWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }

  /**
   * Await the next merged page/DOM change signal or timeout.
   *
   * @param timeoutMs Maximum milliseconds to wait before resolving false.
   * @param signal Optional abort signal to cancel waiting.
   * @returns True if a change signal arrived, false if timeout elapsed.
   */
  public async waitForChange(timeoutMs?: number, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      throw new OperationCancelledError();
    }

    return new Promise<boolean>((resolve, reject) => {
      let timer: NodeJS.Timeout | null = null;
      let onAbort: (() => void) | null = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (signal && onAbort) {
          signal.removeEventListener('abort', onAbort);
        }
        const idx = this.changeWaiters.indexOf(onNotify);
        if (idx !== -1) {
          this.changeWaiters.splice(idx, 1);
        }
      };

      const onNotify = () => {
        cleanup();
        resolve(true);
      };

      if (signal) {
        onAbort = () => {
          cleanup();
          reject(new OperationCancelledError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      if (timeoutMs !== undefined && timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup();
          resolve(false);
        }, timeoutMs);
      }

      this.changeWaiters.push(onNotify);
    });
  }

  /**
   * Run one navigation-safe evaluation returning the page readiness state.
   *
   * @returns FormReadinessState with { blocker, fillableVisibleCount, fieldSignature }.
   * @throws Error if the browser or page is closed.
   */
  public async evaluateReadinessState(): Promise<FormReadinessState> {
    if (!this.page || this.page.isClosed()) {
      throw new Error('PAGE_NOT_AVAILABLE');
    }
    return await this.scanner.getReadinessStateOnPage(this.page);
  }

  /**
   * Event-driven readiness gate.
   *
   * Loops: awaits next signal (or explicit UI recheck, plus ~5s slow safety check if no signal arrived),
   * then runs navigation-safe evaluation returning { blocker, fillableVisibleCount, fieldSignature }.
   *
   * READY requirement:
   * - blocker.type === 'none'
   * - fillableVisibleCount >= 1
   * - Same fieldSignature on two consecutive checks at least ~250 ms apart (not DOM silence).
   *
   * Overall cap 15 minutes with a clean stop; Stop works at any time.
   *
   * @param signal AbortSignal to cancel waiting.
   * @returns FormReadinessState when page is ready.
   */
  /**
   * Signal from the user or agent that manual gate is completed,
   * unblocking waitUntilReady immediately.
   */
  public unblockReadiness(): void {
    this.unblocked = true;
    this.notifyChange('unblocked');
  }

  public async waitUntilReady(
    signal?: AbortSignal,
    requireExplicitUnblock: boolean = false
  ): Promise<FormReadinessState> {
    const TIMEOUT_MS = 15 * 60 * 1000;
    const startTime = Date.now();

    let candidateSignature: string | null = null;
    let candidateTimestamp = 0;
    let isFirstIteration = true;

    while (Date.now() - startTime < TIMEOUT_MS) {
      if (signal?.aborted) {
        throw new OperationCancelledError();
      }

      if (this.unblocked) {
        this.unblocked = false;
        try {
          return await this.evaluateReadinessState();
        } catch {
          return {
            blocker: { type: 'none', reason: 'Operator confirmed readiness' },
            fillableVisibleCount: 1,
            fieldSignature: 'unblocked',
          };
        }
      }

      if (!isFirstIteration) {
        // If we have a pending candidate signature, wait ~250ms (or next signal) to verify stability.
        // Otherwise, wait for the next signal or up to 5s safety check if no signal arrived.
        const waitMs =
          candidateSignature !== null
            ? Math.max(50, 260 - (Date.now() - candidateTimestamp))
            : 5000;

        await this.waitForChange(waitMs, signal);
      }
      isFirstIteration = false;

      if (signal?.aborted) {
        throw new OperationCancelledError();
      }

      if (this.unblocked) {
        this.unblocked = false;
        try {
          return await this.evaluateReadinessState();
        } catch {
          return {
            blocker: { type: 'none', reason: 'Operator confirmed readiness' },
            fillableVisibleCount: 1,
            fieldSignature: 'unblocked',
          };
        }
      }

      let state: FormReadinessState;
      try {
        state = await this.evaluateReadinessState();
      } catch (err: any) {
        // Navigation-safe: If evaluation throws because the context was destroyed
        // or the page navigated, do not throw: reset candidate and wait for next signal.
        const msg = err?.message || '';
        if (
          msg.includes('Execution context was destroyed') ||
          msg.includes('navigation') ||
          msg.includes('navigating') ||
          msg.includes('Target closed')
        ) {
          candidateSignature = null;
          candidateTimestamp = 0;
          continue;
        }
        throw err;
      }

      const now = Date.now();

      if (!requireExplicitUnblock && state.blocker.type === 'none' && state.fillableVisibleCount >= 1) {
        if (candidateSignature === state.fieldSignature) {
          if (now - candidateTimestamp >= 240) {
            // READY: no blocker, fillableVisibleCount >= 1, and the same fieldSignature
            // on two consecutive checks at least ~250 ms apart.
            return state;
          }
          // Same signature, but not yet ~250 ms apart; candidateTimestamp remains from first observation
        } else {
          // Different signature or first observation; record candidate
          candidateSignature = state.fieldSignature;
          candidateTimestamp = now;
        }
      } else if (!requireExplicitUnblock) {
        // Blocker present or no fillable fields yet; reset candidate
        candidateSignature = null;
        candidateTimestamp = 0;
      }
    }

    throw new Error('Timed out waiting for form to become ready (15 minute limit exceeded).');
  }

  /**
   * Bring the browser window to the front for user attention.
   */
  public async bringToFront(): Promise<void> {
    if (this.page) {
      await this.page.bringToFront().catch(() => {});
    }
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
    const label = (this.scanner.getLabel(fieldRef) || '').toLowerCase();
    return (
      name.includes('dob') ||
      name.includes('birth') ||
      name.includes('date') ||
      selector.includes('dob') ||
      selector.includes('birth') ||
      selector.includes('date') ||
      label.includes('dob') ||
      label.includes('birth') ||
      label.includes('date')
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
   * Helper to retrieve electron userData or filesystem equivalent directory.
   */
  private getUserDataDir(): string {
    try {
      const { app } = require('electron');
      if (app && typeof app.getPath === 'function') {
        return app.getPath('userData');
      }
    } catch {}
    const base = process.env.APPDATA || process.env.HOME || process.cwd();
    const dir = path.join(base, '.autofiller-userData');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Capture failure evidence metadata (strictly no values) across matching elements in all frames.
   * Also saves screenshot at the first failure to the Electron userData folder.
   */
  public async captureFailureEvidence(
    fieldRef: string,
    fieldLabel: string
  ): Promise<FailureEvidenceRecord> {
    const evidence: FailureEvidenceRecord = {
      fieldRef,
      fieldLabel,
      matchingCount: 0,
      matches: [],
    };

    if (!this.page) return evidence;

    const frames = this.page.frames();
    for (const frame of frames) {
      try {
        const frameMatches = await frame.evaluate((ref: string) => {
          let elements = Array.from(document.querySelectorAll(`[data-af-ref="${ref}"]`));
          if (elements.length === 0) {
            elements = Array.from(
              document.querySelectorAll(`input[name="${ref}"], textarea[name="${ref}"], select[name="${ref}"]`)
            );
          }

          return elements.map((el) => {
            const htmlEl = el as HTMLElement;
            const cs = window.getComputedStyle(htmlEl);
            const rect = htmlEl.getBoundingClientRect();

            let firstHidingAncestor: string | null = null;
            let insideAriaHiddenOrHidden = false;

            let parent = htmlEl.parentElement;
            while (parent && parent !== document.body && parent !== document.documentElement) {
              if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || parent.hasAttribute('hidden')) {
                insideAriaHiddenOrHidden = true;
              }
              const ps = window.getComputedStyle(parent);
              if (
                !firstHidingAncestor &&
                (ps.display === 'none' ||
                  ps.visibility === 'hidden' ||
                  ps.visibility === 'collapse' ||
                  parseFloat(ps.opacity || '1') === 0)
              ) {
                const tag = parent.tagName.toLowerCase();
                const idStr = parent.id ? `#${parent.id}` : '';
                const classStr =
                  parent.className && typeof parent.className === 'string'
                    ? `.${parent.className.trim().split(/\s+/).join('.')}`
                    : '';
                firstHidingAncestor = `${tag}${idStr}${classStr} (style.${ps.display === 'none' ? 'display=none' : ps.visibility === 'hidden' ? 'visibility=hidden' : 'opacity=0'})`;
              }
              if (!firstHidingAncestor && (parent.hidden || parent.hasAttribute('hidden'))) {
                firstHidingAncestor = `${parent.tagName.toLowerCase()} ([hidden])`;
              }
              parent = parent.parentElement;
            }

            let visibleInputsInContainer = 0;
            const container =
              htmlEl.closest('[role="listitem"], .question-block, .geS5n, fieldset, form') ||
              htmlEl.parentElement;
            if (container) {
              const inputs = Array.from(container.querySelectorAll('input:not([type="hidden"]), select, textarea'));
              for (const inp of inputs) {
                const ics = window.getComputedStyle(inp as HTMLElement);
                const irect = inp.getBoundingClientRect();
                if (
                  ics.display !== 'none' &&
                  ics.visibility !== 'hidden' &&
                  parseFloat(ics.opacity || '1') > 0 &&
                  irect.width > 0 &&
                  irect.height > 0
                ) {
                  visibleInputsInContainer++;
                }
              }
            }

            const isVis =
              cs.display !== 'none' &&
              cs.visibility !== 'hidden' &&
              parseFloat(cs.opacity || '1') > 0 &&
              rect.width > 0 &&
              rect.height > 0 &&
              !firstHidingAncestor;

            return {
              visible: isVis,
              boundingBox: { width: Math.round(rect.width), height: Math.round(rect.height) },
              computed: {
                display: cs.display || 'inline',
                visibility: cs.visibility || 'visible',
                opacity: cs.opacity || '1',
              },
              firstHidingAncestor,
              insideAriaHiddenOrHidden,
              visibleInputsInContainer,
            };
          });
        }, fieldRef);

        const fName = frame.name() || (frame === this.page.mainFrame() ? 'main' : frame.url());
        for (const fm of frameMatches) {
          evidence.matches.push({
            ...fm,
            frame: fName,
          });
        }
      } catch {}
    }

    evidence.matchingCount = evidence.matches.length;

    // Save screenshot at the first failure to the Electron userData folder (overwritten each run)
    if (!this.failureScreenshotSaved) {
      try {
        const userDataDir = this.getUserDataDir();
        const screenshotPath = path.join(userDataDir, 'failure_evidence.png');
        await this.page.screenshot({ path: screenshotPath });
        this.failureScreenshotSaved = true;
        this.failureScreenshotPath = screenshotPath;
        evidence.screenshotPath = screenshotPath;
        console.log(`Saved failure evidence screenshot to: ${screenshotPath}`);
      } catch (err: any) {
        console.warn('Could not save failure evidence screenshot:', err?.message || err);
      }
    } else if (this.failureScreenshotPath) {
      evidence.screenshotPath = this.failureScreenshotPath;
    }

    // Print failure evidence lines
    console.log(`[Failure Evidence] Field '${fieldLabel}' (${fieldRef}): ${evidence.matchingCount} match(es)`);
    evidence.matches.forEach((m, idx) => {
      const hiding = m.firstHidingAncestor ? `, hidden by ${m.firstHidingAncestor}` : '';
      const ariaHide = m.insideAriaHiddenOrHidden ? ', inside aria-hidden/hidden' : '';
      console.log(
        `  Match ${idx + 1} (${m.frame}): visible=${m.visible}, size=${m.boundingBox.width}x${m.boundingBox.height}, display=${m.computed.display}, visibility=${m.computed.visibility}, opacity=${m.computed.opacity}${hiding}${ariaHide}, visibleInputsInContainer=${m.visibleInputsInContainer}`
      );
    });

    return evidence;
  }

  /**
   * Re-resolve a field candidate by label inside the same question container, preferring the visible candidate.
   */
  private async reResolveVisibleCandidate(fieldRef: string): Promise<boolean> {
    if (!this.page) return false;
    const label = this.scanner.getLabel(fieldRef) || '';
    const frames = this.page.frames();

    for (const frame of frames) {
      try {
        const found = await frame.evaluate(
          ({ ref, targetLabel }: { ref: string; targetLabel: string }) => {
            const isVisible = (el: Element): boolean => {
              const htmlEl = el as HTMLElement;
              if (!htmlEl) return false;
              if (htmlEl.hidden || htmlEl.getAttribute('aria-hidden') === 'true') return false;
              const cs = window.getComputedStyle(htmlEl);
              if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
              if (parseFloat(cs.opacity || '1') === 0) return false;
              const r = htmlEl.getBoundingClientRect();
              if (r.width === 0 && r.height === 0) return false;
              if (htmlEl.offsetParent === null && htmlEl.tagName.toLowerCase() !== 'body') return false;
              return true;
            };

            // 1. Locate existing element tagged with data-af-ref
            let existing = document.querySelector(`[data-af-ref="${ref}"]`);
            let container: Element | null = null;
            if (existing) {
              container = existing.closest('[role="listitem"], .question-block, .geS5n, fieldset');
            }

            // 2. If no container yet, find container by label text
            if (!container && targetLabel) {
              const normTarget = targetLabel.toLowerCase().trim().replace(/[\s*:]+/g, ' ');
              const headings = Array.from(
                document.querySelectorAll('[role="heading"], label, .q-label, legend, h1, h2, h3, h4, h5, h6')
              );
              for (const h of headings) {
                const hText = (h.textContent || '').toLowerCase().trim().replace(/[\s*:]+/g, ' ');
                if (hText && (hText.includes(normTarget) || normTarget.includes(hText))) {
                  container = h.closest('[role="listitem"], .question-block, .geS5n, fieldset') || h.parentElement;
                  if (container) break;
                }
              }
            }

            if (!container) return false;

            // 3. Find candidates inside container and prefer the VISIBLE candidate
            const candidates = Array.from(
              container.querySelectorAll(
                'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="password"]), select, textarea'
              )
            );

            const visibleCandidate = candidates.find((c) => isVisible(c));
            if (visibleCandidate) {
              visibleCandidate.setAttribute('data-af-ref', ref);
              return true;
            }

            return false;
          },
          { ref: fieldRef, targetLabel: label }
        );

        if (found) {
          this.scanner.setLocator(fieldRef, frame.locator(`[data-af-ref="${fieldRef}"]`).first());
          return true;
        }
      } catch {}
    }
    return false;
  }

  /**
   * Click the visible question container or label to focus it.
   */
  private async focusQuestionContainerOrLabel(
    fieldRef: string,
    label: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<boolean> {
    if (!this.page) return false;
    const frame = this.scanner.getFrame(fieldRef) || this.page.mainFrame();

    try {
      const containerLoc = frame
        .locator(`[data-af-ref="${fieldRef}"]`)
        .locator('xpath=ancestor::*[@role="listitem" or contains(@class,"question-block") or contains(@class,"geS5n") or self::label][1]');

      if ((await containerLoc.count()) > 0) {
        await this.withCancellation(signal, containerLoc.first().click({ timeout: timeoutMs }));
        const targetInput = frame.locator(`[data-af-ref="${fieldRef}"]`).first();
        if ((await targetInput.count()) > 0) {
          await this.withCancellation(signal, targetInput.focus().catch(() => {}));
          return true;
        }
      }
    } catch {}

    if (label) {
      try {
        const cleanLabel = label.replace(/[*:]+/g, '').trim();
        const labelLoc = frame.locator(`text="${cleanLabel}"`).first();
        if ((await labelLoc.count()) > 0) {
          await this.withCancellation(signal, labelLoc.click({ timeout: timeoutMs }));
          const container = labelLoc.locator('xpath=ancestor::*[@role="listitem" or contains(@class,"question-block") or contains(@class,"geS5n") or self::label][1]');
          const inputInContainer = container.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea').first();
          if ((await inputInContainer.count()) > 0) {
            await this.withCancellation(signal, inputInContainer.focus().catch(() => {}));
            return true;
          }
        }
      } catch {}
    }

    return false;
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
   * Populate a text, email, number, date, or textarea field using the 4-step Fill Ladder.
   *
   * Budget: about 10 s per field that does not shrink across attempts.
   * Step a: Scroll into view and fill.
   * Step b: If not visible / detached / multiple matches: re-scan, re-resolve by label inside container, prefer VISIBLE candidate, retry.
   * Step c: Click visible container or label to focus it, then type with keyboard.
   * Step d: Native value setter + input/change/blur events, only if control or its label is visible.
   * Reads state back (match / mismatch / empty) after each attempt.
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
    if (!this.page) {
      throw new Error('Browser is not initialized or page is not open.');
    }

    let locator = this.scanner.getLocator(fieldRef);
    if (!locator) {
      throw new Error(`Field reference '${fieldRef}' not found in active FormSnapshot.`);
    }

    const inputType = ((await locator.getAttribute('type').catch(() => '')) || '').toLowerCase();
    const autocomplete = ((await locator.getAttribute('autocomplete').catch(() => '')) || '').toLowerCase();
    const inputName = ((await locator.getAttribute('name').catch(() => '')) || '').toLowerCase();
    const inputId = ((await locator.getAttribute('id').catch(() => '')) || '').toLowerCase();
    const resolvedName = (this.scanner.getName(fieldRef) || '').toLowerCase();

    // Safety guard: NEVER fill input[type=password], one-time-code, or CAPTCHA fields
    const isPassword = inputType === 'password';
    const isOtp =
      autocomplete === 'one-time-code' ||
      /\b(otp|one[\s_-]*time|verification[\s_-]*code|security[\s_-]*code|auth[\s_-]*code)\b/i.test(inputName) ||
      /\b(otp|one[\s_-]*time|verification[\s_-]*code|security[\s_-]*code|auth[\s_-]*code)\b/i.test(inputId) ||
      /\b(otp|one[\s_-]*time|verification[\s_-]*code|security[\s_-]*code|auth[\s_-]*code)\b/i.test(resolvedName);
    const isCaptcha =
      inputName.includes('recaptcha') ||
      inputId.includes('recaptcha') ||
      inputName.includes('turnstile') ||
      inputId.includes('turnstile') ||
      inputName.includes('hcaptcha') ||
      inputId.includes('hcaptcha');

    if (isPassword || isOtp || isCaptcha) {
      const reason = isPassword ? 'password' : isOtp ? 'OTP' : 'CAPTCHA';
      throw new Error(`[SafetyGuard] Refusing to fill protected ${reason} field '${fieldRef}'.`);
    }

    let expectedValue = value;
    if (inputType === 'date') {
      expectedValue = this.normalizeDateValue(value);
    } else if (this.isDateField(fieldRef)) {
      expectedValue = this.formatToStrictDDMMYYYY(value);
    }

    const fieldBudgetMs = 10000;
    const deadline = Date.now() + fieldBudgetMs;
    const typingDelay = process.env.NODE_ENV === 'test' ? 0 : 25;

    const readStateBack = async () => {
      return await this.verifyField(fieldRef, expectedValue);
    };

    // Ladder Attempt a: Scroll into view and fill
    try {
      const stepTimeout = Math.min(2500, Math.max(1000, deadline - Date.now()));
      await this.highlightField(locator);
      await this.withCancellation(signal, locator.scrollIntoViewIfNeeded({ timeout: stepTimeout }));
      if (inputType === 'date') {
        await this.withCancellation(signal, locator.fill(expectedValue, { timeout: stepTimeout }));
      } else {
        await this.withCancellation(signal, locator.fill('', { timeout: stepTimeout }));
        await this.withCancellation(
          signal,
          locator.pressSequentially(expectedValue, { delay: typingDelay })
        );
      }
      const stA = await readStateBack();
      if (stA.verified) {
        await this.clearHighlight();
        return { success: true, actualValue: stA.actualValue, expectedValue };
      }
    } catch (errA: any) {
      if (errA?.name === 'OperationCancelledError') throw errA;
    }

    // Ladder Attempt b: if reports not visible / detached / multiple matches / empty:
    // Non-destructively re-resolve by label inside the same question container, prefer VISIBLE candidate, retry
    try {
      const reResolved = await this.reResolveVisibleCandidate(fieldRef);
      if (reResolved) {
        locator = this.scanner.getLocator(fieldRef) || locator;
        const stepTimeout = Math.min(2500, Math.max(1000, deadline - Date.now()));
        await this.highlightField(locator);
        await this.withCancellation(signal, locator.scrollIntoViewIfNeeded({ timeout: stepTimeout }));
        if (inputType === 'date') {
          await this.withCancellation(signal, locator.fill(expectedValue, { timeout: stepTimeout }));
        } else {
          await this.withCancellation(signal, locator.fill('', { timeout: stepTimeout }));
          await this.withCancellation(
            signal,
            locator.pressSequentially(expectedValue, { delay: typingDelay })
          );
        }
        const stB = await readStateBack();
        if (stB.verified) {
          await this.clearHighlight();
          return { success: true, actualValue: stB.actualValue, expectedValue };
        }
      }
    } catch (errB: any) {
      if (errB?.name === 'OperationCancelledError') throw errB;
    }

    // Ladder Attempt c: Click the visible container or label to focus it, then type
    try {
      const stepTimeout = Math.min(2000, Math.max(800, deadline - Date.now()));
      const labelText = this.scanner.getLabel(fieldRef) || '';
      const focused = await this.focusQuestionContainerOrLabel(fieldRef, labelText, stepTimeout, signal);
      if (focused) {
        await this.withCancellation(
          signal,
          this.page.keyboard.type(expectedValue, { delay: typingDelay })
        );
        const stC = await readStateBack();
        if (stC.verified) {
          await this.clearHighlight();
          return { success: true, actualValue: stC.actualValue, expectedValue };
        }
      }
    } catch (errC: any) {
      if (errC?.name === 'OperationCancelledError') throw errC;
    }

    // Ladder Attempt d: Native value setter + input/change/blur events, only if the control or its label is visible
    try {
      const frame = this.scanner.getFrame(fieldRef) || this.page.mainFrame();
      const nativeOk = await frame.evaluate(
        ({ ref, val }: { ref: string; val: string }) => {
          const el = document.querySelector(`[data-af-ref="${ref}"]`) as HTMLElement;
          if (!el) return false;

          const rect = el.getBoundingClientRect();
          const cs = window.getComputedStyle(el);
          const isDirectlyVis =
            cs.display !== 'none' &&
            cs.visibility !== 'hidden' &&
            parseFloat(cs.opacity || '1') > 0 &&
            rect.width > 0 &&
            rect.height > 0 &&
            el.offsetParent !== null;

          let isLabelVis = false;
          const enclosing = el.closest('label');
          const id = el.id;
          const forLabel = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
          const lbl = (forLabel || enclosing) as HTMLElement | null;
          if (lbl) {
            const lcs = window.getComputedStyle(lbl);
            const lrect = lbl.getBoundingClientRect();
            isLabelVis =
              lcs.display !== 'none' &&
              lcs.visibility !== 'hidden' &&
              parseFloat(lcs.opacity || '1') > 0 &&
              lrect.width > 0 &&
              lrect.height > 0;
          }

          if (!isDirectlyVis && !isLabelVis) return false;

          const proto =
            el instanceof HTMLTextAreaElement
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(el, val);
          } else {
            (el as any).value = val;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          return true;
        },
        { ref: fieldRef, val: expectedValue }
      );

      if (nativeOk) {
        const stD = await readStateBack();
        if (stD.verified) {
          await this.clearHighlight();
          return { success: true, actualValue: stD.actualValue, expectedValue };
        }
      }
    } catch (errD: any) {
      if (errD?.name === 'OperationCancelledError') throw errD;
    }

    await this.clearHighlight();
    const finalState = await readStateBack();

    // After all ladder attempts failed: capture failure evidence
    if (!finalState.verified) {
      const label = this.scanner.getLabel(fieldRef) || fieldRef;
      await this.captureFailureEvidence(fieldRef, label);
    }

    return {
      success: finalState.verified,
      actualValue: finalState.actualValue,
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
    await this.withCancellation(signal, locator.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {}));

    const tagName = ((await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => '')) || '');

    // ARIA Custom Dropdown / Listbox / Combobox
    if (tagName !== 'select') {
      try {
        // 1. Click the trigger to open popup
        await this.withCancellation(signal, locator.click({ timeout: 2500 }));

        // 2. Condition wait for [role="option"] elements (no arbitrary sleeps)
        try {
          await this.page.waitForFunction(
            () => {
              const opts = document.querySelectorAll('[role="option"]');
              for (let i = 0; i < opts.length; i++) {
                const el = opts[i] as HTMLElement;
                if (el.offsetParent !== null && window.getComputedStyle(el).display !== 'none') {
                  return true;
                }
              }
              return false;
            },
            undefined,
            { timeout: 3000 }
          );
        } catch {}

        // 3. Collect option elements
        let optionLoc = this.page.locator('[role="option"]:visible');
        let optCount = await optionLoc.count();
        if (optCount === 0) {
          optionLoc = this.page.locator('[role="option"]');
          optCount = await optionLoc.count();
        }

        const optionCandidates: Array<{ loc: Locator; label: string }> = [];
        for (let i = 0; i < optCount; i++) {
          const optEl = optionLoc.nth(i);
          const txt = (await optEl.textContent() || '').trim();
          const val = (await optEl.getAttribute('data-value') || '').trim();
          const ariaLbl = (await optEl.getAttribute('aria-label') || '').trim();
          const candidateLabel = txt || val || ariaLbl;
          if (candidateLabel) {
            optionCandidates.push({ loc: optEl, label: candidateLabel });
          }
        }

        if (optionCandidates.length === 0) {
          await this.clearHighlight();
          return {
            success: false,
            selectedOption: '',
            expectedOption: option,
            reason: `No options found for dropdown trigger '${fieldRef}'.`,
          };
        }

        // 4. Match with OptionMatcher
        const matchRes = matchOption(option, optionCandidates.map((c) => c.label));
        const targetLabel = matchRes.matchedOption || option;
        const matchedItem =
          optionCandidates.find((c) => c.label.toLowerCase() === targetLabel.toLowerCase()) ||
          optionCandidates[0];

        // 4b. If combobox with text input, type then pick
        const inputChild = locator.locator('input').first();
        if ((await inputChild.count()) > 0) {
          try {
            await inputChild.fill(matchedItem.label);
          } catch {}
        }

        // 5. Click the option
        await this.withCancellation(signal, matchedItem.loc.click({ timeout: 2500 }));

        // 6. Confirm popup closes (condition wait)
        try {
          await this.page.waitForFunction(
            () => {
              const opts = document.querySelectorAll('[role="option"]');
              for (let i = 0; i < opts.length; i++) {
                const el = opts[i] as HTMLElement;
                if (el.offsetParent !== null && window.getComputedStyle(el).display !== 'none') {
                  return false;
                }
              }
              return true;
            },
            undefined,
            { timeout: 2500 }
          );
        } catch {}

        // 7. Read back selected text or aria-selected
        let selectedText = '';
        const selectedOpt = this.page.locator('[role="option"][aria-selected="true"]').first();
        if ((await selectedOpt.count()) > 0) {
          selectedText = (await selectedOpt.textContent() || '').trim();
        }
        if (!selectedText) {
          selectedText = (await locator.textContent() || '').trim();
        }

        await this.clearHighlight();

        const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
        const normSelected = normalize(selectedText);
        const normExpected = normalize(option);
        const isMatched =
          normSelected === normExpected ||
          normSelected.includes(normExpected) ||
          normExpected.includes(normSelected) ||
          matchOption(selectedText, [option]).confidence >= 0.8;

        return {
          success: isMatched,
          selectedOption: selectedText || matchedItem.label,
          expectedOption: option,
        };
      } catch (err: any) {
        await this.clearHighlight();
        return {
          success: false,
          selectedOption: '',
          expectedOption: option,
          reason: err?.message || 'Failed to select ARIA dropdown option',
        };
      }
    }

    // Native select element
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
    const { locator, name } = this.resolveField(fieldRef);
    if (!this.page) {
      throw new Error('Browser is not initialized or page is not open.');
    }

    const isAriaRadiogroup = await locator.evaluate(
      (el) => el.getAttribute('role') === 'radiogroup' || Boolean(el.querySelector('[role="radio"]'))
    ).catch(() => false);

    if (isAriaRadiogroup) {
      const radioChildren = locator.locator('[role="radio"]');
      const count = await radioChildren.count();
      let targetChild: Locator | null = null;
      let chosenValue = '';

      for (let index = 0; index < count; index += 1) {
        const candidate = radioChildren.nth(index);
        const candidateValue = (await candidate.getAttribute('data-value')) || '';
        const candidateAria = (await candidate.getAttribute('aria-label')) || '';
        const candidateText = (await candidate.textContent()) || '';
        const normOpt = optionValue.trim().toLowerCase();
        if (
          candidateValue.trim().toLowerCase() === normOpt ||
          candidateAria.trim().toLowerCase() === normOpt ||
          candidateText.trim().toLowerCase() === normOpt
        ) {
          targetChild = candidate;
          chosenValue = candidateValue || candidateAria || candidateText.trim();
          break;
        }
      }

      if (!targetChild && count > 0) {
        const candidates: Array<{ loc: Locator; label: string }> = [];
        for (let i = 0; i < count; i++) {
          const child = radioChildren.nth(i);
          const dataVal = (await child.getAttribute('data-value') || '').trim();
          const ariaLbl = (await child.getAttribute('aria-label') || '').trim();
          const text = (await child.textContent() || '').trim();
          candidates.push({ loc: child, label: text || dataVal || ariaLbl });
        }
        const matchRes = matchOption(optionValue, candidates.map((c) => c.label));
        if (matchRes.matchedOption) {
          const matched = candidates.find((c) => c.label === matchRes.matchedOption);
          if (matched) {
            targetChild = matched.loc;
            chosenValue = matched.label;
          }
        }
      }

      if (!targetChild) {
        throw new Error(
          `Radio option '${optionValue}' not found in group for field '${fieldRef}'.`
        );
      }

      await this.highlightField(targetChild);
      await this.withCancellation(signal, targetChild.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {}));

      await this.withCancellation(signal, targetChild.click({ timeout: 2500 }));
      let checked = (await targetChild.getAttribute('aria-checked')) === 'true';

      if (!checked) {
        await this.withCancellation(signal, targetChild.click({ timeout: 1500, force: true }).catch(() => {}));
        checked = (await targetChild.getAttribute('aria-checked')) === 'true';
      }

      await this.clearHighlight();
      return { success: checked, selectedValue: chosenValue };
    }

    const frame = this.scanner.getFrame(fieldRef) || this.page.mainFrame();
    let group = frame.locator(`[data-af-ref="${fieldRef}"]`);
    let groupSize = await group.count();
    if (groupSize === 0) {
      const fallbackSelector = name
        ? `input[type="radio"][name="${this.escapeAttribute(name)}"]`
        : 'input[type="radio"]';
      group = this.page.locator(fallbackSelector);
      groupSize = await group.count();
    }
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
    let checked = false;
    try {
      await this.withCancellation(signal, target.check({ timeout: 2500 }));
      checked = await target.isChecked();
    } catch {
      checked = false;
    }

    if (!checked) {
      try {
        await this.withCancellation(signal, target.check({ timeout: 1500, force: true }));
        checked = await target.isChecked();
      } catch {
        const id = await target.getAttribute('id').catch(() => null);
        if (id && this.page) {
          const forLabel = this.page.locator(`label[for="${CSS.escape(id)}"]`).first();
          if ((await forLabel.count()) > 0) {
            await this.withCancellation(signal, forLabel.click({ timeout: 1500 }).catch(() => {}));
          }
        }
        checked = await target.isChecked();
      }
    }

    const isChecked = checked;
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

    const roleAttr = ((await locator.getAttribute('role').catch(() => '')) || '').toLowerCase();
    const isAriaCheckbox = roleAttr === 'checkbox' || roleAttr === 'switch';

    if (isAriaCheckbox) {
      await this.highlightField(locator);
      await this.withCancellation(signal, locator.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {}));

      let curAria = (await locator.getAttribute('aria-checked')) === 'true';
      if (curAria !== checked) {
        await this.withCancellation(signal, locator.click({ timeout: 2500 }));
        curAria = (await locator.getAttribute('aria-checked')) === 'true';
      }

      if (curAria !== checked) {
        await this.withCancellation(signal, locator.click({ force: true, timeout: 1500 }).catch(() => {}));
        curAria = (await locator.getAttribute('aria-checked')) === 'true';
      }

      await this.clearHighlight();
      return { success: curAria === checked, isChecked: curAria, expectedChecked: checked };
    }

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

  public getTimeSinceNav(): number {
    return this.navStartTime ? Date.now() - this.navStartTime : 0;
  }

  public getFrameCount(): number {
    return this.page ? this.page.frames().length : 1;
  }

  /**
   * Read back an actual field value from the active DOM and independently verify it.
   *
   * @param fieldRef Target field identifier.
   * @param expectedValue Value the field is expected to contain.
   * @returns Whether the read-back value matches the expected value and classification.
   */
  public async verifyField(
    fieldRef: string,
    expectedValue: string
  ): Promise<{
    verified: boolean;
    actualValue: string;
    expectedValue: string;
    classification: 'match' | 'normalized-match' | 'mismatch' | 'empty' | 'unreadable';
  }> {
    let locator = this.scanner.getLocator(fieldRef);
    if (!locator && this.page) {
      const candidate = this.page.locator(`[data-af-ref="${fieldRef}"]`).first();
      if ((await candidate.count().catch(() => 0)) > 0) {
        this.scanner.setLocator(fieldRef, candidate);
        locator = candidate;
      } else {
        for (const frame of this.page.frames()) {
          const frameCandidate = frame.locator(`[data-af-ref="${fieldRef}"]`).first();
          if ((await frameCandidate.count().catch(() => 0)) > 0) {
            this.scanner.setLocator(fieldRef, frameCandidate);
            locator = frameCandidate;
            break;
          }
        }
      }
    }
    if (!locator) {
      throw new Error(`Field reference '${fieldRef}' not found.`);
    }

    const inputType = ((await locator.getAttribute('type').catch(() => '')) || '').toLowerCase();
    const roleAttr = ((await locator.getAttribute('role').catch(() => '')) || '').toLowerCase();

    // Checkbox read-back verification: evaluate checked state against affirmative/negative tokens
    if (inputType === 'checkbox' || roleAttr === 'checkbox' || roleAttr === 'switch') {
      let isChecked = false;
      if (roleAttr === 'checkbox' || roleAttr === 'switch') {
        isChecked = (await locator.getAttribute('aria-checked').catch(() => '')) === 'true';
      } else {
        isChecked = await locator.isChecked().catch(() => false);
      }
      const affirmative = new Set(['true', 'yes', 'y', '1', 'on', 'checked', 'agree', 'accepted']);
      const negative = new Set(['false', 'no', 'n', '0', 'off', 'unchecked', 'declined']);
      const normalizedExpected = expectedValue.trim().toLowerCase();

      const expectedBool = affirmative.has(normalizedExpected)
        ? true
        : negative.has(normalizedExpected)
          ? false
          : Boolean(expectedValue.trim());

      const verified = isChecked === expectedBool;
      let classification: 'match' | 'normalized-match' | 'mismatch' | 'empty' | 'unreadable' = 'mismatch';
      if (verified) {
        classification = 'match';
      } else if (!isChecked && expectedBool) {
        classification = 'empty';
      } else {
        classification = 'mismatch';
      }
      return {
        verified,
        actualValue: isChecked ? 'checked' : 'unchecked',
        expectedValue,
        classification,
      };
    }

    // Radio group read-back verification: find which radio in the group is checked
    if (inputType === 'radio' || roleAttr === 'radiogroup' || roleAttr === 'radio') {
      let checkedValue = '';
      if (roleAttr === 'radiogroup' || (await locator.locator('[role="radio"]').count().catch(() => 0)) > 0) {
        const checkedChild = locator.locator('[role="radio"][aria-checked="true"]').first();
        if ((await checkedChild.count().catch(() => 0)) > 0) {
          checkedValue = (
            (await checkedChild.getAttribute('data-value').catch(() => '')) ||
            (await checkedChild.getAttribute('aria-label').catch(() => '')) ||
            (await checkedChild.textContent().catch(() => '')) ||
            ''
          ).trim();
        }
      } else {
        const { name } = this.resolveField(fieldRef);
        const groupSelector = name
          ? `input[type="radio"][name="${this.escapeAttribute(name)}"]`
          : 'input[type="radio"]';
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
      }
      const normalize = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, ' ');
      const isStrict = checkedValue === expectedValue;
      const verified =
        isStrict ||
        normalize(checkedValue) === normalize(expectedValue) ||
        matchOption(checkedValue, [expectedValue]).confidence >= 0.8;
      let classification: 'match' | 'normalized-match' | 'mismatch' | 'empty' | 'unreadable' = 'mismatch';
      if (isStrict) {
        classification = 'match';
      } else if (verified) {
        classification = 'normalized-match';
      } else if (!checkedValue) {
        classification = 'empty';
      } else {
        classification = 'mismatch';
      }
      return { verified, actualValue: checkedValue, expectedValue, classification };
    }

    // Select / dropdown element read-back verification: verify against selected option value or visible text
    const tagName = ((await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => '')) || '');
    if (tagName === 'select' || roleAttr === 'listbox' || roleAttr === 'combobox') {
      let selectedVal = '';
      let selectedLabel = '';
      if (tagName === 'select') {
        selectedVal = (await locator.inputValue().catch(() => '')) || '';
        selectedLabel = await locator
          .evaluate((el) => {
            const select = el as HTMLSelectElement;
            return select.options[select.selectedIndex]?.textContent?.trim() || '';
          })
          .catch(() => '');
      } else {
        if (this.page) {
          const selectedOpt = this.page.locator('[role="option"][aria-selected="true"]').first();
          if ((await selectedOpt.count().catch(() => 0)) > 0) {
            selectedLabel = ((await selectedOpt.textContent().catch(() => '')) || '').trim();
          }
        }
        if (!selectedLabel) {
          selectedLabel = ((await locator.textContent().catch(() => '')) || '').trim();
        }
        selectedVal = selectedLabel;
      }
      const normalize = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, ' ');
      const normExpected = normalize(expectedValue);
      const isStrict = selectedVal === expectedValue || selectedLabel === expectedValue;
      const verified =
        isStrict ||
        normalize(selectedVal) === normExpected ||
        normalize(selectedLabel) === normExpected ||
        normalize(selectedVal).includes(normExpected) ||
        normExpected.includes(normalize(selectedVal)) ||
        normalize(selectedLabel).includes(normExpected) ||
        normExpected.includes(normalize(selectedLabel)) ||
        matchOption(selectedLabel || selectedVal, [expectedValue]).confidence >= 0.8;
      let classification: 'match' | 'normalized-match' | 'mismatch' | 'empty' | 'unreadable' = 'mismatch';
      if (isStrict) {
        classification = 'match';
      } else if (verified) {
        classification = 'normalized-match';
      } else if (!selectedVal && !selectedLabel) {
        classification = 'empty';
      } else {
        classification = 'mismatch';
      }
      return { verified, actualValue: selectedLabel || selectedVal, expectedValue, classification };
    }

    const actualValue = (await locator.inputValue().catch(() => '')) || '';
    const normalize = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, ' ');

    const isStrict = actualValue === expectedValue;
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

    let classification: 'match' | 'normalized-match' | 'mismatch' | 'empty' | 'unreadable' = 'mismatch';
    if (isStrict) {
      classification = 'match';
    } else if (verified) {
      classification = 'normalized-match';
    } else if (!actualValue || actualValue.trim() === '') {
      classification = 'empty';
    } else {
      classification = 'mismatch';
    }

    return { verified, actualValue, expectedValue, classification };
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
          /submission confirmed/i,
          /thank you for your submission/i,
          /thank you for submitting/i,
          /your response has been recorded/i,
          /your application has been received/i,
          /application received successfully/i,
          /registration successful/i,
          /registration confirmed/i,
          /admission confirmed/i,
          /payment successful/i,
          /submission complete/i,
          /successfully submitted/i,
        ];
        for (const pattern of confirmationPatterns) {
          if (pattern.test(bodyText)) {
            return true;
          }
        }

        // 4. Check URL pathname, search, and hash for redirect confirmation
        const path = (window.location.pathname || '').toLowerCase();
        const search = (window.location.search || '').toLowerCase();
        const hash = (window.location.hash || '').toLowerCase();
        if (
          path.includes('/submitted') ||
          path.includes('/thank-you') ||
          path.includes('/thankyou') ||
          path.includes('/confirmation') ||
          path.includes('/success') ||
          path.includes('/complete') ||
          search.includes('submitted=') ||
          search.includes('status=success') ||
          search.includes('status=completed') ||
          hash.includes('success') ||
          hash.includes('submitted')
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
    this.notifyChange('browser_close');
    this.scanner.reset();
    if (this.browser) {
      await this.browser.close().catch(() => { });
      this.browser = null;
      this.context = null;
      this.page = null;
      this.pendingHighlight = null;
    }
  }
}

