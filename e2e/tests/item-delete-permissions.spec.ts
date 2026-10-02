import { createItemViaAPI } from '../fixtures/api-helpers';
import { expect, test } from '../fixtures/context-path';
import {
	createGatedWorkspaceWithSessions,
	disposeGatedWorkspace,
	type GatedWorkspace,
} from '../fixtures/role-sessions';
import { generateItem } from '../fixtures/test-data';

/**
 * item.delete — the delete affordance and the delete API must agree.
 *
 * The seeded Editor role lacks item.delete (Administrator-only, see
 * permissions.sql). An Editor must therefore never see the delete entry in
 * the item actions menu, and a direct API delete must be rejected with 404
 * (item-scoped permission failures return 404, not 403, to avoid leaking
 * item existence). A workspace Administrator — a regular user, not the
 * system admin — must see the affordance.
 */

const SEC_FETCH = { 'Sec-Fetch-Site': 'same-origin' };

test.describe('item delete affordance vs item.delete permission', () => {
	test('editor without item.delete: no delete menu entry and API delete is 404', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `idp${Date.now()}`;
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
			});

			await editor.page.goto(`/workspaces/${workspaceId}/items/${item.id}`);
			await expect(editor.page.getByTestId('item-detail-ready')).toBeVisible({
				timeout: 15_000,
			});
			await editor.page.getByTestId('item-detail-actions-menu').click();

			await expect(editor.page.getByTestId('item-delete-open')).toHaveCount(0);

			// Same contract server-side: denied with 404, item survives.
			const denied = await editor.request.delete(`/api/v2/items/${item.id}`, {
				headers: SEC_FETCH,
			});
			expect(denied.status(), await denied.text()).toBe(404);

			const adminGet = await request.get(`/api/v2/items/${item.id}`, {
				headers: SEC_FETCH,
			});
			expect(adminGet.ok()).toBeTruthy();
			expect((await adminGet.json()).data.title).toBe(itemData.title);
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});

	test('workspace administrator sees the delete menu entry', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `ida${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'admin', role: 'Administrator' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const admin = sessionsByLabel.admin;

			const itemData = generateItem(workspaceId, suffix);
			const item = await createItemViaAPI(request, workspaceId, {
				title: itemData.title,
			});

			await admin.page.goto(`/workspaces/${workspaceId}/items/${item.id}`);
			await expect(admin.page.getByTestId('item-detail-ready')).toBeVisible({
				timeout: 15_000,
			});
			await admin.page.getByTestId('item-detail-actions-menu').click();

			await expect(admin.page.getByTestId('item-delete-open')).toBeVisible();
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});
});
