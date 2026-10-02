import {
	createItemViaAPI,
	createWorkspaceViaAPI,
} from "../fixtures/api-helpers";
import { expect, test } from "../fixtures/context-path";
import { generateWorkspace } from "../fixtures/test-data";
import { scrollToContent } from "../helpers/scroll-to-content";

for (const surface of ["page", "modal"]) {
	test(`long item description and edit actions remain reachable in ${surface} @critical-browser`, async ({
		page,
		request,
	}) => {
		const workspace = await createWorkspaceViaAPI(
			request,
			generateWorkspace("editor-scroll"),
		);
		try {
			const item = await createItemViaAPI(request, workspace.id, {
				title: "Long description",
				description: `${"A paragraph of work item content.\n\n".repeat(60)}Final description paragraph.`,
			});
			await page.setViewportSize({ width: 1280, height: 480 });
			if (surface === "modal") {
				await page.goto(`/workspaces/${workspace.id}/board`);
				await page.getByTestId(`board-item-${item.id}`).click();
			} else {
				await page.goto(`/workspaces/${workspace.id}/items/${item.id}`);
			}
			const description = page.getByTestId("item-description-display");
			await expect(description).toContainText("Final description paragraph.");
			await page.evaluate(() => document.fonts.ready);
			const end = description.getByText("Final description paragraph.", {
				exact: true,
			});
			await scrollToContent(page, description, end);
			await expect(end).toBeInViewport({ ratio: 1 });
			await description.click({ position: { x: 20, y: 20 } });
			const editor = page.getByTestId("item-description-editor");
			await expect(editor).toContainText("Final description paragraph.");
			const save = page.getByTestId("item-description-save");
			await scrollToContent(page, editor, save);
			await expect(save).toBeInViewport({ ratio: 1 });
			await save.click();
			await expect(description).toContainText("Final description paragraph.");
		} finally {
			expect(
				(await request.delete(`/api/v2/workspaces/${workspace.id}`)).status(),
			).toBe(204);
		}
	});
}
