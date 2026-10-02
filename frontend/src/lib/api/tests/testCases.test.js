import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../core.js", () => ({
	fetchAllV2Pages: vi.fn(),
	fetchAPIV2: vi.fn(),
	fetchV2Data: vi.fn(),
}));

vi.mock("../createCrudClient.js", () => ({
	createCrudClient: vi.fn(() => ({})),
}));

const { fetchAllV2Pages, fetchAPIV2, fetchV2Data } = await import("../core.js");
const { testCases } = await import("./testCases.js");

describe("test cases API", () => {
	beforeEach(() => {
		fetchAllV2Pages.mockReset();
		fetchAPIV2.mockReset();
		fetchV2Data.mockReset();
	});

	it("drains every page when a caller requests all test cases", async () => {
		await testCases.getAll(7, { all: true, q: "checkout" });

		expect(fetchAllV2Pages).toHaveBeenCalledWith(
			"/workspaces/7/test-cases?all=true&q=checkout",
		);
		expect(fetchV2Data).not.toHaveBeenCalled();
	});

	it("keeps explicitly paged test-case reads on one canonical page", async () => {
		await testCases.getAll(7, { folder_id: null, limit: 25, offset: 50 });

		expect(fetchV2Data).toHaveBeenCalledWith(
			"/workspaces/7/test-cases?folder_id=null&page_size=25&page=3",
		);
		expect(fetchAllV2Pages).not.toHaveBeenCalled();
	});

	it("reads the total count from the canonical test-case collection", async () => {
		fetchAPIV2.mockResolvedValue({ pagination: { total_items: 37 } });

		await expect(testCases.count(7)).resolves.toEqual({ count: 37 });
		expect(fetchAPIV2).toHaveBeenCalledWith(
			"/workspaces/7/test-cases?all=true&page=1&page_size=1",
		);
	});
});

it("treats all as folder scope when a caller explicitly requests a page", async () => {
	fetchV2Data.mockReset();
	fetchAllV2Pages.mockReset();
	fetchV2Data.mockResolvedValue([{ id: 101 }]);
	const result = await testCases.getAll(7, {
		all: true,
		limit: 100,
		offset: 100,
	});
	expect(fetchV2Data).toHaveBeenCalledWith(
		"/workspaces/7/test-cases?all=true&page_size=100&page=2",
	);
	expect(fetchAllV2Pages).not.toHaveBeenCalled();
	expect(result).toEqual([{ id: 101 }]);
});
