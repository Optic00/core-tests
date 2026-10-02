import { randomUUID } from 'node:crypto';
import {
  createCollectionViaAPI,
  createItemViaAPI,
  createWorkspaceViaAPI,
} from '../fixtures/api-helpers';
import { expect, test } from '../fixtures/errors';

test('collection total stays consistent across views, pagination and collapsed roadmap rows', async ({
  page,
  request,
}, testInfo) => {
  const stamp = randomUUID().slice(0, 8);
  const workspace = await createWorkspaceViaAPI(request, {
    name: `Counts ${stamp}`,
    key: `CC${stamp}`.toUpperCase(),
  });
  let collection: Awaited<ReturnType<typeof createCollectionViaAPI>> | undefined;
  const headers = { 'Sec-Fetch-Site': 'same-origin' };
  try {
    const parent = await createItemViaAPI(request, workspace.id, { title: `Parent ${stamp}` });
    const child = await createItemViaAPI(request, workspace.id, {
      title: `Child ${stamp}`,
      parent_id: parent.id,
    });
    for (let i = 0; i < 50; i++) {
      await createItemViaAPI(request, workspace.id, { title: `Count ${stamp} ${i}` });
    }
    collection = await createCollectionViaAPI(request, {
      name: `Counts ${stamp}`,
      ql_query: `workspace = "${workspace.key}"`,
    });
    const configuration = await request.put(
      `/api/v2/collections/${collection.id}/board-configuration`,
      {
        headers,
        data: {
          columns: [],
          backlog_status_ids: [],
          list_columns: [],
          card_fields: [],
          show_rightmost_column_last_50: false,
        },
      }
    );
    expect(configuration.ok(), await configuration.text()).toBeTruthy();
    const subtitle = page.getByTestId('page-header-subtitle');
    const sidebar = page.getByTestId('collection-sidebar-count');
    await page.goto(`/collections/${collection.id}/backlog`);
    await expect(subtitle).toContainText('52 items');
    await expect(sidebar).toHaveText('Collection · 52 items');

    for (const view of ['board', 'list', 'tree', 'map', 'roadmap']) {
      await page.getByTestId(`collection-nav-${view}`).click();
      await expect(page).toHaveURL(new RegExp(`/collections/${collection.id}/${view}$`));
      await expect(subtitle).toContainText('52 items');
      await expect(sidebar).toHaveText('Collection · 52 items');
      if (view === 'list') {
        await expect(subtitle).toHaveText('52 items · 50 shown');
        await page.getByTestId('pagination-next').click();
        await expect(subtitle).toHaveText('52 items · 2 shown');
        await expect(page.getByTestId(/^workspace-item-row-/)).toHaveCount(2);
      }
    }
    await expect(page.getByTestId(`roadmap-item-${child.id}`)).toBeVisible();
    await expect(subtitle).toHaveText('52 items');
    await page.getByTestId(`roadmap-toggle-${parent.id}`).click();
    await expect(page.getByTestId(`roadmap-item-${child.id}`)).toHaveCount(0);
    await expect(subtitle).toHaveText('52 items · 51 shown');
    await page.screenshot({ path: testInfo.outputPath('contextual-counts.png') });
    await expect(sidebar).toHaveText('Collection · 52 items');
  } finally {
    if (collection) {
      const response = await request.delete(`/api/v2/collections/${collection.id}`, { headers });
      expect(response.ok(), await response.text()).toBeTruthy();
    }
    const response = await request.delete(`/api/v2/workspaces/${workspace.id}`, { headers });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
});
