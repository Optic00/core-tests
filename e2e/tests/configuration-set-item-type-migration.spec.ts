import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { createWorkspaceViaAPI } from "../fixtures/api-helpers";
import { expect, test } from "../fixtures/context-path";
import { shot } from "../helpers/screenshot";

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };

type ItemType = {
	id: number;
	name: string;
	hierarchy_level: number;
};

type Fixture = {
	workspaceId: number;
	configSetId: number;
	itemId: number;
	sourceType: ItemType;
	sameLevelTarget?: ItemType;
	otherLevelType: ItemType;
};

async function createItemType(
	request: APIRequestContext,
	name: string,
	hierarchyLevel: number,
	sortOrder: number,
): Promise<ItemType> {
	const response = await request.post("/api/v2/item-types", {
		headers: SEC_FETCH,
		data: {
			name,
			description: "Configuration-set item-type migration E2E",
			is_default: false,
			icon: "Circle",
			color: "#2563eb",
			hierarchy_level: hierarchyLevel,
			sort_order: sortOrder,
		},
	});
	expect(
		response.ok(),
		`create item type ${name}: ${response.status()} ${await response.text()}`,
	).toBeTruthy();
	return (await response.json()).data;
}

async function buildFixture(
	request: APIRequestContext,
	withSameLevelTarget: boolean,
): Promise<Fixture> {
	const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
	const sourceType = await createItemType(
		request,
		`Config removal source ${suffix}`,
		3,
		201,
	);
	const sameLevelTarget = withSameLevelTarget
		? await createItemType(request, `Config removal target ${suffix}`, 3, 202)
		: undefined;
	const otherLevelType = await createItemType(
		request,
		`Config other level ${suffix}`,
		2,
		203,
	);
	const workspace = await createWorkspaceViaAPI(request, {
		name: `Config type migration ${suffix}`,
		key: `CM${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`,
		description: "Configuration-set item-type migration E2E",
	});

	const configuredTypes = [
		sourceType,
		...(sameLevelTarget ? [sameLevelTarget] : []),
		otherLevelType,
	];
	const configResponse = await request.post("/api/configuration-sets", {
		headers: SEC_FETCH,
		data: {
			name: `Config type migration ${suffix}`,
			description: "Configuration-set item-type migration E2E",
			workspace_ids: [workspace.id],
			item_type_configs: configuredTypes.map((itemType) => ({
				item_type_id: itemType.id,
			})),
		},
	});
	expect(
		configResponse.ok(),
		`create configuration set: ${configResponse.status()} ${await configResponse.text()}`,
	).toBeTruthy();
	const configSet = await configResponse.json();

	const itemResponse = await request.post("/api/v2/items", {
		headers: SEC_FETCH,
		data: {
			workspace_id: workspace.id,
			title: `Item using removed type ${suffix}`,
			item_type_id: sourceType.id,
		},
	});
	expect(
		itemResponse.ok(),
		`create item: ${itemResponse.status()} ${await itemResponse.text()}`,
	).toBeTruthy();
	const item = (await itemResponse.json()).data;

	return {
		workspaceId: workspace.id,
		configSetId: configSet.id,
		itemId: item.id,
		sourceType,
		sameLevelTarget,
		otherLevelType,
	};
}

async function removeSourceTypeAndSave(
	page: import("@playwright/test").Page,
	fixture: Fixture,
): Promise<void> {
	await page.goto(`/admin/configuration-sets/${fixture.configSetId}`);
	await page.getByTestId("config-set-tab-item-types").click();
	await expect(
		page.getByTestId(`item-types-assigned-${fixture.sourceType.id}`),
	).toBeVisible();
	await page.getByTestId(`item-types-remove-${fixture.sourceType.id}`).click();
	await page.getByTestId("config-set-save").click();
	await expect(page.getByTestId("migration-assistant")).toBeVisible();
}

test("removing a used item type migrates its items to a same-level type", async ({
	page,
	request,
}) => {
	test.setTimeout(90_000);
	const fixture = await buildFixture(request, true);
	const target = fixture.sameLevelTarget;
	if (!target) throw new Error("same-level target fixture was not created");

	await removeSourceTypeAndSave(page, fixture);

	const mapping = page.getByTestId(
		`migration-item-type-${fixture.sourceType.id}`,
	);
	await expect(mapping).toBeVisible();
	const targetPicker = page.locator(
		`#migration-item-type-target-${fixture.sourceType.id}`,
	);
	await expect(targetPicker).toHaveValue(target.name);
	await shot(page, "01-same-level-migration-mapping");
	const migrationResponse = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			response
				.url()
				.includes("/configuration-sets/execute-comprehensive-migration"),
	);
	const saveResponse = page.waitForResponse(
		(response) =>
			response.request().method() === "PUT" &&
			response.url().endsWith(`/configuration-sets/${fixture.configSetId}`),
	);
	await page.getByTestId("dialog-confirm").click();
	await expect((await migrationResponse).status()).toBe(200);
	await expect((await saveResponse).status()).toBe(200);

	await page.goto(`/workspaces/${fixture.workspaceId}/items/${fixture.itemId}`);
	await expect(page.getByTestId("item-detail-ready")).toBeVisible();
	await expect(page.getByTestId("item-type-change-trigger")).toHaveAttribute(
		"data-item-type-id",
		String(target.id),
	);

	await page.goto(`/admin/configuration-sets/${fixture.configSetId}`);
	await page.getByTestId("config-set-tab-item-types").click();
	await expect(
		page.getByTestId(`item-types-available-${fixture.sourceType.id}`),
	).toBeVisible();
	await expect(
		page.getByTestId(`item-types-assigned-${target.id}`),
	).toBeVisible();
});

test("removing the only used type at a hierarchy level cannot execute a migration", async ({
	page,
	request,
}) => {
	test.setTimeout(90_000);
	const fixture = await buildFixture(request, false);

	await removeSourceTypeAndSave(page, fixture);

	await expect(
		page.getByTestId(`migration-item-type-no-target-${fixture.sourceType.id}`),
	).toBeVisible();
	await expect(page.getByTestId("dialog-confirm")).toBeDisabled();
	await shot(page, "02-no-same-level-target");
	await page.getByTestId("dialog-cancel").click();

	// Reload from the server to prove the blocked attempt did not remove the
	// type from the configuration set.
	await page.reload();
	await page.getByTestId("config-set-tab-item-types").click();
	await expect(
		page.getByTestId(`item-types-assigned-${fixture.sourceType.id}`),
	).toBeVisible();

	await page.goto(`/workspaces/${fixture.workspaceId}/items/${fixture.itemId}`);
	await expect(page.getByTestId("item-detail-ready")).toBeVisible();
	await expect(page.getByTestId("item-type-change-trigger")).toHaveAttribute(
		"data-item-type-id",
		String(fixture.sourceType.id),
	);
});
