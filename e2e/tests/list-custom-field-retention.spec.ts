import { expect, test } from "../fixtures/context-path";
import {
	createCustomFieldViaAPI,
	createItemViaAPI,
	createWorkspaceViaAPI,
	deleteCustomFieldViaAPI,
} from "../fixtures/api-helpers";
import { generateWorkspace } from "../fixtures/test-data";

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };

/**
 * List-view inline edits send only the edited custom-field key; the server
 * merges custom_field_values per field and preserves untouched keys (pinned
 * by tests/custom_field_value_retention_test.go). This spec asserts that
 * contract end-to-end in the browser: the PATCH carries exactly the edited
 * key, and after a reload the row still holds every other field's value.
 */
test.describe("List view custom field edit retention", () => {
	test("editing one list cell keeps the row's other custom-field values", async ({
		page,
		request,
	}) => {
		const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
		const createdFieldIds: number[] = [];

		const workspace = await createWorkspaceViaAPI(
			request,
			generateWorkspace(`cf-retain-${suffix}`.slice(0, 60)),
		);

		const keepField = await createCustomFieldViaAPI(request, {
			name: `Keep me ${suffix}`,
			field_type: "text",
			required: false,
		});
		createdFieldIds.push(keepField.id);
		const editField = await createCustomFieldViaAPI(request, {
			name: `Edit me ${suffix}`,
			field_type: "text",
			required: false,
		});
		createdFieldIds.push(editField.id);

		const configResponse = await request.put(
			`/api/v2/workspaces/${workspace.id}/board-configuration`,
			{
				headers: SEC_FETCH,
				data: {
					columns: [],
					backlog_status_ids: [],
					list_columns: [
						{
							field_identifier: "key",
							field_type: "system",
							display_order: 0,
							width: 1,
						},
						{
							field_identifier: "title",
							field_type: "system",
							display_order: 1,
							width: 4,
						},
						{
							field_identifier: String(keepField.id),
							field_type: "custom",
							display_order: 2,
							width: 2,
						},
						{
							field_identifier: String(editField.id),
							field_type: "custom",
							display_order: 3,
							width: 2,
						},
					],
				},
			},
		);
		expect(
			configResponse.ok(),
			`save list config: ${configResponse.status()} ${await configResponse.text()}`,
		).toBeTruthy();

		const item = await createItemViaAPI(request, workspace.id, {
			title: `Retention item ${suffix}`,
			custom_field_values: {
				[String(keepField.id)]: "keep me",
				[String(editField.id)]: "initial value",
			},
		});

		try {
			await page.goto(`/workspaces/${workspace.id}/list`);

			const keepCell = page.getByTestId(`list-custom-field-${keepField.id}-${item.id}`);
			await expect(keepCell).toBeVisible({ timeout: 10000 });
			await expect(keepCell).toContainText("keep me");

			// Open the edit-field cell and commit a new value with Enter.
			await page.getByTestId(`list-custom-field-${editField.id}-${item.id}`).click();
			const input = page.getByTestId(`custom-field-input-${editField.id}`);
			await expect(input).toBeVisible();
			await input.fill("edited value");

			const patchPromise = page.waitForResponse(
				(response) =>
					response.request().method() === "PATCH" &&
					/\/api\/v2\/items\/\d+$/.test(response.url()),
			);
			await input.press("Enter");
			const patch = await patchPromise;
			expect(
				patch.ok(),
				`custom field save: ${patch.status()} ${await patch.text()}`,
			).toBeTruthy();

			// The list view sends exactly the edited key; per-field merge
			// server-side preserves the rest.
			const payload = (await patch.request().postDataJSON()) as {
				custom_field_values: Record<string, unknown>;
			};
			expect(Object.keys(payload.custom_field_values)).toEqual([
				String(editField.id),
			]);
			expect(payload.custom_field_values[String(editField.id)]).toBe("edited value");

			// Prove persistence: after a reload both values survive server-side.
			await page.reload();
			const reloadedKeepCell = page.getByTestId(
				`list-custom-field-${keepField.id}-${item.id}`,
			);
			await expect(reloadedKeepCell).toBeVisible({ timeout: 10000 });
			await expect(reloadedKeepCell).toContainText("keep me");
			await expect(
				page.getByTestId(`list-custom-field-${editField.id}-${item.id}`),
			).toContainText("edited value");
		} finally {
			for (const fieldId of createdFieldIds.reverse()) {
				await deleteCustomFieldViaAPI(request, fieldId).catch(() => {});
			}
		}
	});
});
