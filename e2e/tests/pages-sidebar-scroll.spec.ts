import { createWorkspaceViaAPI } from "../fixtures/api-helpers";
import { expect, test } from "../fixtures/context-path";
import { generateWorkspace } from "../fixtures/test-data";
import { KnowledgePage } from "../pages/knowledge.page";

test.describe.configure({ retries: 0 });

test("scrolls a long page tree with no selected page and after opening a page", async ({
	page,
	request,
}) => {
	await page.setViewportSize({ width: 1280, height: 600 });
	const workspace = await createWorkspaceViaAPI(
		request,
		generateWorkspace("pages-scroll"),
	);
	try {
		const ids: number[] = [];
		for (let index = 0; index < 30; index++) {
			const response = await request.post(
				`/api/v2/workspaces/${workspace.id}/pages`,
				{
					data: {
						title: `Page ${String(index).padStart(2, "0")}`,
						content: "",
					},
				},
			);
			expect(response.ok(), await response.text()).toBeTruthy();
			ids.push((await response.json()).data.id);
		}

		const knowledge = new KnowledgePage(page);
		await knowledge.gotoIndex(String(workspace.id));
		await expect(page.getByTestId("pages-view")).toBeVisible();
		await expect(knowledge.titleInput).toHaveCount(0);
		const scroll = page.getByTestId("pages-navigation-scroll");
		const lastPage = knowledge
			.treeItem(ids[ids.length - 1])
			.getByTestId("page-tree-page");
		await expect(lastPage).toBeAttached();
		await expect(lastPage).not.toBeInViewport();
		await scroll.hover();
		await page.mouse.wheel(0, 3000);
		await expect(lastPage).toBeInViewport();
		await expect(knowledge.addButton).toBeInViewport();

		await lastPage.click();
		await expect(knowledge.titleInput).toHaveValue("Page 29");
		await scroll.hover();
		await page.mouse.wheel(0, -3000);
		await expect(
			knowledge.treeItem(ids[0]).getByTestId("page-tree-page"),
		).toBeInViewport();
		await expect(knowledge.titleInput).toBeInViewport();
	} finally {
		const response = await request.delete(`/api/v2/workspaces/${workspace.id}`);
		expect(response.ok(), await response.text()).toBeTruthy();
	}
});
