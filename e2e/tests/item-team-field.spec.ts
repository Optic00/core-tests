import { createItemViaAPI, createTeamViaAPI, createWorkspaceViaAPI } from "../fixtures/api-helpers";
import { type APIRequestContext, expect, test } from "../fixtures/context-path";
import { generateTeam, generateWorkspace } from "../fixtures/test-data";

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };

async function createScreen(request: APIRequestContext, name: string) {
	const response = await request.post("/api/screens", {
		headers: SEC_FETCH,
		data: { name, description: "E2E team field screen" },
	});
	expect(
		response.ok(),
		`create screen: ${response.status()} ${await response.text()}`,
	).toBeTruthy();
	return response.json();
}

// The UI reads system-field rows from the screen's `fields`, not the legacy
// `system_fields` list, so the team field is added as a system field row.
async function addTeamFieldToScreen(request: APIRequestContext, screenId: number) {
	const response = await request.put(`/api/screens/${screenId}/fields`, {
		headers: SEC_FETCH,
		data: [
			{
				field_type: "system",
				field_identifier: "team",
				display_order: 0,
				is_required: false,
				field_width: "full",
			},
		],
	});
	expect(
		response.ok(),
		`add team screen field: ${response.status()} ${await response.text()}`,
	).toBeTruthy();
}

async function createConfigurationSet(
	request: APIRequestContext,
	data: {
		name: string;
		description: string;
		workspace_ids: number[];
		create_screen_id: number;
		edit_screen_id: number;
		view_screen_id: number;
	},
) {
	const response = await request.post("/api/configuration-sets", {
		headers: SEC_FETCH,
		data,
	});
	expect(
		response.ok(),
		`create configuration set: ${response.status()} ${await response.text()}`,
	).toBeTruthy();
	return response.json();
}

test.describe("Item team system field", () => {
	test("is absent by default and assignable once added to a screen", async ({
		page,
		request,
	}) => {
		const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
		const workspace = await createWorkspaceViaAPI(
			request,
			generateWorkspace(`team-${suffix}`),
		);
		const team = await createTeamViaAPI(request, generateTeam(`team-${suffix}`));
		const screen = await createScreen(request, `Team field screen ${suffix}`);

		// Team is a system field that must be added to a screen manually.
		await addTeamFieldToScreen(request, screen.id);

		const configSet = await createConfigurationSet(request, {
			name: `Team field config ${suffix}`,
			description: "Binds a screen that includes the team system field",
			workspace_ids: [workspace.id],
			create_screen_id: screen.id,
			edit_screen_id: screen.id,
			view_screen_id: screen.id,
		});

		const item = await createItemViaAPI(request, workspace.id, {
			title: `Team field item ${suffix}`,
		});

		try {
			await page.goto(`/workspaces/${workspace.id}/items/${item.id}`);

			const field = page.getByTestId("item-team-field");
			await expect(field).toBeVisible();

			await field.click();
			const option = page.getByTestId(`team-picker-option-${team.id}`);
			await expect(option).toBeVisible();

			const updateResponse = page.waitForResponse(
				(res) =>
					res.request().method() === "PATCH" &&
					/\/api\/v2\/items\/\d+$/.test(res.url()),
			);
			await option.click();
			const response = await updateResponse;
			expect(response.ok(), `team save: ${response.status()}`).toBeTruthy();
			expect(JSON.parse(response.request().postData() ?? "{}").team_id).toBe(
				team.id,
			);
			const patched = (await response.json()).data;
			expect(
				{ id: patched.team_id, name: patched.team_name },
				`PATCH response team = ${JSON.stringify(patched.team_id)}/${JSON.stringify(patched.team_name)}`,
			).toEqual({ id: team.id, name: team.name });

			await expect(field).toContainText(team.name);

			// Reload to prove the assignment persisted, not just optimistic.
			await page.reload();
			await expect(page.getByTestId("item-team-field")).toContainText(team.name);
		} finally {
			await request
				.delete(`/api/configuration-sets/${configSet.id}`, { headers: SEC_FETCH })
				.catch(() => {});
			await request
				.delete(`/api/screens/${screen.id}`, { headers: SEC_FETCH })
				.catch(() => {});
		}
	});
});
