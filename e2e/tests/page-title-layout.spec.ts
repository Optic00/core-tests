import { createWorkspaceViaAPI } from "../fixtures/api-helpers";
import { expect, test } from "../fixtures/context-path";
import { generateWorkspace } from "../fixtures/test-data";
import { scrollToContent } from "../helpers/scroll-to-content";
import { KnowledgePage } from "../pages/knowledge.page";

test.afterEach(async ({ page }, testInfo) => {
	if (
		testInfo.status === testInfo.expectedStatus ||
		!testInfo.title.startsWith("long page")
	)
		return;
	const layout = await page
		.getByTestId("page-editor")
		.getByText("Final paragraph.", { exact: true })
		.evaluate((el) => {
			const chain = [];
			for (let node = el; node; node = node.parentElement) {
				const rect = node.getBoundingClientRect();
				const css = getComputedStyle(node);
				chain.push({
					tag: node.tagName,
					className: node.className,
					top: rect.top,
					bottom: rect.bottom,
					height: rect.height,
					scrollHeight: node.scrollHeight,
					clientHeight: node.clientHeight,
					scrollTop: node.scrollTop,
					overflowY: css.overflowY,
					flex: css.flex,
				});
			}
			return { chain, fonts: document.fonts.status };
		});
	await testInfo.attach("layout.json", {
		body: JSON.stringify(layout, null, 2),
		contentType: "application/json",
	});
});

for (const width of [1600, 900]) {
	test(`page controls sit above a full-width title at ${width}px`, async ({
		page,
		request,
	}, testInfo) => {
		const workspace = await createWorkspaceViaAPI(
			request,
			generateWorkspace("page-title-layout"),
		);
		try {
			await page.setViewportSize({ width, height: 900 });
			const knowledge = new KnowledgePage(page);
			const title = "Bulk Work Item Operations — API and Atomic Updates";
			await knowledge.createRootPage(String(workspace.id), title);

			for (const mode of ["read", "edit"]) {
				await page.getByTestId(`page-mode-${mode}`).click();
				await expect(page.getByTestId(`page-mode-${mode}`)).toHaveAttribute(
					"aria-pressed",
					"true",
				);
				await expect(knowledge.titleInput).toHaveValue(title);
				await expect
					.poll(async () => {
						const titleBox = await knowledge.titleInput.boundingBox();
						const controls = await page
							.getByTestId("page-mode-toggle")
							.boundingBox();
						if (!titleBox || !controls)
							throw new Error("Title or controls are not rendered");
						return titleBox.y - (controls.y + controls.height);
					})
					.toBeGreaterThanOrEqual(8);
				const titleBox = await knowledge.titleInput.boundingBox();
				const labels = await page.getByTestId("page-label-row").boundingBox();
				if (!titleBox || !labels)
					throw new Error("Title or labels are not rendered");
				expect(titleBox.width).toBeGreaterThan(labels.width * 0.85);
				expect(
					await knowledge.titleInput.evaluate((el) =>
						parseFloat(getComputedStyle(el).fontSize),
					),
				).toBeLessThanOrEqual(28);
			}
			await page.screenshot({ path: testInfo.outputPath("page-title.png") });
		} finally {
			expect(
				(await request.delete(`/api/v2/workspaces/${workspace.id}`)).status(),
			).toBe(204);
		}
	});
}

for (const mode of ["edit", "read"]) {
	test(`long page can scroll to its end in ${mode} mode @critical-browser`, async ({
		page,
		request,
	}, testInfo) => {
		const workspace = await createWorkspaceViaAPI(
			request,
			generateWorkspace("page-content-end"),
		);
		try {
			const response = await request.post(
				`/api/v2/workspaces/${workspace.id}/pages`,
				{
					data: {
						title: "Long document",
						content: `${"# Section\n\nA paragraph of content.\n\n".repeat(80)}Final paragraph.`,
					},
				},
			);
			expect(response.ok()).toBe(true);
			const created = (await response.json()).data;
			await page.setViewportSize({ width: 1280, height: 480 });
			await page.goto(`/workspaces/${workspace.id}/pages/${created.id}`);
			await page.getByTestId(`page-mode-${mode}`).click();
			await expect(page.getByTestId(`page-mode-${mode}`)).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			const final = page
				.getByTestId("page-editor")
				.getByText("Final paragraph.", { exact: true });
			await expect(final).toBeAttached();
			await page.evaluate(() => document.fonts.ready);
			// The document must stay within its canvas, including the last paragraph.
			await expect
				.poll(async () => {
					const canvas = await page.getByTestId("page-canvas").boundingBox();
					const paragraph = await final.boundingBox();
					if (!canvas || !paragraph)
						throw new Error("Document is not rendered");
					return canvas.y + canvas.height - (paragraph.y + paragraph.height);
				})
				.toBeGreaterThanOrEqual(0);
			await scrollToContent(page, page.getByTestId("pages-view"), final);
			await expect(final).toBeInViewport({ ratio: 1 });
			await expect(page.locator("#pages-add-button")).toBeInViewport();
			await page.setViewportSize({ width: 900, height: 320 });
			await scrollToContent(page, page.getByTestId("pages-view"), final);
			await expect(final).toBeInViewport({ ratio: 1 });
			await expect(page.locator("#pages-add-button")).toBeInViewport();
			await page.screenshot({
				path: testInfo.outputPath(`page-content-${mode}.png`),
			});
		} finally {
			expect(
				(await request.delete(`/api/v2/workspaces/${workspace.id}`)).status(),
			).toBe(204);
		}
	});
}
