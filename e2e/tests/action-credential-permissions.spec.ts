import { expect, test } from '../fixtures/context-path';
import {
	createGatedWorkspaceWithSessions,
	disposeGatedWorkspace,
	type GatedWorkspace,
} from '../fixtures/role-sessions';

/**
 * action.credential.manage — workspace action credentials.
 *
 * Server contract (internal/handlers/action_credentials.go): every
 * /api/workspaces/{id}/action-credentials operation requires
 * action.credential.manage in that workspace; denial is 404 so foreign
 * credential existence is not leaked. Of the seeded roles only Administrator
 * holds the permission; the workspace Actions nav entry is likewise gated on
 * action.manage (Administrator-only among seeded roles).
 *
 * The workspace settings module (/workspaces/:id/settings/action-credentials,
 * WI-1433) exposes the same surface in the UI: its nav entry requires
 * action.credential.manage, and inherited (global/shared) rows render without
 * mutation affordances because the workspace API only serves rows pinned to
 * exactly this workspace.
 */

const SEC_FETCH = { 'Sec-Fetch-Site': 'same-origin' };

test.describe('action.credential.manage gating', () => {
	test('actions nav entry and credential API follow action permissions per user', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `acp${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'editor', role: 'Editor' },
				{ label: 'admin', role: 'Administrator' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const editor = sessionsByLabel.editor;
			const admin = sessionsByLabel.admin;

			// Editor (no action.manage): the Actions module is not in the nav.
			await editor.page.goto(`/workspaces/${workspaceId}/board`);
			await expect(editor.page.getByTestId('board-view')).toBeVisible({
				timeout: 15_000,
			});
			await expect(editor.page.getByTestId('workspace-nav-actions')).toHaveCount(0);

			// Editor (no action.credential.manage): list and create are denied
			// with 404 — the exact denial contract for this surface.
			const deniedList = await editor.request.get(
				`/api/workspaces/${workspaceId}/action-credentials`,
				{ headers: SEC_FETCH },
			);
			expect(deniedList.status(), await deniedList.text()).toBe(404);

			const deniedCreate = await editor.request.post(
				`/api/workspaces/${workspaceId}/action-credentials`,
				{
					headers: SEC_FETCH,
					data: {
						name: `denied ${suffix}`,
						credential_type: 'bearer_token',
						secret: 'should-never-be-stored',
					},
				},
			);
			expect(deniedCreate.status(), await deniedCreate.text()).toBe(404);

			// Administrator (action.manage + action.credential.manage): the
			// Actions module is in the nav and the credential CRUD works.
			await admin.page.goto(`/workspaces/${workspaceId}/board`);
			await expect(admin.page.getByTestId('board-view')).toBeVisible({
				timeout: 15_000,
			});
			await expect(admin.page.getByTestId('workspace-nav-actions')).toBeVisible();

			const credentialName = `e2e credential ${suffix}`;
			const created = await admin.request.post(
				`/api/workspaces/${workspaceId}/action-credentials`,
				{
					headers: SEC_FETCH,
					data: {
						name: credentialName,
						credential_type: 'bearer_token',
						secret: 'e2e-secret-value',
					},
				},
			);
			expect(created.status(), await created.text()).toBe(201);
			// This surface (internal/handlers) responds without a data envelope.
			const credential = (await created.json()) as { id: number };

			const list = await admin.request.get(
				`/api/workspaces/${workspaceId}/action-credentials`,
				{ headers: SEC_FETCH },
			);
			expect(list.ok()).toBeTruthy();
			const listed = ((await list.json()) ?? []) as Array<{ id: number }>;
			expect(listed.some((c) => c.id === credential.id)).toBe(true);

			const rotated = await admin.request.post(
				`/api/workspaces/${workspaceId}/action-credentials/${credential.id}/rotate`,
				{
					headers: SEC_FETCH,
					data: { secret: 'e2e-rotated-secret' },
				},
			);
			expect(rotated.status(), await rotated.text()).toBe(200);

			const deleted = await admin.request.delete(
				`/api/workspaces/${workspaceId}/action-credentials/${credential.id}`,
				{ headers: SEC_FETCH },
			);
			expect(deleted.status()).toBe(204);
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});

	test('workspace settings module manages credentials through the UI', async ({
		request,
		browser,
	}) => {
		test.setTimeout(120_000);
		const suffix = `acu${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'editor', role: 'Editor' },
				{ label: 'admin', role: 'Administrator' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const editor = sessionsByLabel.editor;
			const admin = sessionsByLabel.admin;

			// Editor (no workspace.admin, no action.credential.manage): direct
			// navigation to the module cannot bypass the settings gate.
			await editor.page.goto(
				`/workspaces/${workspaceId}/settings/action-credentials`,
			);
			await expect(
				editor.page.getByTestId('workspace-settings-access-denied'),
			).toBeVisible({ timeout: 15_000 });
			await expect(
				editor.page.getByTestId('workspace-credential-add'),
			).toHaveCount(0);

			// Administrator (action.credential.manage): the module is in the
			// settings nav and offers the full CRUD workflow.
			await admin.page.goto(
				`/workspaces/${workspaceId}/settings/action-credentials`,
			);
			await expect(
				admin.page.getByTestId('workspace-settings-module-action-credentials'),
			).toBeVisible({ timeout: 15_000 });
			await expect(
				admin.page.getByTestId('workspace-admin-nav-action-credentials'),
			).toBeVisible();
			await expect(admin.page.getByTestId('workspace-credentials-empty')).toBeVisible();

			// Create through the modal (secret is write-only; the row surfaces
			// only the sanitized DTO).
			await admin.page.getByTestId('workspace-credential-add').click();
			await admin.page
				.getByTestId('workspace-credential-name-input')
				.fill(`ui credential ${suffix}`);
			await admin.page
				.getByTestId('workspace-credential-secret-input')
				.fill('ui-secret-value');
			await admin.page.getByTestId('entity-form-confirm').click();
			await expect(
				admin.page.getByTestId(/^workspace-credential-name-\d+/),
			).toHaveCount(1, { timeout: 15_000 });
			const credentialId = await admin.page
				.getByTestId(/^workspace-credential-name-\d+/)
				.getAttribute('data-credential-id');
			expect(credentialId).toBeTruthy();

			// Workspace-owned rows expose rotate/edit/delete affordances.
			await expect(
				admin.page.getByTestId(`workspace-credential-rotate-${credentialId}`),
			).toBeVisible();
			await admin.page
				.getByTestId(`workspace-credential-rotate-${credentialId}`)
				.click();
			await admin.page
				.getByTestId('workspace-credential-rotate-input')
				.fill('ui-rotated-secret');
			await admin.page.getByTestId('entity-form-confirm').click();
			await expect(
				admin.page.getByTestId(/^workspace-credential-name-\d+/),
			).toHaveCount(1, { timeout: 15_000 });

			// Delete via the confirm dialog.
			await admin.page
				.getByTestId(`workspace-credential-delete-${credentialId}`)
				.click();
			await expect(admin.page.getByTestId('dialog-confirm')).toBeVisible();
			await admin.page.getByTestId('dialog-confirm').click();
			await expect(admin.page.getByTestId('workspace-credentials-empty')).toBeVisible({
				timeout: 15_000,
			});

			// The delete really removed the row server-side.
			const list = await admin.request.get(
				`/api/workspaces/${workspaceId}/action-credentials`,
				{ headers: SEC_FETCH },
			);
			expect(list.ok()).toBeTruthy();
			const listed = ((await list.json()) ?? []) as Array<Record<string, unknown>>;
			expect(
				listed.some((c) => c.name === `ui credential ${suffix}`),
			).toBe(false);
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});
});
