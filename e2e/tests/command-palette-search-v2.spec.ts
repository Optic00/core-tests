import type { APIRequestContext } from '@playwright/test';
import { createItemViaAPI, createUserViaAPI, createWorkspaceViaAPI } from '../fixtures/api-helpers';
import { expect, test } from '../fixtures/context-path';
import { generateUser, generateWorkspace } from '../fixtures/test-data';

const SEC_FETCH = { 'Sec-Fetch-Site': 'same-origin' };
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

async function roleId(request: APIRequestContext, name: string): Promise<number> {
  const response = await request.get('/api/workspace-roles', {
    headers: SEC_FETCH,
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  const role = (body.data ?? body).find((candidate: { name: string }) => candidate.name === name);
  expect(role).toBeDefined();
  return role.id;
}

async function assignRole(
  request: APIRequestContext,
  userId: number,
  workspaceId: number,
  workspaceRoleId: number
) {
  const response = await request.post('/api/workspace-roles/assign', {
    headers: SEC_FETCH,
    data: {
      user_id: userId,
      workspace_id: workspaceId,
      role_id: workspaceRoleId,
    },
  });
  expect(response.ok()).toBeTruthy();
}

test('command palette searches through v2 and hides inaccessible items', async ({
  request,
  browser,
}) => {
  const stamp = `rc-search-${Date.now()}`;
  const token = `RC_SEARCH_${Date.now()}`;
  const visibleWorkspace = await createWorkspaceViaAPI(
    request,
    generateWorkspace(`${stamp}-visible`)
  );
  const hiddenWorkspace = await createWorkspaceViaAPI(
    request,
    generateWorkspace(`${stamp}-hidden`)
  );

  const viewerRoleId = await roleId(request, 'Viewer');
  const editorRoleId = await roleId(request, 'Editor');
  const visibleGate = await createUserViaAPI(request, generateUser(`${stamp}-visible-gate`));
  const hiddenGate = await createUserViaAPI(request, generateUser(`${stamp}-hidden-gate`));
  await assignRole(request, visibleGate.id, visibleWorkspace.id, viewerRoleId);
  await assignRole(request, hiddenGate.id, hiddenWorkspace.id, viewerRoleId);

  const outsiderData = generateUser(`${stamp}-outsider`);
  const outsider = await createUserViaAPI(request, outsiderData);
  await assignRole(request, outsider.id, visibleWorkspace.id, editorRoleId);

  const visibleItem = await createItemViaAPI(request, visibleWorkspace.id, {
    title: `${token} visible`,
  });
  const hiddenItem = await createItemViaAPI(request, hiddenWorkspace.id, {
    title: `${token} restricted`,
  });

  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const login = await context.request.post('/api/auth/login', {
      headers: SEC_FETCH,
      data: {
        email_or_username: outsiderData.username,
        password: outsiderData.password_hash,
        remember_me: false,
      },
    });
    expect(login.ok()).toBeTruthy();

    const page = await context.newPage();
    await page.goto('/');
    await page.locator('#global-search-button').click();
    const input = page.getByTestId('command-palette-input');
    await expect(input).toBeVisible();
    const search = async (query: string) => {
      const completed = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/api/v2/items/search') && url.searchParams.get('q') === query;
      });
      await input.fill(query);
      await completed;
    };
    const visibleRow = page.getByTestId(`command-palette-option-goto-item-${visibleItem.id}`);
    const hiddenRow = page.getByTestId(`command-palette-option-goto-item-${hiddenItem.id}`);
    await search(token);
    await expect(visibleRow).toContainText(visibleItem.title);
    await expect(hiddenRow).toHaveCount(0);
    await search(`${hiddenWorkspace.key}-${hiddenItem.workspace_item_number}`);
    await expect(visibleRow).toHaveCount(0);
    await expect(hiddenRow).toHaveCount(0);
    await search(`${visibleWorkspace.key}-${visibleItem.workspace_item_number}`);
    await expect(visibleRow).toContainText(visibleItem.title);
    await visibleRow.click();
    await expect(page).toHaveURL(new RegExp(`/items/${visibleItem.id}(?:$|[?#])`));
    await expect(page.getByTestId('item-title-edit')).toContainText(visibleItem.title);
  } finally {
    await context.close();
    for (const workspace of [visibleWorkspace, hiddenWorkspace]) {
      const response = await request.delete(`/api/v2/workspaces/${workspace.id}`, {
        headers: SEC_FETCH,
      });
      expect(response.status()).toBe(204);
    }
    for (const user of [visibleGate, hiddenGate, outsider]) {
      const response = await request.delete(`/api/users/${user.id}`, {
        headers: SEC_FETCH,
      });
      expect(response.status()).toBe(204);
    }
  }
});
