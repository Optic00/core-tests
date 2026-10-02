import { expect, test } from '../fixtures/context-path';
import { generateWorkspace } from '../fixtures/test-data';
import { WorkspacePage } from '../pages/workspace.page';

/**
 * Workspace sidebar collection selector.
 *
 * Locks down the dropdown geometry contract: the open collection menu is
 * full-size (same width as the select trigger) and opens below it with
 * bottom-start alignment, instead of shrinking to its content.
 */
test.describe('Workspace collection menu', () => {
  let workspaceId: string;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const workspacePage = new WorkspacePage(page);
    const data = generateWorkspace('collection-menu');
    const created = await workspacePage.createWorkspace(data);
    workspaceId = created.id;
    await context.close();
  });

  test('collection menu is full-width and opens below the select trigger', async ({ page }) => {
    await page.goto(`/workspaces/${workspaceId}`);

    const trigger = page.getByTestId('workspace-collection-select');
    await expect(trigger).toBeVisible();
    await trigger.click();

    const menu = page.getByTestId('workspace-collection-select-menu');
    await expect(menu).toBeVisible();

    const [triggerBox, menuBox] = await Promise.all([trigger.boundingBox(), menu.boundingBox()]);
    if (!triggerBox || !menuBox) {
      throw new Error('Collection trigger and menu must have measurable layout boxes');
    }

    // Full-size menu: exactly as wide as the selectbox above it.
    expect(Math.abs(menuBox.width - triggerBox.width)).toBeLessThanOrEqual(1);

    // The menu sits below the trigger, left-aligned with it (bottom-start).
    expect(menuBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height - 2);
    expect(Math.abs(menuBox.x - triggerBox.x)).toBeLessThanOrEqual(2);
  });
});
