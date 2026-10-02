import { describe, expect, test } from "vitest";
import {
	workspaceOnlyViews,
	workspaceSettingsItems,
	workspaceViewItems,
} from "./workspaceNavigation.js";

describe("Agent Studio workspace navigation", () => {
	test("keeps Agents in the workspace tools group", () => {
		expect(workspaceViewItems.some((item) => item.id === "agents")).toBe(false);
		// The queue is also a workspace-only tool, so locate Agents by id
		// rather than by position in the list.
		const agents = workspaceOnlyViews.find((item) => item.id === "agents");
		expect(agents).toEqual(
			expect.objectContaining({
				id: "agents",
				labelKey: "users.agents.title",
				testId: "workspace-nav-agents",
				activeViews: [
					"workspace-agents",
					"workspace-agent-profile",
					"workspace-agent-create",
				],
			}),
		);
		expect(
			workspaceSettingsItems.some((item) => item.id === "coding-agents"),
		).toBe(false);
	});
});
