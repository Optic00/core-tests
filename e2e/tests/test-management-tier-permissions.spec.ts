import { expect, test } from '../fixtures/context-path';
import {
	createGatedWorkspaceWithSessions,
	disposeGatedWorkspace,
	type GatedWorkspace,
} from '../fixtures/role-sessions';

/**
 * Test management tier separation — test.view / test.execute / test.manage.
 *
 * Of the seeded roles only Tester holds test.execute + test.manage; Editor
 * is deliberately read-only (test.view, see permissions.sql "Editor role can
 * view tests (read-only)"); Viewer has no test permission at all.
 *
 * Server contract (internal/services/test_management_application_service.go):
 * reads require test.view, case/set/folder mutations require test.manage,
 * run creation and result recording require test.execute. Denial is 404
 * ("Test resource was not found") — see testManagementError.
 *
 * The Tests nav section is gated on canViewTests (WorkspaceNavigation.svelte);
 * the in-page create/manage/execute affordances follow the same tiers via
 * workspacePermissions.
 */

const SEC_FETCH = { 'Sec-Fetch-Site': 'same-origin' };

test.describe('test management tiers vs permissions', () => {
	test('Tests nav section follows test.view per role', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `tmp${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'viewer', role: 'Viewer' },
				{ label: 'editor', role: 'Editor' },
				{ label: 'tester', role: 'Tester' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;

			// Viewer (no test.view): the whole Tests section is absent.
			await sessionsByLabel.viewer.page.goto(`/workspaces/${workspaceId}/board`);
			await expect(
				sessionsByLabel.viewer.page.getByTestId('board-view'),
			).toBeVisible({ timeout: 15_000 });
			await expect(
				sessionsByLabel.viewer.page.getByTestId('workspace-tests-toggle'),
			).toHaveCount(0);

			// Editor (test.view, read-only tier) and Tester (full tier) see it.
			for (const label of ['editor', 'tester'] as const) {
				const session = sessionsByLabel[label];
				await session.page.goto(`/workspaces/${workspaceId}/board`);
				await expect(session.page.getByTestId('board-view')).toBeVisible({
					timeout: 15_000,
				});
				await expect(
					session.page.getByTestId('workspace-tests-toggle'),
				).toBeVisible();
			}
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});

	test('editor (test.view only) gets a read-only Test Cases page without create affordances', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `tme${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'editor', role: 'Editor' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const editor = sessionsByLabel.editor;

			await editor.page.goto(`/workspaces/${workspaceId}/tests`);
			await expect(editor.page.getByTestId('test-folder-all')).toBeVisible({
				timeout: 15_000,
			});
			await expect(
				editor.page.getByTestId('test-case-create-button'),
			).toHaveCount(0);
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});

	test('tester (test.manage) sees the create affordance', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `tmt${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'tester', role: 'Tester' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const tester = sessionsByLabel.tester;

			await tester.page.goto(`/workspaces/${workspaceId}/tests`);
			await expect(tester.page.getByTestId('test-folder-all')).toBeVisible({
				timeout: 15_000,
			});
			await expect(
				tester.page.getByTestId('test-case-create-button'),
			).toBeVisible();
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});

	test('API tiers: editor cannot create cases or runs (404); tester can', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `tma${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'editor', role: 'Editor' },
				{ label: 'tester', role: 'Tester' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const editor = sessionsByLabel.editor;
			const tester = sessionsByLabel.tester;

			// test.manage tier: case creation is denied for the Editor.
			const deniedCase = await editor.request.post(
				`/api/v2/workspaces/${workspaceId}/test-cases`,
				{
					headers: SEC_FETCH,
					data: { title: `editor case ${suffix}` },
				},
			);
			expect(deniedCase.status(), await deniedCase.text()).toBe(404);

			// test.execute tier: run creation is denied for the Editor too.
			const deniedRun = await editor.request.post(
				`/api/v2/workspaces/${workspaceId}/test-runs`,
				{
					headers: SEC_FETCH,
					data: { name: `editor run ${suffix}` },
				},
			);
			expect(deniedRun.status(), await deniedRun.text()).toBe(404);

			// Tester holds both tiers and creates the case.
			const created = await tester.request.post(
				`/api/v2/workspaces/${workspaceId}/test-cases`,
				{
					headers: SEC_FETCH,
					data: { title: `tester case ${suffix}` },
				},
			);
			expect(created.status(), await created.text()).toBe(201);
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});
});
