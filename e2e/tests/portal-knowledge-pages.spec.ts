import { test, expect } from '../fixtures/mail';
import type { APIRequestContext } from '../fixtures/context-path';
import { authenticateAdminRequest, createWorkspaceViaAPI, createUserViaAPI } from '../fixtures/api-helpers';
import { generateWorkspace, generateUser } from '../fixtures/test-data';
import { createPortalChannel } from '../helpers/portal-setup';
import { KnowledgePage } from '../pages/knowledge.page';

/**
 * Portal knowledge-base workspace-pages wiring (WI-1134).
 *
 * A channel manager explicitly wires a workspace's Pages tree — the whole
 * workspace or a sub-page subtree — into the portal knowledge base from the
 * customize panel. Wired pages become searchable on the portal, the KB marks
 * the exposure, and the page editor shows a green "publicly viewable" bar.
 */

const SEC_FETCH = { 'Sec-Fetch-Site': 'same-origin' };
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

async function createWorkspacePageViaAPI(
	request: APIRequestContext,
	workspaceId: number,
	title: string,
	content: string,
	parentId?: number,
) {
	const response = await request.post(`${BASE_URL}/api/v2/workspaces/${workspaceId}/pages`, {
		headers: SEC_FETCH,
		data: { title, content, ...(parentId ? { parent_id: parentId } : {}) },
	});
	expect(response.ok(), `create page: ${response.status()} ${await response.text()}`).toBeTruthy();
	const body = await response.json();
	return body.data.id as number;
}

async function wireKnowledgeBaseSources(
	request: APIRequestContext,
	channelId: number,
	sources: Array<{ workspace_id: number; root_page_id?: number }>,
) {
	const resp = await request.put(`${BASE_URL}/api/channels/${channelId}/config`, {
		headers: SEC_FETCH,
		data: { config: { knowledge_base_page_sources: sources } },
	});
	expect(resp.ok(), `wire KB sources: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

async function workspaceRoleId(request: APIRequestContext, name: string): Promise<number> {
	const response = await request.get(`${BASE_URL}/api/workspace-roles`, { headers: SEC_FETCH });
	expect(response.ok(), 'list workspace roles').toBeTruthy();
	const body = await response.json();
	const roles: Array<{ id: number; name: string }> = body.data ?? body;
	const role = roles.find((entry) => entry.name === name);
	expect(role, `workspace role ${name}`).toBeDefined();
	return role!.id;
}

async function assignWorkspaceRole(
	request: APIRequestContext,
	userId: number,
	workspaceId: number,
	roleId: number,
) {
	const resp = await request.post(`${BASE_URL}/api/workspace-roles/assign`, {
		headers: SEC_FETCH,
		data: { user_id: userId, workspace_id: workspaceId, role_id: roleId },
	});
	expect(resp.ok(), `assign workspace role: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

/**
 * Signs a portal customer in via magic link (open registration) and leaves
 * the browser context authenticated for the portal. Returns the email used.
 */
async function signInPortalCustomer(
	page: import('@playwright/test').Page,
	slug: string,
	stamp: number,
	mail: { waitForLast(opts: { to: string; subject: string; since: Date; timeoutMs?: number }): Promise<{ Text: string }> },
): Promise<string> {
	await page.context().clearCookies();
	const customerEmail = `e2e-kb-${stamp}@windshift.test`;
	const since = new Date();
	const reqResp = await page.request.post(`/api/portal/${slug}/auth/request`, {
		headers: SEC_FETCH,
		data: { email: customerEmail },
	});
	expect(reqResp.ok(), `magic-link request: ${reqResp.status()}`).toBeTruthy();
	const msg = await mail.waitForLast({
		to: customerEmail,
		subject: 'Sign in to your portal',
		since,
		timeoutMs: 5000,
	});
	const token = msg.Text.match(/[?#&]token=([A-Za-z0-9_=-]+)/)![1];
	const verifyResp = await page.request.get(
		`/api/portal/${slug}/auth/verify?token=${encodeURIComponent(token)}`,
		{ headers: SEC_FETCH },
	);
	expect(verifyResp.ok(), 'verify magic link').toBeTruthy();
	return customerEmail;
}

test.describe('Portal knowledge base — workspace pages', () => {
	test('channel manager wires workspace pages from the customize panel and sees the exposure marker', async ({
		page,
		request,
	}) => {
		await authenticateAdminRequest(request);
		const stamp = Date.now();
		const channel = await createPortalChannel(request, {
			slug: `e2e-kb-wire-${stamp}`,
			name: `KB Wiring ${stamp}`,
		});
		await createWorkspacePageViaAPI(
			request,
			channel.workspaceId,
			'Onboarding checklist',
			'The onboarding checklist covers first-day setup.',
		);

		await page.goto(`${BASE_URL}/portal/${channel.slug}`);
		await expect(page.getByTestId('portal-page')).toHaveAttribute('data-ready', 'true');
		await page.getByTestId('portal-settings-button').click();
		await page.getByTestId('portal-customize-button').click();
		await page.getByTestId('portal-customize-kb-section').click();

		const wiring = page.getByTestId('kb-pages-wiring');
		await expect(wiring).toBeVisible();
		await expect(wiring.getByTestId('kb-pages-wiring-empty')).toBeVisible();

		// The picker only offers workspaces connected to this portal, so the
		// channel's own workspace is the single selectable option.
		const workspaceResp = await request.get(`${BASE_URL}/api/v2/workspaces/${channel.workspaceId}`);
		expect(workspaceResp.ok(), 'load workspace').toBeTruthy();
		const workspaceBody = await workspaceResp.json();
		const workspaceName = workspaceBody.data.name as string;

		await wiring.getByTestId('kb-add-workspace').selectOption({ label: workspaceName });
		const save = page.waitForResponse(
			(r) => r.request().method() === 'PUT' && r.url().includes(`/api/channels/${channel.channelId}/config`),
		);
		await wiring.getByTestId('kb-add-page-source').click();
		const saveResp = await save;
		expect(saveResp.ok(), `KB wiring save: ${saveResp.status()} ${await saveResp.text()}`).toBeTruthy();

		await expect(wiring.getByTestId('kb-pages-wiring-notice')).toBeVisible();
		await expect(wiring.getByTestId('kb-page-source-entry')).toHaveCount(1);

		// Persistence survives a reload.
		await page.reload();
		await page.getByTestId('portal-settings-button').click();
		await page.getByTestId('portal-customize-button').click();
		await page.getByTestId('portal-customize-kb-section').click();
		await expect(page.getByTestId('kb-pages-wiring').getByTestId('kb-page-source-entry')).toHaveCount(1);
	});

	test('channel manager wires a sub-page subtree through the searchable page picker', async ({
		page,
		request,
	}) => {
		await authenticateAdminRequest(request);
		const stamp = Date.now();
		const channel = await createPortalChannel(request, {
			slug: `e2e-kb-subtree-ui-${stamp}`,
			name: `KB Subtree UI ${stamp}`,
		});
		const rootTitle = `Handbook root ${stamp}`;
		const childTitle = `Child page ${stamp}`;
		const rootId = await createWorkspacePageViaAPI(request, channel.workspaceId, rootTitle, 'Root.');
		await createWorkspacePageViaAPI(request, channel.workspaceId, childTitle, 'Child body.', rootId);

		await page.goto(`${BASE_URL}/portal/${channel.slug}`);
		await expect(page.getByTestId('portal-page')).toHaveAttribute('data-ready', 'true');
		await page.getByTestId('portal-settings-button').click();
		await page.getByTestId('portal-customize-button').click();
		await page.getByTestId('portal-customize-kb-section').click();

		const wiring = page.getByTestId('kb-pages-wiring');
		await expect(wiring.getByTestId('kb-pages-wiring-empty')).toBeVisible();

		const workspaceResp = await request.get(`${BASE_URL}/api/v2/workspaces/${channel.workspaceId}`);
		expect(workspaceResp.ok(), 'load workspace').toBeTruthy();
		const workspaceName = ((await workspaceResp.json()).data as { name: string }).name;

		await wiring.getByTestId('kb-add-workspace').selectOption({ label: workspaceName });
		await wiring.getByTestId('kb-add-scope').selectOption('subtree');

		// The start page is a searchable picker (same server-side page search
		// as the work-item link dialog): type a title substring, then pick the
		// matching option row.
		const pageInput = wiring.getByTestId('kb-add-page');
		await pageInput.click();
		await pageInput.fill(rootTitle);
		// BasePicker portals its dropdown to document.body, so the option row
		// is located from the page, not the wiring container.
		const option = page.getByTestId(`kb-add-page-option-${rootId}`);
		await expect(option).toBeVisible();
		await option.click();

		const save = page.waitForResponse(
			(r) => r.request().method() === 'PUT' && r.url().includes(`/api/channels/${channel.channelId}/config`),
		);
		await wiring.getByTestId('kb-add-page-source').click();
		const saveResp = await save;
		expect(saveResp.ok(), `KB wiring save: ${saveResp.status()} ${await saveResp.text()}`).toBeTruthy();

		await expect(wiring.getByTestId('kb-pages-wiring-notice')).toBeVisible();
		await expect(wiring.getByTestId('kb-page-source-entry')).toHaveCount(1);

		// Persistence survives a reload.
		await page.reload();
		await page.getByTestId('portal-settings-button').click();
		await page.getByTestId('portal-customize-button').click();
		await page.getByTestId('portal-customize-kb-section').click();
		await expect(page.getByTestId('kb-pages-wiring').getByTestId('kb-page-source-entry')).toHaveCount(1);
	});

	test('the workspace picker only offers portal-connected workspaces the manager administers', async ({
		browser,
		request,
	}) => {
		await authenticateAdminRequest(request);
		const stamp = Date.now();
		const channel = await createPortalChannel(request, {
			slug: `e2e-kb-pick-${stamp}`,
			name: `KB Picker ${stamp}`,
		});
		// A second portal-connected workspace the manager can see but not
		// administer, plus an unconnected workspace that must never appear.
		const attachedNoAdmin = await createWorkspaceViaAPI(
			request,
			generateWorkspace(`e2e-kb-att-${stamp}`),
		);
		await createWorkspaceViaAPI(request, generateWorkspace(`e2e-kb-unc-${stamp}`));
		const attachResp = await request.put(`${BASE_URL}/api/channels/${channel.channelId}/config`, {
			headers: SEC_FETCH,
			data: { config: { portal_workspace_ids: [channel.workspaceId, attachedNoAdmin.id] } },
		});
		expect(
			attachResp.ok(),
			`attach workspace: ${attachResp.status()} ${await attachResp.text()}`,
		).toBeTruthy();

		// Channel manager: administrator of the portal's own workspace, viewer
		// in the second connected workspace.
		const managerData = generateUser(`e2e-kb-mgr-${stamp}`);
		const manager = await createUserViaAPI(request, managerData);
		const managerResp = await request.post(`${BASE_URL}/api/channels/${channel.channelId}/managers`, {
			headers: SEC_FETCH,
			data: { manager_type: 'user', manager_ids: [manager.id] },
		});
		expect(managerResp.ok(), `assign channel manager: ${managerResp.status()}`).toBeTruthy();
		await assignWorkspaceRole(request, manager.id, channel.workspaceId, await workspaceRoleId(request, 'Administrator'));
		await assignWorkspaceRole(request, manager.id, attachedNoAdmin.id, await workspaceRoleId(request, 'Viewer'));

		const context = await browser.newContext({
			baseURL: BASE_URL,
			storageState: { cookies: [], origins: [] },
		});
		try {
			const login = await context.request.post('/api/auth/login', {
				headers: SEC_FETCH,
				data: {
					email_or_username: managerData.username,
					password: managerData.password_hash,
					remember_me: false,
				},
			});
			expect(login.ok(), 'manager login').toBeTruthy();

			const page = await context.newPage();
			await page.goto(`${BASE_URL}/portal/${channel.slug}`);
			await expect(page.getByTestId('portal-page')).toHaveAttribute('data-ready', 'true');
			await page.getByTestId('portal-settings-button').click();
			await page.getByTestId('portal-customize-button').click();
			await page.getByTestId('portal-customize-kb-section').click();

			const picker = page.getByTestId('kb-add-workspace');
			await expect(picker).toBeVisible();
			// The selectable workspaces load asynchronously (permission profile +
			// workspace list), so wait for the option to appear before reading it.
			await expect(picker.locator('option:not([value=""])')).toHaveCount(1, { timeout: 10_000 });
			const selectableIds = await picker
				.locator('option')
				.evaluateAll((options) =>
					options
						.map((option) => (option as HTMLOptionElement).value)
						.filter((value) => value !== ''),
				);
			expect(selectableIds, 'selectable workspace ids').toEqual([String(channel.workspaceId)]);
		} finally {
			await context.close();
		}
	});

	test('portal search surfaces published workspace pages and opens them in the portal', async ({
		page,
		request,
		mail,
	}) => {
		mail.skipIfMissing();
		await authenticateAdminRequest(request);
		const stamp = Date.now();
		const channel = await createPortalChannel(request, {
			slug: `e2e-kb-search-${stamp}`,
			name: `KB Search ${stamp}`,
		});
		const keyword = `kveldsfred${stamp}`;
		await createWorkspacePageViaAPI(
			request,
			channel.workspaceId,
			'VPN setup',
			`The ${keyword} VPN guide explains the client setup.`,
		);
		await wireKnowledgeBaseSources(request, channel.channelId, [
			{ workspace_id: channel.workspaceId },
		]);

		// Portal-customer session via magic link (open registration).
		await signInPortalCustomer(page, channel.slug, stamp, mail);

		// Search the knowledge base from the hero.
		await page.goto(`${BASE_URL}/portal/${channel.slug}`);
		await expect(page.getByTestId('portal-page')).toHaveAttribute('data-ready', 'true');
		const search = page.getByTestId('portal-kb-search-input');
		const searchResp = page.waitForResponse((r) => r.url().includes('/knowledge-base/search'));
		await search.fill(keyword);
		const searchResponse = await searchResp;
		const searchBody = await searchResponse.text();
		console.log('KB search response:', searchResponse.status(), searchBody.slice(0, 500));
		const result = page.getByTestId('kb-result-workspace-page');
		await expect(result).toBeVisible();
		await expect(result.getByTestId('kb-result-source-badge')).toBeVisible();

		// The snippet renders ts_headline's match highlighting as plain text:
		// the marked keyword is visible, but no raw <mark> markup leaks in.
		const snippet = result.getByTestId('kb-result-highlight');
		await expect(snippet).toContainText(keyword);
		await expect(snippet).not.toContainText('<mark>');

		// The result deep-links to the published article page in the portal
		// (the router keeps the ?source=search query in the URL).
		await result.click();
		await expect(page).toHaveURL(new RegExp(`/portal/${channel.slug}/kb/\\d+(?:\\?.*)?$`));
		const article = page.getByTestId('portal-kb-article');
		await expect(article).toBeVisible();
		await expect(page.getByTestId('portal-kb-article-title')).toHaveText('VPN setup');
		await expect(
			page.getByTestId('portal-kb-article-content').getByText(new RegExp(keyword)),
		).toBeVisible();

		// The article is a real URL: reload it directly to prove the deep link.
		await page.reload();
		await expect(page.getByTestId('portal-kb-article-title')).toHaveText('VPN setup');

	});


	test('KB articles render through the shared read-only page editor', async ({
		page,
		request,
		mail,
	}) => {
		mail.skipIfMissing();
		await authenticateAdminRequest(request);
		const stamp = Date.now();
		const channel = await createPortalChannel(request, {
			slug: `e2e-kb-render-${stamp}`,
			name: `KB Renderer ${stamp}`,
		});
		const articleId = await createWorkspacePageViaAPI(
			request,
			channel.workspaceId,
			`Renderer guide ${stamp}`,
			[
				'## Shared renderer',
				'',
				'The **bold claim** stays formatted.',
				'',
				'- first entry',
				'- second entry',
			].join('\n'),
		);
		await wireKnowledgeBaseSources(request, channel.channelId, [
			{ workspace_id: channel.workspaceId },
		]);

		await signInPortalCustomer(page, channel.slug, stamp, mail);

		await page.goto(`${BASE_URL}/portal/${channel.slug}/kb/${articleId}`);
		await expect(page.getByTestId('portal-kb-article-title')).toHaveText(`Renderer guide ${stamp}`);

		// The article body renders on the same Milkdown surface the page
		// module uses, locked to read-only for portal visitors.
		const content = page.getByTestId('portal-kb-article-content');
		const surface = content.locator('.ProseMirror');
		await expect(surface).toHaveAttribute('contenteditable', 'false');
		await expect(content.locator('h2')).toHaveText('Shared renderer');
		await expect(content.locator('strong')).toHaveText('bold claim');
		await expect(content.locator('ul li')).toHaveText(['first entry', 'second entry']);
		await expect(content).not.toContainText('**');
	});

	test('knowledge base browse listing and deep links serve only wired pages', async ({
		page,
		request,
		mail,
	}) => {
		mail.skipIfMissing();
		await authenticateAdminRequest(request);
		const stamp = Date.now();
		const channel = await createPortalChannel(request, {
			slug: `e2e-kb-browse-${stamp}`,
			name: `KB Browse ${stamp}`,
		});

		// A small tree plus one page outside the wiring.
		const rootId = await createWorkspacePageViaAPI(
			request,
			channel.workspaceId,
			'Handbook',
			`The hersvang handbook root for browse ${stamp}.`,
		);
		const childId = await createWorkspacePageViaAPI(
			request,
			channel.workspaceId,
			'Onboarding steps',
			`The hersvang onboarding steps live under the handbook (${stamp}).`,
			rootId,
		);
		await createWorkspacePageViaAPI(
			request,
			channel.workspaceId,
			'Internal notes',
			`Internal-only hersvang notes that must not publish (${stamp}).`,
		);
		await wireKnowledgeBaseSources(request, channel.channelId, [
			{ workspace_id: channel.workspaceId, root_page_id: rootId },
		]);

		await signInPortalCustomer(page, channel.slug, stamp, mail);

		// The header renders the knowledge-base entry once pages are wired.
		// (Presence, not visibility: the header's sm: buttons are display:none
		// under the e2e viewport setup, a pre-existing condition shared with
		// the My requests button.)
		await page.goto(`${BASE_URL}/portal/${channel.slug}`);
		await expect(page.getByTestId('portal-page')).toHaveAttribute('data-ready', 'true');
		await expect(page.getByTestId('portal-kb-nav')).toHaveCount(1);
		await page.goto(`${BASE_URL}/portal/${channel.slug}/kb`);
		await expect(page).toHaveURL(new RegExp(`/portal/${channel.slug}/kb$`));

		// The browse listing contains exactly the wired subtree.
		await expect(page.getByTestId('portal-kb-browse')).toBeVisible();
		const rows = page.locator('[data-testid^="portal-kb-row-"]');
		await expect(rows).toHaveCount(2);
		await expect(page.getByTestId(`portal-kb-row-${rootId}`)).toBeVisible();
		await expect(page.getByTestId(`portal-kb-row-${childId}`)).toBeVisible();
		await expect(page.getByTestId('portal-kb-browse-count')).toHaveText('2 articles');

		// Deep-link straight to a child article by URL.
		await page.goto(`${BASE_URL}/portal/${channel.slug}/kb/${childId}`);
		await expect(page.getByTestId('portal-kb-article-title')).toHaveText('Onboarding steps');

		// A page outside the wiring gets the safe denial state, same as the API.
		await page.goto(`${BASE_URL}/portal/${channel.slug}/kb/999999`);
		await expect(page.getByTestId('portal-kb-article')).toBeVisible();
		await expect(page.getByText('Article unavailable')).toBeVisible();
	});

	test('the editor marks published pages with a green publicly-viewable bar', async ({
		page,
		request,
	}) => {
		await authenticateAdminRequest(request);
		const stamp = Date.now();
		const channel = await createPortalChannel(request, {
			slug: `e2e-kb-pub-${stamp}`,
			name: `KB Publication ${stamp}`,
		});
		const otherWs = await createWorkspaceViaAPI(request, generateWorkspace(`e2e-kb-pub2-${stamp}`));

		const rootId = await createWorkspacePageViaAPI(request, channel.workspaceId, 'Handbook root', 'Root.');
		const inSubtreeId = await createWorkspacePageViaAPI(
			request,
			channel.workspaceId,
			'Child page',
			'Inside the subtree.',
			rootId,
		);
		const siblingId = await createWorkspacePageViaAPI(
			request,
			channel.workspaceId,
			'Sibling root',
			'Outside the subtree.',
		);
		const unwiredId = await createWorkspacePageViaAPI(request, otherWs.id, 'Unwired page', 'Other workspace.');

		// Subtree wiring: only the Handbook subtree is public.
		await wireKnowledgeBaseSources(request, channel.channelId, [
			{ workspace_id: channel.workspaceId, root_page_id: rootId },
		]);

		const knowledge = new KnowledgePage(page);
		const banner = page.getByTestId('page-publication-banner');

		await knowledge.gotoPage(channel.workspaceId, rootId);
		await expect(banner).toBeVisible();

		await knowledge.gotoPage(channel.workspaceId, inSubtreeId);
		await expect(banner).toBeVisible();

		await knowledge.gotoPage(channel.workspaceId, siblingId);
		await expect(banner).toHaveCount(0);

		await knowledge.gotoPage(otherWs.id, unwiredId);
		await expect(banner).toHaveCount(0);
	});
});
