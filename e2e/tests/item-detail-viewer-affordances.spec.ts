import { createItemViaAPI } from '../fixtures/api-helpers';
import { expect, test } from '../fixtures/context-path';
import {
	createGatedWorkspaceWithSessions,
	disposeGatedWorkspace,
	type GatedWorkspace,
} from '../fixtures/role-sessions';
import { generateItem } from '../fixtures/test-data';

/**
 * Item detail write affordances vs item.edit.
 *
 * Every write affordance in the item detail body is backed by an API that
 * requires item.edit (description PATCH, attachment upload via
 * authorizeItemEdit, link creation via CheckEntityPermission, recurrence via
 * CanEditWorkspace) — all returning 404 on denial. The seeded Viewer role
 * lacks item.edit, so the UI matches the server: the description renders
 * read-only (no click-to-edit) and no attach/add-link/recurrence affordances
 * are offered.
 */

const SEC_FETCH = { 'Sec-Fetch-Site': 'same-origin' };

async function openItemDetail(
	page: import('@playwright/test').Page,
	workspaceId: number,
	itemId: number,
) {
	await page.goto(`/workspaces/${workspaceId}/items/${itemId}`);
	await expect(page.getByTestId('item-detail-ready')).toBeVisible({
		timeout: 15_000,
	});
}

test.describe('item detail write affordances vs item.edit permission', () => {
	test('viewer gets no write affordances on the item body', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `idv${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'viewer', role: 'Viewer' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const viewer = sessionsByLabel.viewer;

			const itemData = generateItem(workspaceId, suffix);
			const item = await createItemViaAPI(request, workspaceId, {
				title: itemData.title,
				description: itemData.description,
			});

			await openItemDetail(viewer.page, workspaceId, item.id);

			// The description renders read-only: clicking it must not open
			// the editor.
			await viewer.page.getByTestId('item-description-display').click();
			await expect(
				viewer.page.getByTestId('item-description-editor'),
			).toHaveCount(0);

			// No add-link…
			await expect(viewer.page.getByTestId('add-link-button')).toHaveCount(0);

			// …and no add-recurrence entry in the actions menu.
			await viewer.page.getByTestId('item-detail-actions-menu').click();
			await expect(
				viewer.page.getByTestId('item-recurrence-add'),
			).toHaveCount(0);
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});

	test('editor gets the write affordances', async ({ request, browser }) => {
		test.setTimeout(90_000);
		const suffix = `ide${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'editor', role: 'Editor' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const editor = sessionsByLabel.editor;

			const itemData = generateItem(workspaceId, suffix);
			const item = await createItemViaAPI(request, workspaceId, {
				title: itemData.title,
				description: itemData.description,
			});

			await openItemDetail(editor.page, workspaceId, item.id);

			await editor.page.getByTestId('item-description-display').click();
			await expect(
				editor.page.getByTestId('item-description-editor'),
			).toBeVisible({ timeout: 5_000 });

			await expect(editor.page.getByTestId('add-link-button')).toBeVisible();

			await editor.page.getByTestId('item-detail-actions-menu').click();
			await expect(editor.page.getByTestId('item-recurrence-add')).toBeVisible();
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});

	test('viewer description write is denied with 404', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `ida${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'viewer', role: 'Viewer' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const viewer = sessionsByLabel.viewer;

			const itemData = generateItem(workspaceId, suffix);
			const item = await createItemViaAPI(request, workspaceId, {
				title: itemData.title,
				description: itemData.description,
			});

			const denied = await viewer.request.patch(`/api/v2/items/${item.id}`, {
				headers: {
					...SEC_FETCH,
					'Content-Type': 'application/merge-patch+json',
				},
				data: { description: 'viewer write attempt' },
			});
			expect(denied.status(), await denied.text()).toBe(404);

			const adminGet = await request.get(`/api/v2/items/${item.id}`, {
				headers: SEC_FETCH,
			});
			expect((await adminGet.json()).data.description).toBe(
				itemData.description,
			);
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});
});
