import { expect, type APIRequestContext, test } from "../fixtures/context-path";

/**
 * Admin module settings (/admin/modules) and the work-item staleness setting
 * (AI tab of /admin/llm-connections). Both autosave/save explicitly; the tests
 * verify persisted server state and restore the originals.
 */

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };

interface ModuleSettings {
	time_tracking_enabled: boolean;
	test_management_enabled: boolean;
	workspace_managed_agents: boolean;
}

async function getModuleSettings(request: APIRequestContext): Promise<ModuleSettings> {
	const response = await request.get("/api/setup/modules", { headers: SEC_FETCH });
	expect(response.ok()).toBeTruthy();
	return await response.json();
}

test.describe("Admin module settings", () => {
	test("test management toggle autosaves and survives a reload", async ({ page, request }) => {
		const original = await getModuleSettings(request);

		await page.goto("/admin/modules");
		const toggle = page.getByTestId("module-test-management-toggle");
		await expect(toggle).toBeVisible();
		await expect(toggle).toHaveAttribute("aria-checked", String(original.test_management_enabled));

		const targetValue = !original.test_management_enabled;
		await toggle.click();
		await expect
			.poll(async () => (await getModuleSettings(request)).test_management_enabled)
			.toBe(targetValue);

		await page.reload();
		await expect(page.getByTestId("module-test-management-toggle")).toHaveAttribute(
			"aria-checked",
			String(targetValue),
		);

		const restoreResponse = await request.put("/api/setup/modules", {
			headers: SEC_FETCH,
			data: original,
		});
		expect(restoreResponse.ok()).toBeTruthy();
	});

	test("work item staleness threshold saves and rejects invalid values", async ({
		page,
		request,
	}) => {
		const currentResponse = await request.get("/api/admin/work-item-staleness", {
			headers: SEC_FETCH,
		});
		expect(currentResponse.ok()).toBeTruthy();
		const original = (await currentResponse.json()).stale_after_days as number;

		try {
			await page.goto("/admin/llm-connections?subtab=staleness");
			const input = page.getByTestId("work-item-staleness-days");
			await expect(input).toBeVisible();
			await expect(input).toHaveValue(String(original));

			await input.fill("14");
			await page.getByTestId("work-item-staleness-save").click();

			const savedResponse = await request.get("/api/admin/work-item-staleness", {
				headers: SEC_FETCH,
			});
			expect(savedResponse.ok()).toBeTruthy();
			expect(((await savedResponse.json()) as { stale_after_days: number }).stale_after_days).toBe(
				14,
			);

			// Out-of-range values are rejected client-side without a save.
			await input.fill("999");
			await page.getByTestId("work-item-staleness-save").click();
			const rejectedResponse = await request.get("/api/admin/work-item-staleness", {
				headers: SEC_FETCH,
			});
			expect(rejectedResponse.ok()).toBeTruthy();
			expect(
				((await rejectedResponse.json()) as { stale_after_days: number }).stale_after_days,
			).toBe(14);
		} finally {
			const restoreResponse = await request.put("/api/admin/work-item-staleness", {
				headers: SEC_FETCH,
				data: { stale_after_days: original },
			});
			expect(restoreResponse.ok()).toBeTruthy();
		}
	});
});
