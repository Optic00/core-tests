import { createWorkspaceViaAPI } from "../fixtures/api-helpers";
import { expect, test } from "../fixtures/context-path";
import { generateWorkspace } from "../fixtures/test-data";
import { WorkspaceSettingsPage } from "../pages/workspace-settings.page";

/**
 * Workspace admin navigation (folded sidebar).
 *
 * The workspace admin area no longer uses horizontal tabs — clicking into
 * Settings swaps the workspace sidebar for a folded admin nav (back link +
 * one link per module), and each module renders as a standard page with a
 * PageHeader. These tests pin that behavior.
 */

const MODULES: Array<{ id: string }> = [
	{ id: "general" },
	{ id: "categories" },
	{ id: "members" },
	{ id: "configuration" },
	{ id: "source-control" },
	{ id: "issue-sync" },
	{ id: "recurrence" },
	{ id: "danger" },
];

test.describe("Workspace admin folded sidebar", () => {
	let settingsPage: WorkspaceSettingsPage;
	let workspaceId: string;

	test.beforeEach(async ({ page, request }) => {
		settingsPage = new WorkspaceSettingsPage(page);
		const workspace = await createWorkspaceViaAPI(request, generateWorkspace());
		workspaceId = String(workspace.id);
	});

	test.afterEach(async ({ request }) => {
		const response = await request.delete(`/api/v2/workspaces/${workspaceId}`);
		expect(response.status()).toBe(204);
	});

	test("swaps the sidebar for the admin nav with a back link and every module", async ({
		page,
	}) => {
		await settingsPage.goto(workspaceId);

		// Folded admin sidebar + back link present; old horizontal tablist gone.
		await expect(page.getByTestId("workspace-admin-nav")).toBeVisible({
			timeout: 5000,
		});
		await expect(page.getByTestId("workspace-back-link")).toBeVisible();
		await expect(page.locator('[role="tablist"]')).toHaveCount(0);

		// One nav link per module.
		for (const m of MODULES) {
			await expect(
				page.getByTestId(`workspace-admin-nav-${m.id}`),
			).toBeVisible();
		}
	});

	test("each module routes to its own page with a header", async ({ page }) => {
		await settingsPage.goto(workspaceId);

		for (const m of MODULES) {
			await page.getByTestId(`workspace-admin-nav-${m.id}`).click();
			await expect(page).toHaveURL(
				new RegExp(`/workspaces/${workspaceId}/settings/${m.id}$`),
			);
			await expect(
				page.getByTestId(`workspace-settings-module-${m.id}`),
			).toBeVisible();
		}
	});

	test("back link returns to the workspace and restores the normal sidebar", async ({
		page,
	}) => {
		await settingsPage.goto(workspaceId);
		await expect(page.getByTestId("workspace-admin-nav")).toBeVisible({
			timeout: 5000,
		});

		await page.getByTestId("workspace-back-link").click();
		// The workspace root redirects to its default view (e.g. /board), so just
		// assert we left the settings area and the admin nav is gone.
		await expect(page).toHaveURL(
			new RegExp(`/workspaces/${workspaceId}(/(?!settings)[^/]*)?$`),
		);
		await expect(page.getByTestId("workspace-admin-nav")).toHaveCount(0);
	});

	test("collapsed sidebar shows the module icons and a back arrow", async ({
		page,
	}) => {
		// Seed the collapsed state before the app mounts.
		await page.addInitScript(() => {
			localStorage.setItem("windshift-ws-sidebar-collapsed", "true");
		});
		await settingsPage.goto(workspaceId);

		// Back arrow (to the workspace) + an icon link per module, by href.
		await expect(page.getByTestId("workspace-back-link")).toBeVisible({
			timeout: 5000,
		});
		for (const m of MODULES) {
			await expect(
				page.getByTestId(`workspace-admin-nav-${m.id}`),
			).toBeVisible();
		}
	});
});
