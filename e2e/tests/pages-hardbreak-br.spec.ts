import { createWorkspaceViaAPI } from "../fixtures/api-helpers";
import { expect, test } from "../fixtures/context-path";
import { KnowledgePage } from "../pages/knowledge.page";
import { generateWorkspace } from "../fixtures/test-data";

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };

test.describe("Pages — <br /> html becomes hard breaks in the visual editor", () => {
	test("stored br spellings render as line breaks, not literal text", async ({
		page,
		request,
	}) => {
		// WI-1331: Milkdown serializes mid-paragraph hard breaks as `<br />`
		// html but only parsed remark `break` nodes, so every save left the
		// raw tag visible in the editor forever. A span must stay literal
		// (existing raw-html contract).
		const workspace = await createWorkspaceViaAPI(
			request,
			generateWorkspace("pages-br"),
		);
		const createResponse = await request.post(
			`/api/v2/workspaces/${workspace.id}/pages`,
			{
				headers: SEC_FETCH,
				data: {
					title: `br spellings ${Date.now()}`,
					// The shape Milkdown itself produces: block-level br lines
					// between paragraphs (dev-database pages store exactly this)
					// plus an inline spelling and a real hard break as control.
					content:
						"This is a test\n\n<br />\n\nAnother test\n\nInline <br/> break\n\nReal  \nhard break\n",
				},
			},
		);
		expect(createResponse.ok()).toBeTruthy();
		const created = (await createResponse.json()).data;

		const knowledge = new KnowledgePage(page);
		await knowledge.gotoPage(workspace.id, created.id);
		await knowledge.editor.waitFor({ state: "visible", timeout: 10_000 });

		// Every br spelling became a real hard break in ProseMirror…
		await expect(knowledge.editor.locator("br[data-type='hardbreak']")).toHaveCount(3);

		// …none of them shows as literal text…
		await expect(knowledge.editor).not.toContainText("<br");
	});
});
