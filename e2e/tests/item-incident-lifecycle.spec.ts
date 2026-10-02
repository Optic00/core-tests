import { createItemViaAPI, createTeamViaAPI, createWorkspaceViaAPI } from "../fixtures/api-helpers";
import { type APIRequestContext, expect, test } from "../fixtures/context-path";
import { generateTeam, generateWorkspace } from "../fixtures/test-data";

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };

const STATUS_LABELS: Record<string, string> = {
	triggered: "Triggered",
	acknowledged: "Acknowledged",
	resolved: "Resolved",
};

async function createPolicy(request: APIRequestContext, teamId: number, name: string) {
	const response = await request.post(`/api/teams/${teamId}/on-call/escalation-policies`, {
		headers: SEC_FETCH,
		data: { name, repeat_count: 1 },
	});
	expect(
		response.ok(),
		`create policy: ${response.status()} ${await response.text()}`,
	).toBeTruthy();
	return response.json();
}

test.describe("Item incident lifecycle", () => {
	test("declares, acknowledges, resolves, and persists an incident on a work item", async ({
		page,
		request,
	}) => {
		const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
		const workspace = await createWorkspaceViaAPI(
			request,
			generateWorkspace(`inc-${suffix}`),
		);
		const team = await createTeamViaAPI(request, generateTeam(`inc-${suffix}`));
		await createPolicy(request, team.id, `Incident policy ${suffix}`);

		const item = await createItemViaAPI(request, workspace.id, {
			title: `Incident item ${suffix}`,
			team_id: team.id,
		});

		await page.goto(`/workspaces/${workspace.id}/items/${item.id}`);

		const panel = page.getByTestId("item-incident-panel");
		const trigger = page.getByTestId("item-incident-trigger");
		await expect(trigger).toBeVisible();

		const triggerResponse = page.waitForResponse(
			(res) =>
				res.request().method() === "POST" &&
				/\/api\/items\/\d+\/incident$/.test(res.url()),
		);
		await trigger.click();
		expect((await triggerResponse).status()).toBe(201);

		await expect(panel).toBeVisible();
		await expect(panel.getByTestId("item-incident-status")).toHaveText(
			STATUS_LABELS.triggered,
		);

		const ackResponse = page.waitForResponse(
			(res) =>
				res.request().method() === "POST" &&
				/\/api\/items\/\d+\/incident\/acknowledge$/.test(res.url()),
		);
		await page.getByTestId("item-incident-acknowledge").click();
		expect((await ackResponse).status()).toBe(200);
		await expect(panel.getByTestId("item-incident-status")).toHaveText(
			STATUS_LABELS.acknowledged,
		);

		const resolveResponse = page.waitForResponse(
			(res) =>
				res.request().method() === "POST" &&
				/\/api\/items\/\d+\/incident\/resolve$/.test(res.url()),
		);
		await page.getByTestId("item-incident-resolve").click();
		expect((await resolveResponse).status()).toBe(200);
		await expect(panel.getByTestId("item-incident-status")).toHaveText(
			STATUS_LABELS.resolved,
		);

		// Reload to prove the resolved state was persisted, not just optimistic.
		await page.reload();
		await expect(page.getByTestId("item-incident-panel").getByTestId("item-incident-status")).toHaveText(
			STATUS_LABELS.resolved,
		);
	});
});
