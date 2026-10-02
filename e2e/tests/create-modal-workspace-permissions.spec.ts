import { expect, test, type Page } from '../fixtures/context-path';
import {
	createGatedWorkspaceWithSessions,
	disposeGatedWorkspace,
	type GatedWorkspace,
} from '../fixtures/role-sessions';

/**
 * item.create — the create modal's work-item workspace picker must follow
 * the permission.
 *
 * POST /v2/items requires item.create in the target workspace and denies
 * with 404 (item-scoped denial contract). The sidebar create button opens
 * for everyone (it also hosts the permission-free collection type), so the
 * picker is the gate: it must only list workspaces where the user holds
 * item.create. CollectionBoard quick-add (WI-1432) and the move-to-workspace
 * dialog already filter this way; the create modal is WI-1438.
 *
 * Assertions target the uniquely-keyed gated workspace only. The
 * everyone-Viewer fallback makes every concurrently-created ungated
 * workspace visible to fixture users, so total option counts are not a
 * stable contract here.
 */

const SEC_FETCH = { 'Sec-Fetch-Site': 'same-origin' };

async function getWorkspaceKey(
	request: import('@playwright/test').APIRequestContext,
	workspaceId: number,
): Promise<string> {
	const resp = await request.get(`/api/v2/workspaces/${workspaceId}`, {
		headers: SEC_FETCH,
	});
	expect(resp.ok(), `get workspace: ${resp.status()}`).toBeTruthy();
	return (await resp.json()).data.key as string;
}

/**
 * Open the board and wait for the app-startup workspaces list to settle, so
 * the create modal's picker content cannot race the store load. Seeds the
 * form store's persisted workspace choice with the target workspace, so the
 * pre-selection paths (opening context and localStorage) are both exercised.
 */
async function openBoard(page: Page, workspaceId: number) {
	await page.addInitScript(
		([id]) => {
			window.localStorage.setItem('vertex_create_modal_workspace', String(id));
		},
		[workspaceId],
	);
	const workspacesLoaded = page.waitForResponse(
		(r) =>
			r.request().method() === 'GET' &&
			/\/api\/v2\/workspaces(\?|$)/.test(r.url()) &&
			r.ok(),
	);
	await page.goto(`/workspaces/${workspaceId}/board`);
	await expect(page.getByTestId('board-view')).toBeVisible({
		timeout: 15_000,
	});
	await workspacesLoaded;
}

/** Open the create modal via the sidebar button. */
async function openCreateModal(page: Page) {
	await page.locator('#global-create-button').click();
	await expect(page.getByTestId('create-modal')).toBeVisible();
}

/** Open the create modal's workspace picker, return the option locator. */
async function openWorkspacePicker(page: Page) {
	await page.getByTestId('create-workspace-chip').click();
	await expect(page.getByTestId('create-workspace-chip-dropdown')).toBeVisible();

	return page
		.getByTestId('create-workspace-chip-listbox')
		.getByTestId('create-workspace-chip-option');
}

test.describe('create modal workspace picker vs item.create permission', () => {
	test('viewer without item.create: the picker does not offer the gated workspace', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `cmv${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'viewer', role: 'Viewer' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const viewer = sessionsByLabel.viewer;
			const workspaceKey = await getWorkspaceKey(request, workspaceId);

			await openBoard(viewer.page, workspaceId);
			await openCreateModal(viewer.page);

			// The modal opens with the gated workspace as the opening context and
			// as the persisted choice; neither path may pre-select it.
			await expect(viewer.page.getByTestId('create-workspace-chip')).not.toContainText(
				workspaceKey,
			);

			// The gated workspace must not be offered as a creation target.
			const options = await openWorkspacePicker(viewer.page);
			await expect(options.filter({ hasText: workspaceKey })).toHaveCount(0);
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});

	test('editor sees the gated workspace offered as a creation target', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `cme${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'editor', role: 'Editor' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const editor = sessionsByLabel.editor;
			const workspaceKey = await getWorkspaceKey(request, workspaceId);

			await openBoard(editor.page, workspaceId);
			await openCreateModal(editor.page);

			// The Editor holds item.create: the gated workspace is pre-selected
			// in the chip (opening context and persisted choice both apply).
			await expect(editor.page.getByTestId('create-workspace-chip')).toContainText(workspaceKey);

			// And it is offered exactly once in the picker.
			const options = await openWorkspacePicker(editor.page);
			await expect(options.filter({ hasText: workspaceKey })).toHaveCount(1);
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});
});
