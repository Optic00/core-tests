import { authenticateAdminRequest } from '../fixtures/api-helpers';
import { expect, test } from '../fixtures/context-path';
import { createPortalChannel } from '../helpers/portal-setup';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

test.describe('Portal editing layout', () => {
  test('keeps the customize panel below the editing bar', async ({ page, request }) => {
    await authenticateAdminRequest(request);

    const stamp = Date.now();
    const channel = await createPortalChannel(request, {
      slug: `e2e-editing-layout-${stamp}`,
      name: `Editing Layout ${stamp}`,
    });

    await page.goto(`${BASE_URL}/portal/${channel.slug}`);
    await expect(page.getByTestId('portal-page')).toHaveAttribute('data-ready', 'true');

    await page.getByTestId('portal-settings-button').click();
    await page.getByTestId('portal-customize-button').click();
    const panel = page.getByTestId('portal-customize-panel');
    const editingBar = page.getByTestId('portal-editing-bar');
    await expect(panel).toBeVisible();
    await expect(editingBar).toBeVisible();
    await expect(panel).toHaveCSS('top', '40px');

    const barBox = await editingBar.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(barBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.y).toBeGreaterThanOrEqual(barBox!.y + barBox!.height);
  });
});
