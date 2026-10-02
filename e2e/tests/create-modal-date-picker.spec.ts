import { createWorkspaceViaAPI } from "../fixtures/api-helpers";
import {
	type APIRequestContext,
	expect,
	test,
} from "../fixtures/context-path";
import { generateWorkspace } from "../fixtures/test-data";

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };

async function configureCreateLabels(
	request: APIRequestContext,
	workspaceId: number,
) {
	const itemTypesResponse = await request.get("/api/v2/item-types", {
		headers: SEC_FETCH,
	});
	expect(itemTypesResponse.ok()).toBeTruthy();
	const itemTypes = (await itemTypesResponse.json()).data;
	const itemTypeId = itemTypes[0]?.id;
	expect(itemTypeId).toBeGreaterThan(0);

	const screenResponse = await request.post("/api/screens", {
		headers: SEC_FETCH,
		data: { name: `Create label regression ${Date.now()}` },
	});
	expect(screenResponse.ok()).toBeTruthy();
	const screen = await screenResponse.json();

	const fieldsResponse = await request.put(`/api/screens/${screen.id}/fields`, {
		headers: SEC_FETCH,
		data: [
			{
				field_type: "system",
				field_identifier: "labels",
				display_order: 0,
				is_required: false,
				field_width: "full",
			},
		],
	});
	expect(fieldsResponse.ok()).toBeTruthy();

	const configurationResponse = await request.post("/api/configuration-sets", {
		headers: SEC_FETCH,
		data: {
			name: `Create label config ${Date.now()}`,
			workspace_ids: [workspaceId],
			create_screen_id: screen.id,
			edit_screen_id: screen.id,
			view_screen_id: screen.id,
			item_type_configs: [
				{
					item_type_id: itemTypeId,
					create_screen_id: screen.id,
					edit_screen_id: screen.id,
					view_screen_id: screen.id,
				},
			],
		},
	});
	expect(configurationResponse.ok()).toBeTruthy();
}

test("create modal sets and submits an optional due date", async ({
	page,
	request,
}) => {
	const workspace = await createWorkspaceViaAPI(
		request,
		generateWorkspace("date-picker"),
	);

	try {
		await page.addInitScript(() => {
			const testWindow = window as typeof window & {
				__createDatePickerOpenCount: number;
			};
			Object.defineProperty(window, "__createDatePickerOpenCount", {
				configurable: true,
				writable: true,
				value: 0,
			});
			HTMLInputElement.prototype.showPicker = function showPicker() {
				testWindow.__createDatePickerOpenCount += 1;
			};
		});
		await page.goto(`/workspaces/${workspace.id}/backlog`);

		await page.locator("#global-create-button").click();

		const dueDateChip = page.getByTestId("create-due-date-chip");
		await expect(dueDateChip).toBeVisible({ timeout: 10_000 });
		await dueDateChip.click();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as typeof window & { __createDatePickerOpenCount: number })
							.__createDatePickerOpenCount,
				),
			)
			.toBe(1);

		const dueDate = "2026-09-15";
		const dueDateInput = page.getByTestId("create-due-date-input");
		await expect(dueDateInput).toBeVisible();
		await dueDateInput.click();
		await dueDateInput.fill(dueDate);

		// Native date inputs can emit change while the user is still editing a
		// segmented value, so the editor must remain available after the change.
		await expect(dueDateInput).toBeVisible();
		await expect(dueDateChip).toHaveAttribute("data-value", dueDate);
		await page.locator("#work-item-title").click();
		await expect(dueDateInput).toBeHidden();

		await page.locator("#work-item-title").fill("Due-date picker regression");
		const createResponsePromise = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" &&
				/\/api\/v2\/items$/.test(response.url()),
		);
		await page.locator("#create-modal-submit").click();

		const createResponse = await createResponsePromise;
		expect(createResponse.ok()).toBeTruthy();
		expect(createResponse.request().postDataJSON()).toMatchObject({
			due_date: new Date(dueDate).toISOString(),
		});
	} finally {
		await request.delete(`/api/v2/workspaces/${workspace.id}`, {
			headers: SEC_FETCH,
		});
	}
});

test("create modal submits labels in one item mutation", async ({
	page,
	request,
}) => {
	const workspace = await createWorkspaceViaAPI(
		request,
		generateWorkspace("single-mutation"),
	);
	await configureCreateLabels(request, workspace.id);

	const labelResponse = await request.post(
		`/api/v2/workspaces/${workspace.id}/labels`,
		{
			headers: SEC_FETCH,
			data: { name: `Single mutation ${Date.now()}` },
		},
	);
	expect(labelResponse.ok()).toBeTruthy();
	const label = (await labelResponse.json()).data;

	const itemMutations: Array<{ method: string; url: string; body: unknown }> = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (
			/\/api\/v2\/items(?:\/\d+(?:\/labels)?)?$/.test(url.pathname) &&
			["POST", "PATCH", "PUT"].includes(request.method())
		) {
			itemMutations.push({
				method: request.method(),
				url: url.pathname,
				body: request.postDataJSON(),
			});
		}
	});

	await page.goto(`/workspaces/${workspace.id}/backlog`);
	await page.locator("#global-create-button").click();
	await page.locator("#work-item-title").fill("Single item mutation regression");
	await page.getByTestId("create-additional-fields-toggle").click();
	await page.locator("#create-label-picker-input").click();
	await page.getByTestId(`create-label-picker-option-${label.id}`).click();
	const createResponsePromise = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			/\/api\/v2\/items$/.test(response.url()),
	);
	await page.locator("#create-modal-submit").click();

	const createResponse = await createResponsePromise;
	expect(createResponse.ok()).toBeTruthy();
	await expect(page.locator("#create-modal-submit")).toBeHidden();
	expect(itemMutations).toEqual([
		expect.objectContaining({
			method: "POST",
			url: "/api/v2/items",
			body: expect.objectContaining({ label_ids: [label.id] }),
		}),
	]);
});
