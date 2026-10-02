import { randomUUID } from "node:crypto";
import {
	createItemViaAPI,
	createUserViaAPI,
	createWorkspaceViaAPI,
} from "../fixtures/api-helpers";
import { test as base, expect, type Page } from "../fixtures/context-path";
import { generateUser } from "../fixtures/test-data";

const headers = { "Sec-Fetch-Site": "same-origin" };
const notificationWait = 40_000; // Allow one production notification polling interval.

const test = base.extend<{
	watched: { watcher: Page; item: { id: number; title: string }; path: string };
}>({
	watched: async ({ request, browser }, use) => {
		const stamp = randomUUID().slice(0, 8);
		const cleanup: Array<() => Promise<void>> = [];
		const remove = (path: string) => {
			cleanup.push(async () => {
				const response = await request.delete(path, { headers });
				expect(response.ok(), await response.text()).toBeTruthy();
			});
		};
		try {
			const credentials = generateUser(`watch${stamp}`);
			const user = await createUserViaAPI(request, credentials);
			remove(`/api/users/${user.id}`);
			const workspace = await createWorkspaceViaAPI(request, {
				name: `Watcher notifications ${stamp}`,
				key: `WN${stamp}`.toUpperCase(),
			});
			remove(`/api/v2/workspaces/${workspace.id}`);

			const rolesResponse = await request.get("/api/workspace-roles");
			expect(rolesResponse.ok()).toBeTruthy();
			const roles = await rolesResponse.json();
			const viewer = roles.find(
				(role: { name: string }) => role.name === "Viewer",
			);
			expect(viewer).toBeDefined();
			const assignment = await request.post("/api/workspace-roles/assign", {
				headers,
				data: {
					workspace_id: workspace.id,
					user_id: user.id,
					role_id: viewer.id,
				},
			});
			expect(assignment.ok(), await assignment.text()).toBeTruthy();

			// Only watching can select this recipient; creator and assignee delivery are disabled.
			const settingResponse = await request.post("/api/notification-settings", {
				headers,
				data: {
					name: `Watchers only ${stamp}`,
					created_by: user.id,
					is_active: true,
					event_rules: ["comment.created", "item.updated"].map((eventType) => ({
						event_type: eventType,
						is_enabled: true,
						notify_watchers: true,
						message_template: `${eventType}\n{item.title}`,
					})),
				},
			});
			expect(settingResponse.ok(), await settingResponse.text()).toBeTruthy();
			const setting = await settingResponse.json();
			remove(`/api/notification-settings/${setting.id}`);
			const configResponse = await request.post("/api/configuration-sets", {
				headers,
				data: {
					name: `Watcher configuration ${stamp}`,
					workspace_ids: [workspace.id],
					notification_setting_id: setting.id,
				},
			});
			expect(configResponse.ok(), await configResponse.text()).toBeTruthy();
			const config = await configResponse.json();
			remove(`/api/configuration-sets/${config.id}`);

			const item = await createItemViaAPI(request, workspace.id, {
				title: `Watched ${stamp}`,
			});
			const context = await browser.newContext({
				baseURL: process.env.BASE_URL || "http://localhost:8080",
				storageState: { cookies: [], origins: [] },
			});
			cleanup.push(() => context.close());
			const login = await context.request.post("/api/auth/login", {
				headers,
				data: {
					email_or_username: credentials.username,
					password: credentials.password_hash,
				},
			});
			expect(login.ok(), await login.text()).toBeTruthy();
			const watcher = await context.newPage();
			const path = `/workspaces/${workspace.id}/items/${item.id}`;
			await watcher.goto(path);
			await expect(watcher.getByTestId("item-detail-ready")).toBeVisible();
			await watcher.getByTestId("item-detail-actions-menu").click();
			await expect(watcher.getByTestId("item-watch-toggle")).toHaveText(
				"Watch Work Item",
			);
			const watchSaved = watcher.waitForResponse(
				(response) =>
					response.request().method() === "PUT" &&
					new URL(response.url()).pathname.endsWith(
						`/api/v2/items/${item.id}/watch`,
					) &&
					response.ok(),
			);
			await watcher.getByTestId("item-watch-toggle").click();
			await watchSaved;
			await watcher.reload();
			await watcher.getByTestId("item-detail-actions-menu").click();
			await expect(watcher.getByTestId("item-watch-toggle")).toContainText(
				"Unwatch",
			);

			// Leave the item so opening it cannot automatically mark the new notification read.
			await watcher.goto("/");
			await watcher.getByTestId("notifications-trigger").click();
			await expect(watcher.getByTestId("notifications-menu")).toBeVisible();
			await expect(watcher.getByTestId(/^notification-card-/)).toHaveCount(0);
			await use({ watcher, item, path });
		} finally {
			for (const release of cleanup.reverse()) await release();
		}
	},
});

for (const action of ["comment", "edit"] as const) {
	test(`watcher receives and opens a notification when another user ${action === "comment" ? "comments" : "edits the title"}`, async ({
		page,
		watched: { watcher, item, path },
	}) => {
		await page.goto(path);
		await expect(page.getByTestId("item-title-edit")).toHaveText(item.title);
		const updatedTitle = `${item.title} updated`;
		const comment = `Comment for ${item.title}`;
		if (action === "comment") {
			await expect(page.getByTestId("comment-composer")).toHaveAttribute(
				"data-ready",
				"true",
			);
			await page.getByTestId("comment-editor").click();
			await page.keyboard.insertText(comment);
			await expect(page.getByTestId("comment-editor")).toContainText(comment);
			await expect(page.getByTestId("comment-submit")).toBeEnabled();
			await page.keyboard.press("ControlOrMeta+Enter");
			await expect(page.getByTestId("comment-item")).toHaveCount(1);
			await expect(page.getByTestId("comment-item")).toContainText(comment);
		} else {
			await page.getByTestId("item-title-edit").click();
			await page.getByTestId("item-title-input").fill(updatedTitle);
			await page.getByTestId("item-title-input").press("Enter");
			await expect(page.getByTestId("item-title-edit")).toHaveText(
				updatedTitle,
			);
		}

		const notification = watcher.getByTestId(/^notification-card-/);
		await expect(notification).toHaveCount(1, { timeout: notificationWait });
		await expect(notification).toContainText(
			action === "comment" ? "comment.created" : "item.updated",
		);
		await expect(notification).toContainText(
			action === "comment" ? item.title : updatedTitle,
		);
		await expect(notification).toHaveAttribute("data-read", "false");
		await notification.click();
		await expect(watcher).toHaveURL(new RegExp(`${path}$`));
		// The fixture's watcher is a workspace Viewer (no item.edit), so the
		// title renders read-only instead of the click-to-edit button (WI-1434).
		await expect(watcher.getByTestId("item-title-readonly")).toHaveText(
			action === "comment" ? item.title : updatedTitle,
		);
		if (action === "comment")
			await expect(watcher.getByTestId("comment-item")).toContainText(comment);

		await watcher.reload();
		await watcher.getByTestId("notifications-trigger").click();
		await expect(watcher.getByTestId(/^notification-card-/)).toHaveAttribute(
			"data-read",
			"true",
		);
	});
}
