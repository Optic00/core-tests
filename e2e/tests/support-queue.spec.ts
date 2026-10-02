import {
	authenticateAdminRequest,
	createItemViaAPI,
	createTeamViaAPI,
	createWorkspaceViaAPI,
} from '../fixtures/api-helpers';
import { expect, test } from '../fixtures/errors';

const QUEUE_KEYS = [
	'unassigned',
	'team-owned',
	'assigned-to-me',
	'waiting',
	'overdue',
	'recently-updated',
	'sla-at-risk',
];

async function currentUserId(request: import('@playwright/test').APIRequestContext) {
	const response = await request.get(
		`${process.env.BASE_URL || 'http://localhost:8080'}/api/auth/me`,
	);
	expect(response.ok()).toBeTruthy();
	const session = await response.json();
	return session?.user?.id ?? session?.id ?? null;
}

test.describe('support queue views', () => {
	test('renders the stable catalog, switches queues, and runs a bulk assignment', async ({
		page,
		request,
	}, testInfo) => {
		const stamp = `${Date.now()}${testInfo.workerIndex}${testInfo.repeatEachIndex}`;
		await authenticateAdminRequest(request);
		const adminId = await currentUserId(request);
		const workspace = await createWorkspaceViaAPI(request, {
			name: `support-queue-${stamp}`,
			key: `SQ${stamp.slice(-6)}`.toUpperCase(),
			description: 'support queue e2e',
		});

		const team = await createTeamViaAPI(request, { name: `Queue Team ${stamp}` });

		// One unowned ticket (unassigned queue), one team-owned ticket
		// (team-owned queue), one overdue ticket (no assignee or team either,
		// so it also matches the unassigned queue), one assigned ticket.
		const orphan = await createItemViaAPI(request, workspace.id, {
			title: `Orphan ticket ${stamp}`,
		});
		await createItemViaAPI(request, workspace.id, {
			title: `Team ticket ${stamp}`,
			team_id: team.id,
		});
		const overdue = await createItemViaAPI(request, workspace.id, {
			title: `Overdue ticket ${stamp}`,
			due_date: '2026-01-01T00:00:00Z',
		} as never);
		await createItemViaAPI(request, workspace.id, {
			title: `Mine ticket ${stamp}`,
			assignee_id: adminId,
		});

		await page.goto(`/workspaces/${workspace.id}/queue`);
		await expect(page.getByTestId('support-queue-tabs')).toBeVisible({ timeout: 10_000 });

		// The catalog renders every queue in its stable order.
		const tabs = page.getByRole('tab');
		await expect(tabs).toHaveCount(QUEUE_KEYS.length);
		for (const [index, key] of QUEUE_KEYS.entries()) {
			await expect(tabs.nth(index)).toHaveAttribute('data-testid', `support-queue-tab-${key}`);
		}

		// The unassigned queue opens by default and shows the orphan plus the
		// overdue ticket, which has no assignee or team either.
		await expect(page.getByTestId('support-queue-tab-unassigned')).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expect(page.getByTestId(`support-queue-count-unassigned`)).toHaveText('2');
		await expect(page.getByTestId(`support-queue-row-${orphan.id}`)).toBeVisible();
		await expect(page.getByTestId(`support-queue-row-${overdue.id}`)).toBeVisible();
		await expect(page.getByTestId('support-queue-empty')).toBeHidden();

		// The team-owned queue shows only the team ticket.
		await page.getByTestId('support-queue-tab-team-owned').click();
		await expect(page.getByTestId('support-queue-tab-team-owned')).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expect(page.getByTestId('support-queue-count-team-owned')).toHaveText('1');

		// Bulk-safe action: assign the orphan to the current agent. The server
		// re-checks authorization per workspace; the queues refresh afterwards.
		await page.getByTestId('support-queue-tab-unassigned').click();
		await expect(page.getByTestId(`support-queue-row-${orphan.id}`)).toBeVisible();
		await page.getByTestId(`support-queue-item-checkbox-${orphan.id}`).check();
		await expect(page.getByTestId('support-queue-bulk-bar')).toBeVisible();
		await page.getByTestId('support-queue-bulk-assign-me').click();

		await expect(page.getByTestId('support-queue-count-unassigned')).toHaveText('1', {
			timeout: 10_000,
		});

		// The orphan moved into assigned-to-me; the overdue ticket stays put.
		await expect(page.getByTestId(`support-queue-row-${overdue.id}`)).toBeVisible();
		await expect(page.getByTestId(`support-queue-row-${orphan.id}`)).toBeHidden();
		await expect(page.getByTestId('support-queue-count-assigned-to-me')).toHaveText('2');
		await page.getByTestId('support-queue-tab-assigned-to-me').click();
		await expect(page.getByTestId(`support-queue-row-${orphan.id}`)).toBeVisible();

		// Deep links open the requested queue directly.
		await page.goto(`/workspaces/${workspace.id}/queue?queue=team-owned`);
		await expect(page.getByTestId('support-queue-tab-team-owned')).toHaveAttribute(
			'aria-selected',
			'true',
			{ timeout: 10_000 },
		);
	});
});
