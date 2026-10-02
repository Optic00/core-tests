import {
	createItemViaAPI,
	createPriorityViaAPI,
	createWorkspaceViaAPI,
} from "../fixtures/api-helpers";
import { expect, test } from "../fixtures/context-path";

/**
 * GH #262 / WI-1348: the list view's column headers sort server-side. Clicking
 * a sortable header orders the rows by that column and toggles direction.
 */
test.describe("List view column sorting", () => {
	test("sorts by priority asc then desc from the header", async ({ page, request }) => {
		const stamp = Date.now();
		const workspace = await createWorkspaceViaAPI(request, {
			name: `list-sort-${stamp}`,
			key: `LS${stamp.toString().slice(-6)}`.toUpperCase(),
			description: "WI-1348 list view sorting",
		});

		// Distinct sort_order per priority so server ordering is unambiguous.
		const low = await createPriorityViaAPI(request, {
			name: `Low ${stamp}`, sort_order: 10,
		});
		const mid = await createPriorityViaAPI(request, {
			name: `Mid ${stamp}`, sort_order: 20,
		});
		const high = await createPriorityViaAPI(request, {
			name: `High ${stamp}`, sort_order: 30,
		});

		const titles = { [low.id]: "LowPrio", [mid.id]: "MidPrio", [high.id]: "HighPrio" };
		for (const priority of [low, mid, high]) {
			await createItemViaAPI(request, workspace.id, {
				title: `${titles[priority.id]} ${stamp}`,
				priority_id: priority.id,
			});
		}

		await page.goto(`/workspaces/${workspace.id}/list`);
		const rows = page.getByTestId(/^workspace-item-row-/);
		await expect(rows).toHaveCount(3);

		const orderTitles = () =>
			rows.evaluateAll((elements) =>
				elements.map((element) => element.textContent ?? ""),
			);
		const contains = (haystacks: string[], needle: string) =>
			haystacks.findIndex((haystack) => haystack.includes(needle));
		const isOrdered = async (first: string, second: string) => {
			const titlesInOrder = await orderTitles();
			return (
				contains(titlesInOrder, first) !== -1 &&
				contains(titlesInOrder, first) < contains(titlesInOrder, second)
			);
		};

		// Ascending: lowest sort_order first.
		await page.getByTestId("list-sort-priority").click();
		await expect.poll(() => isOrdered("LowPrio", "MidPrio")).toBe(true);
		await expect.poll(() => isOrdered("MidPrio", "HighPrio")).toBe(true);

		// Second click flips to descending.
		await page.getByTestId("list-sort-priority").click();
		await expect.poll(() => isOrdered("HighPrio", "MidPrio")).toBe(true);
		await expect.poll(() => isOrdered("MidPrio", "LowPrio")).toBe(true);
	});
});
