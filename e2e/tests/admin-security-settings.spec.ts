import { expect, type APIRequestContext, test } from "../fixtures/context-path";

/**
 * Admin security settings (/admin/security). Toggles autosave on change, so
 * the tests verify the persisted server state plus the UI state after reload,
 * and restore the original settings afterwards.
 */

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };

interface SecuritySettings {
	calendar_feed_enabled: boolean;
	plugin_cli_exec_enabled: boolean;
	allow_external_images: boolean;
	allow_user_managed_agents: boolean;
	max_agents_per_user: number;
	workspace_managed_agents: boolean;
	api_key_creation_policy: string;
	api_key_allowed_group_ids: number[];
}

async function getSecuritySettings(request: APIRequestContext): Promise<SecuritySettings> {
	const response = await request.get("/api/admin/security-settings", { headers: SEC_FETCH });
	expect(response.ok()).toBeTruthy();
	return await response.json();
}

test.describe("Admin security settings", () => {
	// Both tests mutate the same global settings document, so they must not
	// run concurrently within this file.
	test.describe.configure({ mode: "default" });

	test("external images toggle persists across reloads", async ({ page, request }) => {
		const original = await getSecuritySettings(request);

		await page.goto("/admin/security");
		const toggle = page.getByTestId("external-images-toggle");
		await expect(toggle).toBeVisible();
		await expect(toggle).toHaveAttribute("aria-checked", String(original.allow_external_images));

		const targetValue = !original.allow_external_images;
		await toggle.click();
		await expect
			.poll(async () => (await getSecuritySettings(request)).allow_external_images)
			.toBe(targetValue);

		// The reload reflects server truth, not just local state.
		await page.reload();
		await expect(page.getByTestId("external-images-toggle")).toHaveAttribute(
			"aria-checked",
			String(targetValue),
		);

		// Restore.
		const restoreResponse = await request.put("/api/admin/security-settings", {
			headers: SEC_FETCH,
			data: original,
		});
		expect(restoreResponse.ok()).toBeTruthy();
		expect((await getSecuritySettings(request)).allow_external_images).toBe(
			original.allow_external_images,
		);
	});

	test("max agents per user clamps and persists on blur", async ({ page, request }) => {
		const original = await getSecuritySettings(request);

		await page.goto("/admin/security");
		// The per-user cap input only exists once user-managed agents are on.
		const agentsToggle = page.getByTestId("user-managed-agents-toggle");
		await expect(agentsToggle).toBeVisible();
		await expect(agentsToggle).toHaveAttribute("aria-checked", String(original.allow_user_managed_agents));
		if (!original.allow_user_managed_agents) {
			await agentsToggle.click();
		}
		const input = page.locator("#max-agents-per-user");
		await expect(input).toBeVisible();
		await expect(input).toHaveValue(String(original.max_agents_per_user));

		await input.fill("7");
		await input.blur();
		await expect
			.poll(async () => (await getSecuritySettings(request)).max_agents_per_user)
			.toBe(7);

		// Out-of-range values clamp to the backend bounds.
		await input.fill("5000");
		await input.blur();
		await expect
			.poll(async () => (await getSecuritySettings(request)).max_agents_per_user)
			.toBe(1000);

		// Restore the original toggle state and cap.
		const restoreResponse = await request.put("/api/admin/security-settings", {
			headers: SEC_FETCH,
			data: original,
		});
		expect(restoreResponse.ok()).toBeTruthy();
	});
});
