import {
	authenticateAdminRequest,
	createCollectionViaAPI,
	createWorkspaceViaAPI,
} from "../fixtures/api-helpers";
import { expect, test } from "../fixtures/context-path";
import { generateWorkspace } from "../fixtures/test-data";

test.describe("Board view settings", () => {
	test("workspace toggle hides nav views, redirects disabled URLs, and restores", async ({
		page,
		request,
	}) => {
		await authenticateAdminRequest(request);
		const stamp = Date.now();
		const workspace = await createWorkspaceViaAPI(
			request,
			generateWorkspace(`view-settings-${stamp}`),
		);
		const collection = await createCollectionViaAPI(request, {
			name: `Views inherited ${stamp}`,
			workspace_id: workspace.id,
			ql_query: "",
		});

		await page.goto(`/workspaces/${workspace.id}/board/configure`);
		await page.getByTestId("board-config-views-tab").click();
		await expect(page.getByTestId("view-toggle-map")).toBeEnabled();
		await page.getByTestId("view-toggle-map").click();
		await page.getByTestId("view-toggle-tree").click();
		await page.getByTestId("board-config-save").click();

		await expect(page.getByTestId("workspace-nav-map")).toHaveCount(0);
		await expect(page.getByTestId("workspace-nav-tree")).toHaveCount(0);
		await expect(page.getByTestId("workspace-nav-board")).toBeVisible();

		// Direct navigation to a disabled view falls back to the default view.
		await page.goto(`/workspaces/${workspace.id}/map`);
		await expect(page).toHaveURL(
			new RegExp(`/workspaces/${workspace.id}/board$`),
		);

		// The inheriting collection hides the same views and redirects too.
		await page.goto(
			`/workspaces/${workspace.id}/collections/${collection.id}/list`,
		);
		await expect(page.getByTestId("workspace-nav-map")).toHaveCount(0);
		await page.goto(
			`/workspaces/${workspace.id}/collections/${collection.id}/tree`,
		);
		await expect(page).toHaveURL(
			new RegExp(
				`/workspaces/${workspace.id}/collections/${collection.id}/board$`,
			),
		);

		// Re-enabling restores the navigation entries.
		await page.goto(`/workspaces/${workspace.id}/board/configure`);
		await page.getByTestId("board-config-views-tab").click();
		await expect(page.getByTestId("view-toggle-map")).toBeEnabled();
		await page.getByTestId("view-toggle-map").click();
		await page.getByTestId("view-toggle-tree").click();
		await page.getByTestId("board-config-save").click();
		await expect(page.getByTestId("workspace-nav-map")).toBeVisible();
		await expect(page.getByTestId("workspace-nav-tree")).toBeVisible();
	});

	test("collection override hides a view only in that collection and reset restores it", async ({
		page,
		request,
	}) => {
		await authenticateAdminRequest(request);
		const stamp = Date.now();
		const workspace = await createWorkspaceViaAPI(
			request,
			generateWorkspace(`view-override-${stamp}`),
		);
		const collection = await createCollectionViaAPI(request, {
			name: `Views override ${stamp}`,
			workspace_id: workspace.id,
			ql_query: "",
		});

		await page.goto(
			`/workspaces/${workspace.id}/collections/${collection.id}/board/configure`,
		);
		await page.getByTestId("board-config-views-tab").click();

		// While inheriting there is nothing to reset; overriding shows the reset.
		await expect(page.getByTestId("board-config-views-reset")).toHaveCount(0);
		await expect(page.getByTestId("view-toggle-tree")).toBeEnabled();
		await page.getByTestId("view-toggle-tree").click();
		await expect(page.getByTestId("board-config-views-reset")).toBeVisible();
		await page.getByTestId("board-config-save").click();

		// The collection hides tree; the workspace default context keeps it.
		await expect(page.getByTestId("workspace-nav-tree")).toHaveCount(0);
		await page.goto(`/workspaces/${workspace.id}/board`);
		await expect(page.getByTestId("workspace-nav-tree")).toBeVisible();

		// Resetting inherits the workspace set again.
		await page.goto(
			`/workspaces/${workspace.id}/collections/${collection.id}/board/configure`,
		);
		await page.getByTestId("board-config-views-tab").click();
		await page.getByTestId("board-config-views-reset").click();
		await page.getByTestId("board-config-save").click();
		await expect(page.getByTestId("workspace-nav-tree")).toBeVisible();
	});
});
