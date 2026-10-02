import { expect, test } from '../fixtures/context-path';
import {
	createGatedWorkspaceWithSessions,
	disposeGatedWorkspace,
	type GatedWorkspace,
} from '../fixtures/role-sessions';

/**
 * workspace.admin — the settings surface must match the permission.
 *
 * The seeded Editor role lacks workspace.admin. An Editor must not get the
 * Settings nav entry, and direct URL access to any settings module must land
 * on the access-denied state instead of the settings content. A workspace
 * Administrator (a regular user, not the system admin) gets the nav entry and
 * the settings content.
 */

test.describe('workspace settings access vs workspace.admin permission', () => {
	test('editor: settings nav entry hidden and direct URL shows the denial state', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `wsa${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'editor', role: 'Editor' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const editor = sessionsByLabel.editor;

			await editor.page.goto(`/workspaces/${workspaceId}/board`);
			await expect(editor.page.getByTestId('board-view')).toBeVisible({
				timeout: 15_000,
			});

			// No settings entry in the workspace nav…
			await expect(editor.page.getByTestId('workspace-nav-settings')).toHaveCount(0);

			// …and direct navigation cannot bypass enforcement: the denial
			// state renders instead of the settings module.
			await editor.page.goto(`/workspaces/${workspaceId}/settings/general`);
			await expect(
				editor.page.getByTestId('workspace-settings-access-denied'),
			).toBeVisible({ timeout: 15_000 });
			await expect(
				editor.page.getByTestId('workspace-settings-module-general'),
			).toHaveCount(0);
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});

	test('workspace administrator: nav entry present and settings module renders', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `wsd${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'admin', role: 'Administrator' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const admin = sessionsByLabel.admin;

			await admin.page.goto(`/workspaces/${workspaceId}/board`);
			await expect(admin.page.getByTestId('board-view')).toBeVisible({
				timeout: 15_000,
			});

			await admin.page.getByTestId('workspace-nav-settings').click();
			await expect(
				admin.page.getByTestId('workspace-settings-module-general'),
			).toBeVisible({ timeout: 15_000 });
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});
});
