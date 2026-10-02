import { expect, type APIRequestContext, test } from "../fixtures/context-path";

/**
 * Admin integration providers (/admin/integration-providers): the outbound
 * SCM provider manager and the Zammad connection tab. Both were previously
 * untested; the tests register a provider/connection with fake credentials
 * through the UI and verify the persisted records, then delete them again.
 */

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };

interface ScmProvider {
	id: number;
	slug: string;
	name: string;
	provider_type: string;
	auth_method: string;
	enabled: boolean;
}

interface ZammadConnection {
	id: number;
	slug: string;
	name: string;
	base_url: string;
	enabled: boolean;
}

test.describe("Admin integration providers", () => {
	test("registers and deletes a PAT-based SCM provider through the UI", async ({
		page,
		request,
	}) => {
		const stamp = Date.now();
		const slug = `e2e-scm-${stamp}`;
		const name = `E2E SCM ${stamp}`;
		let providerId = 0;

		try {
			await page.goto("/admin/scm-providers");
			await page.getByTestId("scm-provider-add").click();

			const dialog = page.locator('[role="dialog"]');
			await expect(dialog).toBeVisible();
			await page.getByTestId("scm-provider-slug").fill(slug);
			await page.getByTestId("scm-provider-name").fill(name);
			await page.getByTestId("scm-provider-type").click();
			await page.getByTestId("scm-provider-type-option-github").click();
			await page.getByTestId("scm-provider-auth").click();
			await page.getByTestId("scm-provider-auth-option-pat").click();
			await page.getByTestId("scm-provider-token").fill(`ghp_e2e_${stamp}`);

			const createResponse = page.waitForResponse(
				(response) =>
					response.url().endsWith("/api/admin/scm-providers") &&
					response.request().method() === "POST",
			);
			await page.getByTestId("scm-provider-submit").click();
			const createdResponse = await createResponse;
			expect(createdResponse.status()).toBeLessThan(300);
			const created = (await createdResponse.json()) as ScmProvider;
			providerId = created.id;
			expect(providerId).toBeGreaterThan(0);

			const row = page.getByTestId(`scm-provider-row-${providerId}`);
			await expect(row).toBeVisible();
			await expect(row).toContainText(name);

			const listResponse = await request.get("/api/admin/scm-providers", { headers: SEC_FETCH });
			expect(listResponse.ok()).toBeTruthy();
			const listed = (await listResponse.json()) as ScmProvider[];
			const persisted = listed.find((provider) => provider.id === providerId);
			expect(persisted, "provider persisted").toBeDefined();
			expect(persisted!.slug).toBe(slug);
			expect(persisted!.provider_type).toBe("github");
			expect(persisted!.auth_method).toBe("pat");

			// Delete through the row action and confirm.
			await page.getByTestId(`scm-provider-delete-${providerId}`).click();
			await expect(page.getByTestId("dialog-confirm")).toBeVisible();
			await page.getByTestId("dialog-confirm").click();
			await expect(page.getByTestId(`scm-provider-row-${providerId}`)).toHaveCount(0);
			await expect
				.poll(async () =>
					request
						.get("/api/admin/scm-providers", { headers: SEC_FETCH })
						.then(
							(response) =>
								response.json().then(
									(providers) =>
										!(providers as ScmProvider[]).some(
											(provider) => provider.id === providerId,
										),
								),
						),
				)
				.toBe(true);
			providerId = 0;
		} finally {
			if (providerId) {
				await request.delete(`/api/admin/scm-providers/${providerId}`, { headers: SEC_FETCH });
			}
		}
	});

	test("registers and deletes a Zammad connection through the UI", async ({ page, request }) => {
		const stamp = Date.now();
		const slug = `e2e-zammad-${stamp}`;
		const name = `E2E Zammad ${stamp}`;
		let connectionId = "";

		try {
			await page.goto("/admin/integration-providers?tab=zammad");
			await expect(page.getByTestId("integrations-tab-zammad")).toBeVisible();
			await page.getByTestId("zammad-connection-add").click();

			const dialog = page.locator('[role="dialog"]');
			await expect(dialog).toBeVisible();
			await page.getByTestId("zammad-connection-name").fill(name);
			await page.getByTestId("zammad-connection-slug").fill(slug);
			await page.getByTestId("zammad-connection-base-url").fill("https://zammad.example.test");
			await page.getByTestId("zammad-connection-api-token").fill(`token-${stamp}`);
			await page.getByTestId("zammad-connection-default-customer").fill("agent@example.test");
			await page.getByTestId("zammad-connection-default-group-id").fill("7");
			await page.getByTestId("zammad-connection-default-group-name").fill("Support");
			await page.getByTestId("zammad-connection-correlation-field").fill("e2e_correlation");
			// Scope the connection to all workspaces so no explicit workspace
			// selection is required. The checkbox id lands on the input itself.
			await page.locator("#zammad-global").check();

			const createResponse = page.waitForResponse(
				(response) =>
					response.url().endsWith("/api/admin/zammad-connections") &&
					response.request().method() === "POST",
			);
			await page.getByTestId("zammad-connection-submit").click();
			const createdResponse = await createResponse;
			expect(createdResponse.status()).toBeLessThan(300);
			const created = (await createdResponse.json()) as ZammadConnection;
			connectionId = String(created.id);
			expect(connectionId.length).toBeGreaterThan(0);

			const row = page.getByTestId(`zammad-connection-row-${connectionId}`);
			await expect(row).toBeVisible();
			await expect(row).toContainText(name);
			await expect(row).toContainText("https://zammad.example.test");

			const listResponse = await request.get("/api/admin/zammad-connections", {
				headers: SEC_FETCH,
			});
			expect(listResponse.ok()).toBeTruthy();
			const listed = (await listResponse.json()) as ZammadConnection[];
			const persisted = listed.find((connection) => connection.id === connectionId);
			expect(persisted, "connection persisted").toBeDefined();
			expect(persisted!.slug).toBe(slug);
			expect(persisted!.base_url).toBe("https://zammad.example.test");

			// Delete through the row action and confirm.
			await page.getByTestId(`zammad-connection-delete-${connectionId}`).click();
			await expect(page.getByTestId("dialog-confirm")).toBeVisible();
			await page.getByTestId("dialog-confirm").click();
			await expect(page.getByTestId(`zammad-connection-row-${connectionId}`)).toHaveCount(0);
			await expect
				.poll(async () =>
					request
						.get("/api/admin/zammad-connections", { headers: SEC_FETCH })
						.then(
							(response) =>
								response.json().then(
									(connections) =>
										!(connections as ZammadConnection[]).some(
											(connection) => connection.id === connectionId,
										),
								),
						),
				)
				.toBe(true);
			connectionId = 0;
		} finally {
			if (connectionId) {
				await request.delete(`/api/admin/zammad-connections/${connectionId}`, {
					headers: SEC_FETCH,
				});
			}
		}
	});
});
