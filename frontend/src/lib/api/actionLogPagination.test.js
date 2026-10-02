import { afterEach, expect, it, vi } from "vitest";
import { actions } from "./actions.js";

afterEach(() => vi.unstubAllGlobals());

it("loads every action-log page for the client-paginated log table", async () => {
	const logs = Array.from({ length: 101 }, (_, index) => ({
		id: index + 1,
		status: "completed",
	}));
	const fetch = vi.fn(async (url) => {
		const query = new URL(url, "https://windshift.invalid").searchParams;
		const page = Number(query.get("page") || 1);
		const size = Number(query.get("page_size") || 50);
		return new Response(
			JSON.stringify({
				data: logs.slice((page - 1) * size, page * size),
				pagination: {
					page,
					page_size: size,
					total_items: logs.length,
					total_pages: Math.ceil(logs.length / size),
				},
			}),
			{ headers: { "Content-Type": "application/json" } },
		);
	});
	vi.stubGlobal("fetch", fetch);
	expect(await actions.getLogs(7, 8)).toEqual(logs);
	expect(fetch).toHaveBeenCalledTimes(2);
});
