import { test, type Locator, type Page } from '../fixtures/context-path';
import { mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Spec runs as ESM, so `__dirname` isn't defined — derive it from
// `import.meta.url` so the default screenshots root resolves correctly.
const HELPER_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Per-spec screenshot helper for documenting test flows.
 *
 * Any spec can call `await shot(page, '01-step-name')` to capture the current
 * page state. Screenshots are organised per spec under
 * `core-tests/e2e/screenshots/<spec-name>/<step-name>.png` so a reviewer can
 * read through one folder per test and see what each step looked like.
 *
 * Off by default — set `E2E_SCREENSHOTS=1` (or `E2E_PASSKEY_SCREENSHOTS=1`
 * for the legacy alias) to enable. Override the root with
 * `E2E_SCREENSHOTS_DIR=...` if you want them somewhere else.
 *
 * Before snapshotting, the helper waits for any open
 * `[role="dialog"][aria-modal="true"]` element to reach `opacity:1`. The
 * shared `ModalBackdrop` component fades for 150ms, which Playwright's
 * auto-wait considers "visible" mid-transition — without this guard,
 * screenshots that capture a modal can come out semi-transparent.
 */

const ENABLED =
  process.env.E2E_SCREENSHOTS === '1' || process.env.E2E_PASSKEY_SCREENSHOTS === '1';

const ROOT =
  process.env.E2E_SCREENSHOTS_DIR ||
  resolve(HELPER_DIR, '..', 'screenshots');

interface ShotOptions {
  /** Capture the full scrollable page rather than just the viewport. */
  fullPage?: boolean;
  /** Skip the modal-opacity wait (useful when timing is intentional). */
  skipDialogWait?: boolean;
  /** Override the per-spec subfolder. Defaults to the spec filename. */
  folder?: string;
  /** Capture this element (scrolled into view) instead of the page. */
  locator?: Locator;
}

/**
 * Wait for any in-progress CSS animations and transitions on the page to
 * finish. Useful before any kind of capture (instrumented or auto-reporter)
 * so the snap doesn't catch e.g. a tab-highlight transitioning between
 * tabs, a modal mid-fade, or a button colour interpolating on hover.
 *
 * No-op when screenshots are disabled — paying the wait cost in regular
 * CI runs would slow tests down without any visible benefit.
 */
export async function waitForAnimations(page: Page): Promise<void> {
  if (!ENABLED) return;
  await page
    .evaluate(
      () =>
        new Promise<void>((res) => {
          // Element.getAnimations() returns finite Animation objects for
          // any active CSS transition or animation. `.finished` resolves
          // when each settles; we swallow rejections (e.g. cancelled
          // transitions) so a single mid-flight cancellation doesn't
          // throw out of the whole await.
          const anims = (document.getAnimations?.() ?? []) as Animation[];
          if (anims.length === 0) {
            res();
            return;
          }
          Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => res());
        })
    )
    .catch(() => {});
}

/**
 * Capture a screenshot of `page` and write it under the per-spec folder.
 * No-op when E2E_SCREENSHOTS is unset, so leaving `shot()` calls in a spec
 * doesn't slow CI down.
 */
export async function shot(page: Page, name: string, opts: ShotOptions = {}): Promise<void> {
  if (!ENABLED) return;

  if (!opts.skipDialogWait) {
    await page
      .waitForFunction(
        () => {
          const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
          if (!dialog) return true;
          return getComputedStyle(dialog).opacity === '1';
        },
        undefined,
        { timeout: 2000 }
      )
      .catch(() => {});
  }

  // Settle CSS animations + transitions so e.g. tab-highlight transitions
  // don't get caught mid-interpolation. `animations: 'disabled'` below is
  // a Playwright-side belt-and-suspenders that pauses + resets running
  // animations while the screenshot is taken; the explicit wait above
  // covers the case where the test ends before Playwright snaps.
  await waitForAnimations(page);

  const info = test.info();
  const folder = opts.folder || specFolderName(info.file);
  const dir = join(ROOT, folder);
  mkdirSync(dir, { recursive: true });

  if (opts.locator) {
    await opts.locator.screenshot({
      path: join(dir, `${name}.png`),
      animations: 'disabled',
    });
    return;
  }

  await page.screenshot({
    path: join(dir, `${name}.png`),
    fullPage: opts.fullPage ?? false,
    animations: 'disabled',
  });
}

function specFolderName(file: string): string {
  return basename(file).replace(/\.spec\.(ts|js)$/, '');
}

/**
 * Resolved root directory where screenshots are written. Exposed so tests
 * (or higher-level reporting) can reference the path consistently.
 */
export const SCREENSHOT_ROOT = ROOT;

/**
 * Whether screenshot capture is currently enabled. Specs that want to
 * conditionally render an extra page (e.g. an email body) for screenshotting
 * can use this flag instead of re-parsing the env var themselves.
 */
export const SCREENSHOTS_ENABLED = ENABLED;

/**
 * Slugify a free-form title (e.g. test name) into a filename-safe stem.
 * Mirrors the slug used by the screenshot reporter so per-step shots and
 * end-of-test shots share a naming convention.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Convenience wrapper that names the screenshot after the current test plus
 * a step suffix — useful for capturing a meaningful in-progress state (e.g.
 * a filled-in form just before submit) alongside the auto end-of-test PNG.
 *
 * Example output for `test('should create a text field', …)`:
 *   should-create-a-text-field-form-filled.png   ← from this helper
 *   should-create-a-text-field.png               ← from the auto reporter
 */
export async function shotForCurrentTest(
  page: Page,
  step: string,
  opts: ShotOptions = {}
): Promise<void> {
  if (!ENABLED) return;
  const info = test.info();
  await shot(page, `${slugify(info.title)}-${step}`, opts);
}

// Re-export node 'path' helpers commonly needed alongside (saves another
// import in spec files that want to inspect the screenshot path).
export { dirname, basename, join, resolve };
