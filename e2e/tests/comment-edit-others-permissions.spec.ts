import { createItemViaAPI } from '../fixtures/api-helpers';
import { expect, test } from '../fixtures/context-path';
import {
	createGatedWorkspaceWithSessions,
	disposeGatedWorkspace,
	type GatedWorkspace,
} from '../fixtures/role-sessions';
import { generateItem } from '../fixtures/test-data';

/**
 * comment.edit_others — UI affordances must match the permission.
 *
 * Server contract (internal/restapi/v2/comments.go requireCommentEdit): the
 * author of a comment, or any user holding comment.edit_others in the
 * workspace, may edit/delete it; everyone else gets 404. The seeded
 * Administrator workspace role carries comment.edit_others, Editor does not.
 *
 * Scenarios:
 *   1. An Editor sees edit/delete affordances on their own comment only, and
 *      a direct edit of another author's comment is denied with 404.
 *   2. A workspace Administrator (comment.edit_others) sees edit/delete
 *      affordances on another author's comment.
 */

const SEC_FETCH = { 'Sec-Fetch-Site': 'same-origin' };

test.describe('comment edit/delete affordances vs comment.edit_others', () => {
	test('editor sees edit affordances only on own comments; foreign edit is denied 404', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);
		const suffix = `ceo${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'author', role: 'Editor' },
				{ label: 'editor', role: 'Editor' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const author = sessionsByLabel.author;
			const editor = sessionsByLabel.editor;

			const itemData = generateItem(workspaceId, suffix);
			const item = await createItemViaAPI(request, workspaceId, {
				title: itemData.title,
			});

			const authorComment = await author.request.post(
				`/api/v2/items/${item.id}/comments`,
				{
					headers: SEC_FETCH,
					data: { content: `author comment ${suffix}`, is_private: false },
				},
			);
			expect(authorComment.status(), await authorComment.text()).toBe(201);
			const authorCommentId = (await authorComment.json()).data.id;

			const editorComment = await editor.request.post(
				`/api/v2/items/${item.id}/comments`,
				{
					headers: SEC_FETCH,
					data: { content: `editor comment ${suffix}`, is_private: false },
				},
			);
			expect(editorComment.status()).toBe(201);

			await editor.page.goto(`/workspaces/${workspaceId}/items/${item.id}`);
			await expect(editor.page.getByTestId('item-detail-ready')).toBeVisible({
				timeout: 15_000,
			});
			await expect(editor.page.getByTestId('comment-item')).toHaveCount(2, {
				timeout: 15_000,
			});

			// Comments render oldest-first (Comments.svelte sortOrder default).
			const authorRow = editor.page.getByTestId('comment-item').first();
			const ownRow = editor.page.getByTestId('comment-item').nth(1);

			// Editor without comment.edit_others: no affordances on the
			// author's comment…
			await expect(authorRow.getByTestId('comment-edit')).toHaveCount(0);
			await expect(authorRow.getByTestId('comment-delete')).toHaveCount(0);
			// …but full affordances on their own comment.
			await expect(ownRow.getByTestId('comment-edit')).toHaveCount(1);
			await expect(ownRow.getByTestId('comment-delete')).toHaveCount(1);

			// The server side of the same contract: editing a foreign comment
			// without the permission is a 404, not a silent success.
			const denied = await editor.request.patch(
				`/api/v2/comments/${authorCommentId}`,
				{
					headers: {
						...SEC_FETCH,
						'Content-Type': 'application/merge-patch+json',
					},
					data: { content: 'unauthorized edit' },
				},
			);
			expect(denied.status(), await denied.text()).toBe(404);
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});

	test('comment.edit_others holder sees edit/delete affordances on foreign comments', async ({
		request,
		browser,
	}) => {
		test.setTimeout(90_000);

		const suffix = `ceoa${Date.now()}`;
		let fixture: GatedWorkspace | undefined;
		try {
			fixture = await createGatedWorkspaceWithSessions(request, browser, suffix, [
				{ label: 'author', role: 'Editor' },
				{ label: 'admin', role: 'Administrator' },
			]);
			const { workspaceId, sessionsByLabel } = fixture;
			const author = sessionsByLabel.author;
			const admin = sessionsByLabel.admin;

			const itemData = generateItem(workspaceId, suffix);
			const item = await createItemViaAPI(request, workspaceId, {
				title: itemData.title,
			});

			const authorComment = await author.request.post(
				`/api/v2/items/${item.id}/comments`,
				{
					headers: SEC_FETCH,
					data: { content: `author comment ${suffix}`, is_private: false },
				},
			);
			expect(authorComment.status()).toBe(201);

			await admin.page.goto(`/workspaces/${workspaceId}/items/${item.id}`);
			await expect(admin.page.getByTestId('item-detail-ready')).toBeVisible({
				timeout: 15_000,
			});
			const authorRow = admin.page.getByTestId('comment-item').first();
			await expect(authorRow).toBeVisible({ timeout: 15_000 });

			await expect(authorRow.getByTestId('comment-edit')).toHaveCount(1);
			await expect(authorRow.getByTestId('comment-delete')).toHaveCount(1);
		} finally {
			if (fixture) await disposeGatedWorkspace(request, fixture);
		}
	});
});
