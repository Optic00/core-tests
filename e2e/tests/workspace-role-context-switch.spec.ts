import { createItemViaAPI, createWorkspaceViaAPI } from '../fixtures/api-helpers';
import { expect, test } from '../fixtures/context-path';
import {
	assignWorkspaceRole,
	createWorkspaceUser,
	openSession,
	type SessionUser,
} from '../fixtures/role-sessions';
import { generateItem, generateWorkspace } from '../fixtures/test-data';

/**
 * Per-workspace role context — one session, two workspaces, two roles.
 *
 * The permission profile store is keyed by workspace, so a user who is
 * Viewer in workspace A and Editor in workspace B must see A's read-only
 * affordances and B's editing affordances in the same browser session, and
 * the gating must follow every workspace switch.
 *
 * Gating under test:
 *   - item.edit: the "move to workspace" entry in the item actions menu is
 *     canEdit-gated (ItemDetail.svelte) — Viewer: hidden, Editor: shown.
 *   - item.edit: the inline title edit affordance is canEdit-gated
 *     (ItemDetailHeader.svelte) — Viewer: read-only title, Editor: button.
 *   - item.create: the board quick-add affordance is canCreate-gated
 *     (CollectionBoard/QuickAddForm) — Viewer: hidden, Editor: shown.
 */

const SEC_FETCH = { 'Sec-Fetch-Site': 'same-origin' };

interface SwitchFixture {
	workspaceAId: number;
	workspaceBId: number;
	itemAId: number;
	itemBId: number;
	userIds: number[];
	session: SessionUser;
}

async function createSwitchFixture(
	request: import('@playwright/test').APIRequestContext,
	browser: import('@playwright/test').Browser,
	suffix: string,
): Promise<SwitchFixture> {
	const workspaceA = await createWorkspaceViaAPI(
		request,
		generateWorkspace(`${suffix}a`),
	);
	const workspaceB = await createWorkspaceViaAPI(
		request,
		generateWorkspace(`${suffix}b`),
	);
	const userIds: number[] = [];

	// Gate both workspaces so only explicit roles apply.
	for (const [label, workspace] of [
		['a', workspaceA],
		['b', workspaceB],
	] as const) {
		const gateUser = await createWorkspaceUser(request, `${suffix}-gate-${label}`);
		userIds.push(gateUser.id);
		await assignWorkspaceRole(request, gateUser.id, workspace.id, 'Viewer');
	}

	const user = await createWorkspaceUser(request, suffix);
	userIds.push(user.id);
	await assignWorkspaceRole(request, user.id, workspaceA.id, 'Viewer');
	await assignWorkspaceRole(request, user.id, workspaceB.id, 'Editor');

	const session = await openSession(browser, user);

	const itemA = await createItemViaAPI(request, workspaceA.id, {
		title: generateItem(workspaceA.id, suffix).title,
	});
	const itemB = await createItemViaAPI(request, workspaceB.id, {
		title: generateItem(workspaceB.id, suffix).title,
	});

	return {
		workspaceAId: workspaceA.id,
		workspaceBId: workspaceB.id,
		itemAId: itemA.id,
		itemBId: itemB.id,
		userIds,
		session,
	};
}

async function disposeSwitchFixture(
	request: import('@playwright/test').APIRequestContext,
	fixture: SwitchFixture,
): Promise<void> {
	await fixture.session.context.close();
	for (const workspaceId of [fixture.workspaceAId, fixture.workspaceBId]) {
		const resp = await request.delete(`/api/v2/workspaces/${workspaceId}`, {
			headers: SEC_FETCH,
		});
		expect(resp.status(), `delete workspace ${workspaceId}`).toBe(204);
	}
	for (const userId of fixture.userIds) {
		const resp = await request.delete(`/api/users/${userId}`, {
			headers: SEC_FETCH,
		});
		expect(resp.ok(), `delete user ${userId}`).toBeTruthy();
	}
}

test.describe('per-workspace role gating in one session', () => {
	test('item actions menu follows item.edit per workspace across switches', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `rcs${Date.now()}`;
		let fixture: SwitchFixture | undefined;
		try {
			fixture = await createSwitchFixture(request, browser, suffix);
			const { session, workspaceAId, workspaceBId, itemAId, itemBId } = fixture;

			// Viewer workspace: no move affordance in the actions menu.
			await session.page.goto(`/workspaces/${workspaceAId}/items/${itemAId}`);
			await expect(session.page.getByTestId('item-detail-ready')).toBeVisible({
				timeout: 15_000,
			});
			await session.page.getByTestId('item-detail-actions-menu').click();
			await expect(session.page.getByTestId('item-move-workspace-open')).toHaveCount(0);

			// Editor workspace in the same session: move affordance present.
			await session.page.goto(`/workspaces/${workspaceBId}/items/${itemBId}`);
			await expect(session.page.getByTestId('item-detail-ready')).toBeVisible({
				timeout: 15_000,
			});
			await session.page.getByTestId('item-detail-actions-menu').click();
			await expect(session.page.getByTestId('item-move-workspace-open')).toBeVisible();

			// Back to the Viewer workspace: gating flips back, proving the
			// affordance is re-derived per workspace and not cached from B.
			await session.page.goto(`/workspaces/${workspaceAId}/items/${itemAId}`);
			await expect(session.page.getByTestId('item-detail-ready')).toBeVisible({
				timeout: 15_000,
			});
			await session.page.getByTestId('item-detail-actions-menu').click();
			await expect(session.page.getByTestId('item-move-workspace-open')).toHaveCount(0);
		} finally {
			if (fixture) await disposeSwitchFixture(request, fixture);
		}
	});

	test('item title edit affordance follows item.edit per workspace across switches', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `rct${Date.now()}`;
		let fixture: SwitchFixture | undefined;
		try {
			fixture = await createSwitchFixture(request, browser, suffix);
			const { session, workspaceAId, workspaceBId, itemAId, itemBId } = fixture;

			// Viewer workspace: title renders read-only, no edit affordance.
			await session.page.goto(`/workspaces/${workspaceAId}/items/${itemAId}`);
			await expect(session.page.getByTestId('item-detail-ready')).toBeVisible({
				timeout: 15_000,
			});
			await expect(session.page.getByTestId('item-title-edit')).toHaveCount(0);
			await expect(session.page.getByTestId('item-title-readonly')).toBeVisible();

			// Editor workspace in the same session: click-to-edit button present.
			await session.page.goto(`/workspaces/${workspaceBId}/items/${itemBId}`);
			await expect(session.page.getByTestId('item-detail-ready')).toBeVisible({
				timeout: 15_000,
			});
			await expect(session.page.getByTestId('item-title-edit')).toBeVisible();
			await expect(session.page.getByTestId('item-title-readonly')).toHaveCount(0);

			// Back to the Viewer workspace: gating flips back with the switch.
			await session.page.goto(`/workspaces/${workspaceAId}/items/${itemAId}`);
			await expect(session.page.getByTestId('item-detail-ready')).toBeVisible({
				timeout: 15_000,
			});
			await expect(session.page.getByTestId('item-title-edit')).toHaveCount(0);
			await expect(session.page.getByTestId('item-title-readonly')).toBeVisible();
		} finally {
			if (fixture) await disposeSwitchFixture(request, fixture);
		}
	});

	test('board quick-add affordance follows item.create per workspace', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);

		const suffix = `rcq${Date.now()}`;
		let fixture: SwitchFixture | undefined;
		try {
			fixture = await createSwitchFixture(request, browser, suffix);
			const { session, workspaceAId, workspaceBId } = fixture;

			// Viewer workspace: no quick-add affordance on any column.
			await session.page.goto(`/workspaces/${workspaceAId}/board`);
			await expect(session.page.getByTestId('board-view')).toBeVisible({
				timeout: 15_000,
			});
			await expect(session.page.getByTestId(/^board-column-add-/)).toHaveCount(0);

			// Editor workspace in the same session: quick-add is offered.
			await session.page.goto(`/workspaces/${workspaceBId}/board`);
			await expect(session.page.getByTestId('board-view')).toBeVisible({
				timeout: 15_000,
			});
			await expect(
				session.page.getByTestId(/^board-column-add-/).first(),
			).toBeVisible();

			// Back to the Viewer workspace: still no quick-add.
			await session.page.goto(`/workspaces/${workspaceAId}/board`);
			await expect(session.page.getByTestId('board-view')).toBeVisible({
				timeout: 15_000,
			});
			await expect(session.page.getByTestId(/^board-column-add-/)).toHaveCount(0);
		} finally {
			if (fixture) await disposeSwitchFixture(request, fixture);
		}
	});
});
