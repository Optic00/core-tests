import { randomUUID } from 'node:crypto';
import {
  createCustomerOrgViaAPI,
  createItemViaAPI,
  createTimeProjectViaAPI,
  createWorkspaceViaAPI,
} from '../fixtures/api-helpers';
import { expect, test } from '../fixtures/context-path';

test('worklog picker searches items created after its initial list was loaded', async ({
  page,
  request,
}, testInfo) => {
  const suffix = `${testInfo.workerIndex}${Date.now()}`;
  const cleanupPaths: string[] = [];
  const headers = { 'Sec-Fetch-Site': 'same-origin' };
  try {
    const customerResult = await createCustomerOrgViaAPI(request, {
      name: `Search customer ${suffix}`,
      active: true,
    });
    const customer = customerResult.data || customerResult;
    cleanupPaths.unshift(`/api/customer-organisations/${customer.id}`);
    const projectResult = await createTimeProjectViaAPI(request, {
      name: `Search project ${suffix}`,
      customer_id: customer.id,
    });
    const project = projectResult.data || projectResult;
    cleanupPaths.unshift(`/api/v2/time/projects/${project.id}`);
    const workspace = await createWorkspaceViaAPI(request, {
      name: `Search workspace ${suffix}`,
      key: `TWL${randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`,
      description: 'Worklog search coverage',
    });
    cleanupPaths.unshift(`/api/v2/workspaces/${workspace.id}`);

    const initialItems = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/api/v2/items') && url.searchParams.get('page_size') === '100';
    });
    await page.goto('/time');
    await initialItems;
    await page.getByTestId('time-log-open').click();
    const dialog = page.getByTestId('time-log-modal');
    await expect(dialog).toBeVisible();
    await dialog.locator('#time-log-project').click();
    await dialog.locator('#time-log-project').fill(project.name);
    await page.getByTestId(`time-log-project-option-${project.id}`).click();

    // This item cannot be present in the modal's initial list.
    const item = await createItemViaAPI(request, workspace.id, {
      title: `Search result ${suffix}`,
    });
    const key = `${workspace.key}-${item.workspace_item_number}`;
    const picker = dialog.locator('#time-log-work-item');
    await picker.click();
    await picker.fill(key);
    const result = page.getByTestId(`time-log-work-item-option-${item.id}`);
    await expect(result).toContainText(item.title);
    await result.click();
    await expect(picker).toHaveValue(item.title);
    await expect(dialog.locator('#time-log-description')).toHaveValue(item.title);
    await dialog.locator('#time-log-duration').fill('30m');
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes('/time/worklogs') && response.request().method() === 'POST'
    );
    await dialog.getByTestId('dialog-confirm').click();
    const body = await (await saved).json();
    cleanupPaths.unshift(`/api/v2/time/worklogs/${(body.data || body).id}`);
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByRole('table').filter({ hasText: item.title })).toContainText(key);
  } finally {
    for (const path of cleanupPaths) {
      const response = await request.delete(path, { headers });
      expect(response.ok(), `cleanup ${path}: ${response.status()}`).toBeTruthy();
    }
  }
});
