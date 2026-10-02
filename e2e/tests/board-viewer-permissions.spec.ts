import { createItemViaAPI } from '../fixtures/api-helpers';
import { expect, test } from '../fixtures/context-path';
import {
	createGatedWorkspaceWithSessions,
	disposeGatedWorkspace,
	type GatedWorkspace,
} from '../fixtures/role-sessions';
import { generateItem } from '../fixtures/test-data';

/**
 * Board drag affordance vs item.edit.
 *
 * Dropping a card POSTs /items/{id}/transition, which requires item.edit;
 * the seeded Viewer role lacks it, so the drop would be rejected with 404.
 * The UI affordance matches: cards only register with pragmatic-drag-and-drop
 * when the user holds item.edit, so a Viewer's card is never draggable and a
 * drag attempt never sends a transition request. The server-side denial is
 * pinned directly (transition POST → 404, status unchanged).
 */

const SEC_FETCH = { 'Sec-Fetch-Site': 'same-origin' };

interface WorkspaceStatus {
	id: number;
	name: string;
}

async function listWorkspaceStatuses(
	request: import('@playwright/test').APIRequestContext,
	workspaceId: number,
): Promise<WorkspaceStatus[]> {
	const resp = await request.get(`/api/v2/workspaces/${workspaceId}/statuses`, {
		headers: SEC_FETCH,
	});
	expect(resp.ok()).toBeTruthy();
	return ((await resp.json()).data ?? []) as WorkspaceStatus[];
}

test.describe('board drag affordance vs item.edit permission', () => {
	test('viewer card is not draggable', async ({ request, browser }) => {
		test.setTimeout(90_000);
		const suffix = `bdv${Date.now()}`;
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

			await viewer.page.goto(`/workspaces/${workspaceId}/board`);
			const card = viewer.page.getByTestId(`board-item-${item.id}`);
			await expect(card).toBeVisible({ timeout: 15_000 });

			await expect(card).not.toHaveAttribute('draggable', 'true');
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});

	test('viewer drag attempt sends no transition request and the item stays put', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `bdd${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'viewer', role: 'Viewer' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const viewer = sessionsByLabel.viewer;

			const statuses = await listWorkspaceStatuses(request, workspaceId);
			expect(statuses.length).toBeGreaterThanOrEqual(2);
			const fromStatus = statuses[0];
			const toStatus = statuses[1];

			const itemData = generateItem(workspaceId, suffix);
			const item = await createItemViaAPI(request, workspaceId, {
				title: itemData.title,
				description: itemData.description,
			});
			const initialStatusId = item.status_id;

			await viewer.page.goto(`/workspaces/${workspaceId}/board`);
			await expect(viewer.page.getByTestId('board-view')).toBeVisible({
				timeout: 15_000,
			});

			const card = viewer.page.getByTestId(`board-item-${item.id}`);
			await expect(card).toBeVisible({ timeout: 10_000 });
			await expect(card).not.toHaveAttribute('draggable', 'true');
			const sourceColumn = viewer.page.locator(
				`#board-column-status-${fromStatus.id}`,
			);
			const targetColumn = viewer.page.locator(
				`#board-column-status-${toStatus.id}`,
			);
			await expect(sourceColumn).toBeVisible();
			await expect(targetColumn).toBeVisible();

			// Collect any transition requests the drag might trigger.
			const transitionRequests: string[] = [];
			viewer.page.on('request', (req) => {
				if (
					new URL(req.url()).pathname ===
						`/api/v2/items/${item.id}/transition` &&
					req.method() === 'POST'
				) {
					transitionRequests.push(req.url());
				}
			});

			const cardBox = await card.boundingBox();
			const targetBox = await targetColumn.boundingBox();
			if (!cardBox || !targetBox) throw new Error('drag boxes missing');
			const startX = cardBox.x + cardBox.width / 2;
			const startY = cardBox.y + cardBox.height / 2;
			const targetX = targetBox.x + targetBox.width / 2;
			const targetY = targetBox.y + Math.min(targetBox.height / 2, 160);

			await viewer.page.mouse.move(startX, startY);
			await viewer.page.mouse.down();
			await viewer.page.mouse.move(startX + 12, startY + 12);
			await viewer.page.mouse.move(targetX, targetY, { steps: 12 });
			await viewer.page.mouse.up();

			// A reload is the deterministic control event: it happens strictly
			// after anything the drag could have sent, so an empty collector at
			// this point proves no transition request was ever made.
			await viewer.page.reload();
			await expect(viewer.page.getByTestId('board-view')).toBeVisible({
				timeout: 15_000,
			});
			expect(transitionRequests).toEqual([]);

			// The card never left its source column.
			await expect(
				sourceColumn.getByTestId(`board-item-${item.id}`),
			).toBeVisible({ timeout: 10_000 });

			// And the server-side denial contract still holds: a direct
			// transition attempt is rejected with 404 and the item stays put.
			const denied = await viewer.request.post(
				`/api/v2/items/${item.id}/transition`,
				{
					headers: {
						...SEC_FETCH,
						'Content-Type': 'application/json',
					},
					data: { to_status_id: toStatus.id },
				},
			);
			expect(denied.status(), await denied.text()).toBe(404);

			const after = await request.get(`/api/v2/items/${item.id}`, {
				headers: SEC_FETCH,
			});
			expect(after.ok()).toBeTruthy();
			expect((await after.json()).data.status_id).toBe(initialStatusId);
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});
});
