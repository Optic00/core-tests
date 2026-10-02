import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import IterationBurndown from "./IterationBurndown.svelte";

beforeEach(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it("switches remaining and ideal chart values between items and fractional story points", async () => {
	render(IterationBurndown, {
		data: {
			total_items: 4,
			data_points: [
				{
					date: "2026-07-01",
					remaining: 4,
					completed: 0,
					ideal: 4,
					remaining_points: 10.5,
					completed_points: 0,
					ideal_points: 10.5,
				},
				{
					date: "2026-07-02",
					remaining: 3,
					completed: 1,
					ideal: 2,
					remaining_points: 8,
					completed_points: 2.5,
					ideal_points: 5.25,
				},
			],
		},
	});
	const selector = screen.getByTestId("iteration-burndown-metric");
	expect(selector).toHaveValue("items");
	expect(screen.getByLabelText("07/02: 3")).toBeInTheDocument();
	await fireEvent.change(selector, { target: { value: "points" } });
	expect(screen.getByLabelText("07/02: 8")).toBeInTheDocument();
	expect(screen.getByLabelText("07/02: 5.25")).toBeInTheDocument();
	expect(screen.queryByLabelText("07/02: 3")).not.toBeInTheDocument();
	await fireEvent.change(selector, { target: { value: "items" } });
	expect(screen.getByLabelText("07/02: 3")).toBeInTheDocument();
	expect(screen.getByLabelText("07/02: 2")).toBeInTheDocument();
});

it("hides the chart when fewer than two days are available", () => {
	render(IterationBurndown, { data: { data_points: [] } });
	expect(
		screen.queryByTestId("iteration-burndown-metric"),
	).not.toBeInTheDocument();
});
