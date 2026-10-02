import { createItemViaAPI, createWorkspaceViaAPI } from '../fixtures/api-helpers';
import { test, expect } from '../fixtures/errors';
import { generateWorkspace } from '../fixtures/test-data';
import type { Page } from '@playwright/test';

/**
 * WI-26 — dark-mode highlight color consistency.
 *
 * The reporter saw surfaces using different hover backgrounds in dark mode.
 * Exercise real interactive surfaces — navigation, the global create picker,
 * and a dashboard row — so this verifies what a user sees after switching
 * themes, rather than checking the token or DOM implementation directly.
 *
 * The surfaces share one test because they share server-side state (the
 * user's current workspace): a parallel test deleting its fixture workspace
 * 404s the create picker mid-flight.
 *
 * The shared token was later corrected: the dark theme had reused its
 * border colors (#a1bdd933/#a6c5e24d, 20–30% alpha) as neutral backgrounds,
 * making every hover read as a bright wash. The corrected token ladder is
 * #a1bdd914 resting / #a1bdd929 hovered (8%/16% alpha), mirroring the light
 * theme, so the expected highlight is rgba(161, 189, 217, ~0.16).
 */

const EXPECTED_DARK_HOVER = /rgba\(161,\s*189,\s*217,\s*0\.16/;
const DARK_SURFACE = 'rgb(29, 33, 37)';

async function switchToDarkMode(page: Page): Promise<void> {
  await page.getByTestId('user-avatar-trigger').click();
  await page.getByTestId('theme-menu').click();
  await page.getByTestId('theme-dark').click();
  await page.keyboard.press('Escape');
}

test.describe('WI-26: dark-mode highlight consistency', () => {
  test('dark-mode navigation, picker, and dashboard hovers use the same visible highlight', async ({
    page,
    request,
    allowConsoleError,
  }) => {
    // Optional services may 404 in the e2e build — irrelevant to this spec.
    allowConsoleError(/\/api\/logbook\//);
    allowConsoleError(/\/api\/attachment-settings\//);
    allowConsoleError(/Failed to load (buckets|all documents|attachment status)/);

    // The dashboard below shows its onboarding panel instead of the widget
    // grid until a workspace and an item both exist, and the create picker
    // needs a resolvable current workspace — one fixture serves both.
    const workspace = await createWorkspaceViaAPI(
      request,
      generateWorkspace(`wi26-hover-${Math.random().toString(36).slice(2, 8)}`)
    );
    try {
      await createItemViaAPI(request, workspace.id, { title: 'WI-26 hover probe' });

      await page.goto('/workspaces');

      await switchToDarkMode(page);

      const collectionsNav = page.locator('#nav-collections');
      await collectionsNav.hover();
      await expect(collectionsNav).toHaveCSS('background-color', EXPECTED_DARK_HOVER);

      await page.locator('#global-create-button').click();
      const typeChip = page.getByTestId('create-type-chip');
      await typeChip.click();
      const typeOption = page.getByTestId('create-type-chip-option').nth(1);
      await expect(typeOption).toBeVisible();
      await typeOption.hover();
      await expect(typeOption).toHaveCSS('background-color', EXPECTED_DARK_HOVER);
      await page.keyboard.press('Escape');

      await page.goto('/');
      await page.getByTestId('homepage').waitFor();
      const tile = page.getByTestId('dashboard-quick-access-tile').first();
      await expect(tile).toBeVisible();
      await expect(tile).toHaveCSS('background-color', DARK_SURFACE);

      await tile.hover();
      await expect(tile).toHaveCSS('background-color', EXPECTED_DARK_HOVER);
    } finally {
      const response = await request.delete(`/api/v2/workspaces/${workspace.id}`);
      expect(response.status()).toBe(204);
    }
  });
});
