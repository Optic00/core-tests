import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

const { store } = vi.hoisted(() => ({
	store: {
		backlogItems: [
			{ id: 1, title: "First item" },
			{ id: 2, title: "Second item" },
		],
		backlogPagination: { total_items: 293 },
		collectionTotal: 1299,
		backlogHasMore: true,
		loading: false,
		loadMoreBacklog: vi.fn(),
	},
}));

vi.mock("../../stores/collectionContext.js", () => ({
	collectionStore: store,
	refreshCollectionDeltas: vi.fn(),
	reloadCollection: vi.fn(),
}));
vi.mock("../../stores/index.js", () => ({
	backlogStore: { setCount: vi.fn() },
	workspaceDataStore: {
		workspace: { id: 1, name: "Workspace" },
		itemTypes: [],
		statuses: [],
		statusCategories: [],
		initialize: vi.fn(),
	},
}));
vi.mock("../../api.js", () => ({
	api: {
		screens: { getAllWithFields: vi.fn().mockResolvedValue([]) },
		iterations: { getAll: vi.fn().mockResolvedValue([]) },
	},
}));
vi.mock("../../stores/workspaceGradient.svelte.js", () => ({
	useGradientStyles: () => ({}),
	loadWorkspaceGradient: vi.fn(),
}));
vi.mock("../../composables/useWorkItemPoller.svelte.js", () => ({
	useWorkItemPoller: vi.fn(),
}));
vi.mock("../../stores/i18n.svelte.js", () => ({
	t: (key, params = {}) =>
		({
			"layout.items": "items",
			"collections.itemsShown": `${params.count} shown`,
			"collections.showingItemsFromBacklog": `Showing ${params.count} items from backlog`,
			"common.loadMore": "Load more",
			"common.remaining": "remaining",
		})[key] ?? key,
}));
vi.mock(
	"./BacklogIterationSection.svelte",
	() => import("./EmptyBacklogChild.svelte"),
);
vi.mock("./SubFilterBar.svelte", () => import("./EmptyBacklogChild.svelte"));
vi.mock(
	"./CollectionViewSwitcher.svelte",
	() => import("./EmptyBacklogChild.svelte"),
);
vi.mock(
	"../../pickers/ItemPicker.svelte",
	() => import("./EmptyBacklogChild.svelte"),
);
vi.mock(
	"../items/ItemDetail.svelte",
	() => import("./EmptyBacklogChild.svelte"),
);
vi.mock(
	"../../dialogs/CompleteIterationDialog.svelte",
	() => import("./EmptyBacklogChild.svelte"),
);

import CollectionBacklog from "./CollectionBacklog.svelte";

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe("backlog counts", () => {
	it.each([
		[293, [], "293 items · 2 shown", "291 remaining"],
		[2, [], "2 items", null],
		[293, ["unassigned"], "293 items · 0 shown", "291 remaining"],
		[null, [], "2 items", null],
	])(
		"uses backlog totals and visible rows with total %s and collapsed %j",
		async (total, collapsed, summary, remaining) => {
			store.backlogPagination = total === null ? null : { total_items: total };
			store.backlogHasMore = total > store.backlogItems.length;
			localStorage.setItem(
				"backlog-collapsed-sections-1",
				JSON.stringify(collapsed),
			);
			render(CollectionBacklog, { workspaceId: 1 });

			expect(
				await screen.findByTestId("page-header-subtitle"),
			).toHaveTextContent(`Workspace • ${summary}`);
			expect(screen.getByTestId("backlog-count-summary")).toHaveTextContent(
				summary,
			);
			if (remaining) {
				expect(
					screen.getByText(`Load more (${remaining})`),
				).toBeInTheDocument();
			} else {
				expect(screen.queryByText(/Load more/)).not.toBeInTheDocument();
			}
		},
	);
});
