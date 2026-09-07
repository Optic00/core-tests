import {
  createItemViaAPI,
  createWorkspaceViaAPI,
  listItemTypesViaAPI,
} from '../fixtures/api-helpers';
import { expect, test } from '../fixtures/errors';

test.describe('item deletion feedback', () => {
  test('shows informational feedback and allows another board card to open', async ({
    page,
    request,
    allowConsoleError,
  }, testInfo) => {
    allowConsoleError(/\/api\/logbook\//);
    allowConsoleError(/\/api\/items\/\d+\/recurrence/);

    const stamp = `${Date.now()}${testInfo.workerIndex}${testInfo.repeatEachIndex}`;
    const workspace = await createWorkspaceViaAPI(request, {
      name: `delete-feedback-${stamp}`,
      key: `DF${stamp.slice(-6)}`.toUpperCase(),
      description: 'item deletion feedback e2e',
    });
    const deletedItem = await createItemViaAPI(request, workspace.id, {
      title: `Delete me ${stamp}`,
    });
    const remainingItem = await createItemViaAPI(request, workspace.id, {
      title: `Open me next ${stamp}`,
    });

    await page.goto(`/workspaces/${workspace.id}/board`);
    await page.getByTestId(`board-item-${deletedItem.id}`).click();
    await expect(page.getByTestId('item-detail-ready')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('item-detail-actions-menu').click();
    await page.getByTestId('item-delete-open').click();
    const deleteDialog = page.getByTestId('delete-item-dialog');
    await expect(deleteDialog).toBeVisible();
    await page.locator('#item-delete-confirm').click();
    await expect(deleteDialog).toBeHidden({ timeout: 10_000 });

    const deletionToast = page.getByTestId('toast');
    await expect(deletionToast).toHaveCount(1);
    await expect(deletionToast).toContainText('This item was deleted.');
    await expect.soft(deletionToast).toHaveAttribute('data-toast-variant', 'info');

    await page.getByTestId('workspace-nav-board').click();
    await expect(page.getByTestId('board-view')).toBeVisible();
    await page.getByTestId(`board-item-${remainingItem.id}`).click();
    await expect(page.getByTestId('item-detail-ready')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('item-title-edit')).toHaveText(remainingItem.title);
    await expect(deletionToast).toHaveCount(1);
  });

  test('loads the new parent after reparent-and-delete without live events', async ({
    page,
    request,
  }) => {
    // Exercise the supported polling fallback so HTTP completion owns navigation.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'EventSource', { value: undefined, configurable: true });
    });
    const stamp = Date.now().toString(36);
    const workspace = await createWorkspaceViaAPI(request, {
      name: `Reparent ${stamp}`,
      key: `RP${stamp.slice(-6)}`.toUpperCase(),
    });
    const types = await listItemTypesViaAPI(request);
    const levels = [
      ...new Set<number>(types.map((type: { hierarchy_level: number }) => type.hierarchy_level)),
    ]
      .filter((level) => level >= 0)
      .sort((a, b) => a - b);
    expect(levels.length).toBeGreaterThanOrEqual(2);
    const typeAt = (level: number) =>
      types.find((type: { hierarchy_level: number }) => type.hierarchy_level === level).id;
    const parent = await createItemViaAPI(request, workspace.id, {
      title: `Parent ${stamp}`,
      item_type_id: typeAt(levels[0]),
    });
    const deleted = await createItemViaAPI(request, workspace.id, {
      title: `Delete ${stamp}`,
      parent_id: parent.id,
      item_type_id: typeAt(levels[1]),
    });
    const child = await createItemViaAPI(request, workspace.id, {
      title: `Child ${stamp}`,
      parent_id: deleted.id,
      // Generic sub-tasks can move between these regular parent levels.
      item_type_id: typeAt(-1),
    });
    await page.goto(`/workspaces/${workspace.id}/items/${deleted.id}`);
    await expect(page.getByTestId('item-title-edit')).toHaveText(deleted.title);
    await page.getByTestId('item-detail-actions-menu').click();
    await page.getByTestId('item-delete-open').click();
    await page.getByTestId('item-delete-reparent').check();
    const reparented = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/v2/items/${deleted.id}/reparent-children`
    );
    await page.locator('#item-delete-confirm').click();
    const reparentResponse = await reparented;
    expect(reparentResponse.request().method()).toBe('POST');
    expect(reparentResponse.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/items/${parent.id}$`));
    await expect(page.getByTestId('item-title-edit')).toHaveText(parent.title);
    const response = await request.get(`/api/v2/items/${child.id}`);
    expect(response.status()).toBe(200);
    expect((await response.json()).data.parent_id).toBe(parent.id);
    await expect(page.getByTestId('toast')).toHaveCount(1);
    await expect(page.getByTestId('toast')).toHaveAttribute('data-toast-variant', 'info');
  });
});
