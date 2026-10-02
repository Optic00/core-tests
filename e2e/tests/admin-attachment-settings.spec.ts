import { expect, type APIRequestContext, test } from "../fixtures/context-path";

/**
 * Admin attachment settings (/admin/attachments). Size and MIME-type changes
 * autosave; the tests assert the persisted server state and restore the
 * original configuration.
 */

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };

interface AttachmentSettings {
	id: number;
	enabled: boolean;
	max_file_size: number;
	allowed_mime_types: string;
}

async function getAttachmentSettings(request: APIRequestContext): Promise<AttachmentSettings> {
	const response = await request.get("/api/attachment-settings", { headers: SEC_FETCH });
	expect(response.ok()).toBeTruthy();
	return await response.json();
}

function parsedTypes(settings: AttachmentSettings): string[] {
	try {
		return JSON.parse(settings.allowed_mime_types) as string[];
	} catch {
		return [];
	}
}

// Serial on purpose: every autosave PUTs the whole settings object, so two
// parallel tests would revert each other's max_file_size (lost update on the
// global singleton row).
test.describe.serial("Admin attachment settings", () => {
	test("max file size change persists", async ({ page, request }) => {
		const original = await getAttachmentSettings(request);

		await page.goto("/admin/attachments");
		const input = page.locator("#max-file-size");
		await expect(input).toBeVisible();
		await expect(input).toHaveValue(String(Math.round(original.max_file_size / 1048576)));

		await input.fill("64");
		await input.blur();
		await expect
			.poll(async () => (await getAttachmentSettings(request)).max_file_size)
			.toBe(64 * 1048576);

		// Reload shows the persisted value in MB.
		await page.reload();
		await expect(page.locator("#max-file-size")).toHaveValue("64");

		const restoreResponse = await request.put(`/api/attachment-settings/${original.id}`, {
			headers: SEC_FETCH,
			data: {
				max_file_size: original.max_file_size,
				allowed_mime_types: parsedTypes(original),
				enabled: original.enabled,
			},
		});
		expect(restoreResponse.ok()).toBeTruthy();
	});

	test("adding and removing a MIME type restriction persists", async ({ page, request }) => {
		const original = await getAttachmentSettings(request);
		const mimeType = "application/x-e2e-probe";
		let added = false;

		try {
			await page.goto("/admin/attachments");
			const typeInput = page.locator("#add-mime-type");
			await expect(typeInput).toBeVisible();

			await typeInput.fill(mimeType);
			await page.getByTestId("attachment-add-mime-button").click();
			added = true;

			await expect
				.poll(async () => parsedTypes(await getAttachmentSettings(request)))
				.toContain(mimeType);
			const typesContainer = page.getByTestId("attachment-mime-types");
			await expect(typesContainer).toContainText(mimeType);

			// Removing the chip drops it from the persisted list again.
			await page.getByTestId("attachment-remove-mime-application-x-e2e-probe").click();
			await expect
				.poll(async () => parsedTypes(await getAttachmentSettings(request)))
				.not.toContain(mimeType);
			// With the list empty again the chip container is replaced by the
			// "all types allowed" empty state.
			await expect(page.getByTestId("attachment-mime-types")).toHaveCount(0);
			added = false;
		} finally {
			if (added) {
				const current = parsedTypes(await getAttachmentSettings(request)).filter(
					(type) => type !== mimeType,
				);
				await request.put(`/api/attachment-settings/${original.id}`, {
					headers: SEC_FETCH,
					data: {
						max_file_size: original.max_file_size,
						allowed_mime_types: current,
						enabled: original.enabled,
					},
				});
			}
		}
	});
});
