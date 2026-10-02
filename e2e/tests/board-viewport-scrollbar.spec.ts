import {
	authenticateAdminRequest,
	createItemViaAPI,
	createWorkspaceViaAPI,
} from "../fixtures/api-helpers";
import { expect, test } from "../fixtures/context-path";
import { generateItem, generateWorkspace } from "../fixtures/test-data";

/**
 * Board viewport scrolling contract.
 *
 * The board owns both scroll axes inside a viewport-height container, so its
 * horizontal scrollbar sits at the bottom of the viewport — always reachable —
 * and the page-level scroller never moves for the board view. Regression
 * guard: the container used to grow to the full board height, which pushed
 * the horizontal scrollbar to the very bottom of the document, thousands of
 * pixels below the fold.
 */

test.describe.configure({ retries: 0 });

test.describe("Board viewport scrolling", () => {
	test("wide tall board keeps its horizontal scrollbar inside the viewport", async ({
		page,
		request,
	}) => {
		test.setTimeout(60_000);
		await page.setViewportSize({ width: 800, height: 600 });
		await authenticateAdminRequest(request);

		const suffix = `bsc${Date.now()}`;
		const ws = await createWorkspaceViaAPI(request, generateWorkspace(suffix));
		// Enough cards that the board is far taller than the viewport; the old
		// full-height container then pushed its scrollbar below the fold.
		for (let index = 0; index < 20; index++) {
			const itemData = generateItem(ws.id, `${suffix}-${index}`);
			await createItemViaAPI(request, ws.id, { title: itemData.title });
		}

		try {
			await page.goto(`/workspaces/${ws.id}/board`);
			await expect(page.getByTestId("board-view")).toBeVisible({
				timeout: 15_000,
			});
			const scrollContainer = page.getByTestId("board-scroll-container");

			// The container must be the scroller for both axes: content wider
			// than itself (horizontal overflow), content taller than itself
			// (vertical overflow), and a box — therefore scrollbars — that stays
			// inside the viewport.
			const metrics = await scrollContainer.evaluate((element) => ({
				scrollWidth: element.scrollWidth,
				clientWidth: element.clientWidth,
				scrollHeight: element.scrollHeight,
				clientHeight: element.clientHeight,
				bottom: element.getBoundingClientRect().bottom,
				innerHeight: window.innerHeight,
			}));
			expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
			expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
			expect(metrics.bottom).toBeLessThanOrEqual(metrics.innerHeight);

			// The page-level scroller must not scroll for the board view.
			const main = page.getByTestId("main-content-scroll");
			await expect
				.poll(() =>
					main.evaluate(
						(element) =>
							element.scrollHeight <= element.clientHeight + 1 &&
							element.scrollTop === 0,
					),
				)
				.toBe(true);

			// Wheeling over the board scrolls the container itself — first
			// vertically to the summary footer, then horizontally to the
			// rightmost column — while main stays put throughout.
			await scrollContainer.hover();
			await page.mouse.wheel(0, 8000);
			await expect
				.poll(() => scrollContainer.evaluate((el) => el.scrollTop))
				.toBeGreaterThan(0);
			await expect(page.getByTestId("board-summary")).toBeInViewport();
			await expect
				.poll(() => main.evaluate((element) => element.scrollTop))
				.toBe(0);

			await page.mouse.wheel(1200, 0);
			await expect
				.poll(() => scrollContainer.evaluate((el) => el.scrollLeft))
				.toBeGreaterThan(0);
			await expect(page.getByTestId("board-column").last()).toBeInViewport();
			await expect
				.poll(() => main.evaluate((element) => element.scrollTop))
				.toBe(0);
		} finally {
			expect(
				(await request.delete(`/api/v2/workspaces/${ws.id}`)).status(),
			).toBe(204);
		}
	});
});
