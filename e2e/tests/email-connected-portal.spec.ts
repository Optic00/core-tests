import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '../fixtures/context-path';
import { createWorkspaceViaAPI, createUserViaAPI, listItemTypesViaAPI } from '../fixtures/api-helpers';
import { generateUser, generateWorkspace } from '../fixtures/test-data';
import { createPortalChannel, type PortalChannelHandle } from '../helpers/portal-setup';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const SEC_FETCH = { 'Sec-Fetch-Site': 'same-origin' };

interface EmailChannelHandle {
  channelId: number;
  name: string;
  workspaceId: number;
}

async function createUnconnectedEmailChannel(
  admin: APIRequestContext,
  suffix: string
): Promise<EmailChannelHandle> {
  const ws = await createWorkspaceViaAPI(admin, generateWorkspace(`email-portal-${suffix}`));
  const itemTypes = await listItemTypesViaAPI(admin);
  expect(itemTypes.length, 'global item-type catalog must not be empty').toBeTruthy();

  const create = await admin.post('/api/channels', {
    headers: SEC_FETCH,
    data: {
      name: `Support Mailbox ${suffix}`,
      type: 'email',
      direction: 'inbound',
      status: 'disabled',
    },
  });
  expect(create.ok(), `create email channel: ${create.status()} ${await create.text()}`).toBeTruthy();
  const channel = await create.json();

  // A complete basic-auth config so the settings form passes client-side
  // validation when it opens. The channel stays disabled; full email
  // validation only runs at enable time.
  const config = await admin.put(`/api/channels/${channel.id}/config`, {
    headers: SEC_FETCH,
    data: {
      config: {
        email_auth_method: 'basic',
        imap_host: `imap-${suffix}.example.com`,
        imap_port: 993,
        imap_encryption: 'ssl',
        imap_username: `support-${suffix}@example.com`,
        email_workspace_id: ws.id,
        email_item_type_id: itemTypes[0].id,
        email_mailbox: 'INBOX',
        email_mark_as_read: true,
        email_delete_after_process: false,
      },
    },
  });
  expect(config.ok(), `configure email channel: ${config.status()} ${await config.text()}`).toBeTruthy();

  return { channelId: channel.id, name: channel.name, workspaceId: ws.id };
}

async function openEmailChannelSettings(page: Page, channelId: number): Promise<void> {
  // The modal loads the portal-option list on open; wait for it so the
  // dropdown is populated before the test interacts with it.
  const portalsLoaded = page.waitForResponse(
    (resp) => resp.url().includes('/channels') && resp.url().includes('type=portal')
  );
  await page.goto('/admin/channels');
  await expect(page.getByTestId(`admin-channel-row-${channelId}`)).toBeVisible();
  await page.getByTestId(`admin-channel-row-${channelId}`).click();
  await portalsLoaded;
  await expect(page.locator('#email-connected-portal')).toBeVisible();
}

async function openPortalDropdown(page: Page): Promise<void> {
  const trigger = page.locator('#email-connected-portal');
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const listbox = page.getByTestId('email-connected-portal-listbox');
  await expect(listbox).toBeVisible();
  await expect(listbox).toBeFocused();
}

async function selectConnectedPortal(page: Page, portalId: number | null): Promise<void> {
  // The popover is positioned by melt-ui and can land off-viewport inside the
  // scrollable modal, so select with keys inside the focused listbox instead
  // of clicking options. A click-open leaves the highlight unset
  // (aria-activedescendant absent, internal index -1); a keyboard-open
  // highlights the current value. Read the live highlight and walk from it so
  // both open paths land on the target option.
  await openPortalDropdown(page);
  const listbox = page.getByTestId('email-connected-portal-listbox');
  const targetValue = portalId === null ? '' : String(portalId);
  const { values, ids } = await listbox
    .getByTestId('email-connected-portal-option')
    .evaluateAll((els) => ({
      values: els.map((el) => el.getAttribute('data-option-id')),
      ids: els.map((el) => el.id),
    }));
  const targetIndex = values.indexOf(targetValue);
  expect(
    targetIndex,
    `option ${targetValue || '"Not connected"'} among [${values.join(', ')}]`
  ).toBeGreaterThanOrEqual(0);

  const activeId = await listbox.getAttribute('aria-activedescendant');
  let steps: number;
  if (activeId === null) {
    // No highlight yet: the first ArrowDown lands on index 0.
    steps = targetIndex + 1;
  } else {
    const currentIndex = ids.indexOf(activeId);
    steps = (targetIndex - currentIndex + values.length) % values.length;
  }
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  await expect(listbox).toBeHidden();
}

async function saveChannelSettings(page: Page, emailChannelId: number): Promise<number> {
  const configPut = page.waitForResponse(
    (resp) =>
      resp.url().includes(`/channels/${emailChannelId}/config`) &&
      resp.request().method() === 'PUT'
  );
  await page.getByTestId('dialog-confirm').click();
  const resp = await configPut;
  return resp.status();
}

async function browserForUser(
  browser: Browser,
  user: { username: string; password: string }
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: { cookies: [], origins: [] },
  });
  const login = await context.request.post('/api/auth/login', {
    headers: SEC_FETCH,
    data: {
      email_or_username: user.username,
      password: user.password,
      remember_me: false,
    },
  });
  expect(login.ok(), `manager login: ${login.status()}`).toBeTruthy();
  return { context, page: await context.newPage() };
}

test.describe('Email channel connected portal config (WI-1599)', () => {
  test.describe.configure({ mode: 'serial' });

  test('admin connects a mailbox to a portal; the portal lists the mailbox and the link persists', async ({
    page,
    request,
  }) => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const portal = await createPortalChannel(request, {
      slug: `connected-portal-${suffix}`,
      name: `Connected Portal ${suffix}`,
    });
    const email = await createUnconnectedEmailChannel(request, suffix);

    await openEmailChannelSettings(page, email.channelId);
    await selectConnectedPortal(page, portal.channelId);

    const saveStatus = await saveChannelSettings(page, email.channelId);
    expect(saveStatus, 'config PUT must succeed for a channel admin').toBe(200);
    await expect(page.getByTestId('channel-config-toast')).toBeVisible();

    // The selection persists across a reload of the settings form.
    await openEmailChannelSettings(page, email.channelId);
    await expect(page.locator('#email-connected-portal')).toHaveText(portal.name);

    // The portal's settings page lists the connected mailbox read-only.
    await page.goto(`/admin/channels/${portal.channelId}/portal`);
    await expect(page.getByTestId(`portal-connected-mailbox-${email.channelId}`)).toBeVisible();
    await expect(
      page.getByTestId(`portal-connected-mailbox-${email.channelId}`)
    ).toContainText(email.name);
    await expect(
      page.getByTestId(`portal-connected-mailbox-status-${email.channelId}`)
    ).toContainText('Disabled');

    // Disconnecting through the same form clears the link and empties the
    // portal's mailbox list.
    await openEmailChannelSettings(page, email.channelId);
    await selectConnectedPortal(page, null);
    const disconnectStatus = await saveChannelSettings(page, email.channelId);
    expect(disconnectStatus).toBe(200);

    await page.goto(`/admin/channels/${portal.channelId}/portal`);
    await expect(page.getByTestId('portal-connected-mailboxes')).toBeVisible();
    await expect(page.getByTestId('portal-connected-mailbox-list')).toHaveCount(0);
  });

  test('saving a stale portal selection after manage access is revoked is forbidden', async ({
    browser,
    page,
    request,
  }) => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const portal = await createPortalChannel(request, {
      slug: `denied-portal-${suffix}`,
      name: `Denied Portal ${suffix}`,
    });
    const email = await createUnconnectedEmailChannel(request, suffix);

    const data = generateUser(suffix);
    const user = await createUserViaAPI(request, data);
    for (const channelID of [email.channelId, portal.channelId]) {
      const assign = await request.post(`/api/channels/${channelID}/managers`, {
        headers: SEC_FETCH,
        data: { manager_type: 'user', manager_ids: [user.id] },
      });
      expect(assign.ok(), `assign manager on ${channelID}: ${assign.status()}`).toBeTruthy();
    }

    const manager = await browserForUser(browser, {
      username: data.username,
      password: data.password_hash,
    });

    // The manager manages both channels, so the portal is offered. Admin then
    // revokes the portal management while the form is open; the still-listed
    // option must not survive save-time authorization.
    await openEmailChannelSettings(manager.page, email.channelId);

    const managers = await request.get(`/api/channels/${portal.channelId}/managers`, {
      headers: SEC_FETCH,
    });
    expect(managers.ok(), `list portal managers: ${managers.status()}`).toBeTruthy();
    const rows = (await managers.json()) as Array<{
      id: number;
      manager_type: string;
      manager_id: number;
    }>;
    const row = rows.find((r) => r.manager_type === 'user' && r.manager_id === user.id);
    expect(row, 'portal manager row for the test user').toBeTruthy();
    const revoke = await request.delete(
      `/api/channels/${portal.channelId}/managers/${row!.id}`,
      { headers: SEC_FETCH }
    );
    expect(revoke.ok(), `revoke portal manager: ${revoke.status()}`).toBeTruthy();

    await selectConnectedPortal(manager.page, portal.channelId);

    const saveStatus = await saveChannelSettings(manager.page, email.channelId);
    expect(saveStatus, 'stale portal selection must be forbidden').toBe(403);
    // The toast surfaces the localized permission-denied error, not the save.
    await expect(manager.page.getByTestId('channel-config-toast')).toContainText(
      'Insufficient permissions'
    );

    // The denial is durable: no link was stored. (The follow-up dropdown
    // check lives in the modal-crash bug: a failed save breaks the live app
    // session, so this assertion deliberately inspects a fresh page load.)
    await openEmailChannelSettings(manager.page, email.channelId);
    await expect(manager.page.locator('#email-connected-portal')).toHaveText('Not connected');

    // The unconnected portal lists no mailboxes (asserted from the admin view,
    // which can always see the portal channel).
    await page.goto(`/admin/channels/${portal.channelId}/portal`);
    await expect(page.getByTestId('portal-connected-mailboxes')).toBeVisible();
    await expect(page.getByTestId('portal-connected-mailbox-list')).toHaveCount(0);

    await manager.context.close();
  });
});
