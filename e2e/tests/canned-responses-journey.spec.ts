import {
	createItemViaAPI,
	createWorkspaceViaAPI,
} from "../fixtures/api-helpers";
import { expect, test } from "../fixtures/context-path";

/**
 * WI-1138: a workspace manager creates a canned response in settings, then an
 * agent picks it from the comment composer and posts it as a comment.
 */
test.describe("canned responses journey", () => {
	test("manager creates a snippet and an agent inserts it into a comment", async ({
		page,
		request,
	}) => {
		const stamp = Date.now();
		const workspace = await createWorkspaceViaAPI(request, {
			name: `canned-${stamp}`,
			key: `CR${stamp.toString().slice(-6)}`.toUpperCase(),
			description: "WI-1138 canned responses",
		});
		const item = await createItemViaAPI(request, workspace.id, {
			title: `Canned journey ${stamp}`,
		});

		// Manager creates the canned response in workspace settings.
		await page.goto(`/workspaces/${workspace.id}/settings/canned-responses`);
		await expect(page.getByTestId("canned-response-add")).toBeVisible({
			timeout: 15_000,
		});
		await page.getByTestId("canned-response-add").click();
		await page.getByTestId("canned-response-name").fill(`greeting-${stamp}`);
		await page
			.getByTestId("canned-response-body")
			.fill("Hello from the canned journey");
		await page.getByTestId("canned-response-save").click();

		const row = page.getByTestId("canned-response-row");
		await expect(row).toContainText(`greeting-${stamp}`);
		await expect(row).toContainText("Public");

		// Agent opens the item and inserts the snippet from the composer.
		await page.goto(`/workspaces/${workspace.id}/items/${item.id}`);
		const section = page.getByTestId("comments-section");
		await expect(section).toBeVisible({ timeout: 15_000 });

		await page.getByTestId("canned-response-picker").click();
		const option = page
			.getByTestId("canned-response-picker-menu")
			.getByText(`greeting-${stamp}`);
		await expect(option).toBeVisible({ timeout: 15_000 });
		await option.click();

		await expect(page.getByTestId("comment-composer")).toContainText(
			"Hello from the canned journey",
		);
		await expect(page.getByTestId("comment-submit")).toBeEnabled();
		await page.getByTestId("comment-submit").click();

		await expect(section.getByTestId("comment-item")).toHaveCount(1);
		await expect(section.getByTestId("comment-item")).toContainText(
			"Hello from the canned journey",
		);
	});
});
