import type {
  Reporter,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELPER_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Copies Playwright's auto-captured `screenshot: 'on'` PNGs into a flat,
 * per-spec layout under `e2e/screenshots/<spec>/<test>.png` so reviewers can
 * skim one folder per spec to see what every test rendered at end-of-test.
 *
 * Activated by setting E2E_SCREENSHOTS=1; otherwise becomes a no-op.
 *
 * Auto-attached PNGs land in the per-test output dir as `test-finished-N.png`
 * (or `test-failed-N.png` on failure). We copy whichever exists, picking the
 * most recent, into the organized location.
 */
export default class ScreenshotReporter implements Reporter {
  private readonly enabled: boolean;
  private readonly root: string;

  constructor() {
    this.enabled = process.env.E2E_SCREENSHOTS === '1';
    this.root =
      process.env.E2E_SCREENSHOTS_DIR ||
      resolve(HELPER_DIR, '..', 'screenshots');
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!this.enabled) return;

    const screenshots = result.attachments.filter(
      (a) => a.name === 'screenshot' && a.path
    );
    if (screenshots.length === 0) return;

    // Pick the last screenshot Playwright captured for this attempt.
    const last = screenshots[screenshots.length - 1];
    if (!last.path) return;

    const specName = basename(test.location.file).replace(/\.spec\.(ts|js)$/, '');
    const dir = join(this.root, specName);
    mkdirSync(dir, { recursive: true });

    const filename = `${slugify(test.title)}.png`;
    try {
      copyFileSync(last.path, join(dir, filename));
    } catch (err) {
      // Reporter must not throw — Playwright suppresses thrown errors but
      // logs them noisily. Swallow: a missing screenshot is non-fatal for
      // documentation.
      console.warn(`[screenshot-reporter] copy failed for ${specName}/${filename}:`, err);
    }
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
