import { expect, test } from "@playwright/test";

test.skip(!process.env.WINDSHIFT_WEBSITE_DIST, "Requires a built website");
for (const route of ["/", "/de"]) {
	test(`footer opens the generated REST API reference from ${route}`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(route);
		await page.getByTestId("footer-rest-api").click();
		await expect(page).toHaveURL("http://127.0.0.1:4199/rest-api");
		await expect(page).toHaveTitle("REST API v2 reference | Windshift");
		await expect(page.locator("#api-status")).toHaveCount(0);
		await expect(page.getByTestId("api-reference")).toContainText(
			"Required scopes",
		);
		await expect(page.getByTestId("api-docs-operation")).toHaveCount(1);
		await expect(page.getByTestId("api-docs-operation")).toContainText(
			"Responses",
		);
		await expect(page.getByTestId("api-download")).toHaveAttribute(
			"href",
			"/rest-api/openapi.json",
		);
		await page.reload();
		await expect(page.locator("#api-status")).toHaveCount(0);
		await expect(page.getByTestId("api-reference")).toContainText("Responses");
		expect(errors).toEqual([]);
	});
}

test("search selects one v2 endpoint and preserves it after reload", async ({
	page,
}) => {
	await page.goto("/rest-api");
	await page.getByTestId("api-docs-filter").fill("/items");
	await expect(page.getByTestId("api-docs-op-link").first()).toContainText(
		"/items",
	);
	await page.locator("#api-docs-op-op-get-items").click();
	const operation = page.getByTestId("api-docs-operation");
	await expect(operation).toHaveCount(1);
	await expect(operation).toHaveAttribute("data-path", "/items");
	await expect(operation).toContainText("Query parameters");
	const selectedUrl = page.url();
	await page.reload();
	await expect(operation).toHaveAttribute("data-path", "/items");
	await expect(page).toHaveURL(selectedUrl);
	await page.getByTestId("api-docs-filter").fill("no-such-api-endpoint");
	await expect(page.getByTestId("api-docs-no-matches")).toBeVisible();
	await expect(page.getByTestId("api-docs-op-link")).toHaveCount(0);
	await expect(page.getByTestId("api-docs-next-operation")).toBeDisabled();
	await page.getByTestId("api-docs-filter").fill("");
	await expect(page.getByTestId("api-docs-op-link").first()).toBeVisible();
});
test("shows a useful failure when the spec cannot load", async ({ page }) => {
	await page.route("**/rest-api/openapi.json", (route) =>
		route.fulfill({ status: 503, body: "Unavailable" }),
	);
	await page.goto("/rest-api");
	await expect(page.getByTestId("api-docs-error")).toHaveText(
		"The API reference could not load. Download the OpenAPI JSON above or reload the page.",
	);
	await expect(page.getByTestId("api-docs-operation")).toHaveCount(0);
	await expect(page.getByTestId("api-download")).toBeVisible();
});
test("keeps endpoint selection usable on a narrow screen", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/rest-api");
	await expect(page.getByTestId("api-docs-operation")).toHaveCount(1);
	await page.getByTestId("api-docs-filter").fill("/action-templates");
	await page.getByTestId("api-docs-op-link").first().click();
	await expect(page.getByTestId("api-docs-operation")).toHaveAttribute(
		"data-path",
		"/action-templates",
	);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
});

test("navigates between operations without accumulating rendered schemas", async ({
	page,
}) => {
	await page.goto("/rest-api");
	const operation = page.getByTestId("api-docs-operation");
	await expect(operation).toHaveAttribute("data-path", "/action-templates");
	await expect(operation).toContainText("actions:read");
	await page.getByTestId("api-docs-next-operation").click();
	await expect(operation).toHaveCount(1);
	await expect(operation).not.toHaveAttribute("data-path", "/action-templates");
	await page.getByTestId("api-docs-previous-operation").click();
	await expect(operation).toHaveAttribute("data-path", "/action-templates");
	const schema = page.getByTestId("api-docs-schema-toggle").first();
	await expect(schema).toHaveAttribute("aria-expanded", "true");
	await schema.click();
	await expect(schema).toHaveAttribute("aria-expanded", "false");
	await schema.click();
	await expect(schema).toHaveAttribute("aria-expanded", "true");
});
