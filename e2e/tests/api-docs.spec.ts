import { expect, test } from "../fixtures/context-path";

/**
 * The API browser defaults to the canonical v2 document and keeps the
 * deprecated v1 document available through its version selector.
 */

// HTTP-layer tests own the OpenAPI endpoint contracts. This spec owns the
// user-visible API documentation page.

test.describe("/api-docs page", () => {
	test("the /api-docs route fetches the spec and renders the native viewer", async ({
		page,
	}) => {
		const specRequest = page.waitForRequest(
			(req) =>
				req.url().includes("/api/v2/openapi.json") && req.method() === "GET",
		);

		await page.goto("/api-docs");


		// The page must fetch the embedded v2 spec.
		const req = await specRequest;
		expect(req).toBeTruthy();

		// The native sidebar lists tag groups with at least one operation row.
		await expect(page.getByTestId("api-docs-sidebar")).toBeVisible({
			timeout: 10_000,
		});
		await expect(page.getByTestId("api-docs-op-link").first()).toBeVisible();

		// The main panel renders a selected operation panel.
		await expect(page.getByTestId("api-docs-operation").first()).toBeVisible();
	});

	test("finds and opens a described operation in its v2 domain", async ({
		page,
	}) => {
		await page.goto("/api-docs");


		await page.getByTestId("api-docs-filter").fill("/items/{item_id}/children");
		await expect(page.getByTestId("api-docs-tag-toggle")).toContainText(
			"Work items",
		);
		const result = page.locator("#api-docs-op-op-get-items-item_id-children");
		await expect(result).toBeVisible();
		await expect(result).toContainText("List item children");
		await result.click();

		const operation = page.getByTestId("api-docs-operation");
		await expect(operation).toHaveAttribute(
			"data-path",
			"/items/{item_id}/children",
		);
		await expect(operation).toContainText("List item children");
	});

	test("renders typed item parameters, scopes, and request fields", async ({
		page,
	}) => {
		await page.goto("/api-docs");


		const filter = page.getByTestId("api-docs-filter");
		await filter.fill("POST /items");
		await page.locator("#api-docs-op-op-post-items").click();

		const operation = page.getByTestId("api-docs-operation");
		await expect(operation).toHaveAttribute("data-method", "post");
		await expect(operation).toContainText("PostItemsPayload");
		await expect(operation).toContainText("personal task");
		await expect(operation).toContainText("items:write");

		await filter.fill("GET /items");
		await page.locator("#api-docs-op-op-get-items").click();
		await expect(operation).toHaveAttribute("data-method", "get");
		await expect(operation).toContainText("workspace_id");
		await expect(operation).toContainText("collection_id");
		await expect(operation).toContainText("include_watermark");
	});

	test("resizes the navigation and restores its width after reload", async ({
		page,
	}) => {
		await page.goto("/api-docs");


		const pane = page.getByTestId("api-docs-sidebar-pane");
		const handle = page.getByTestId("api-docs-sidebar-resize");
		const initialBox = await pane.boundingBox();
		if (!initialBox) throw new Error("API navigation pane has no layout box");

		await handle.hover();
		await page.mouse.down();
		await page.mouse.move(
			initialBox.x + initialBox.width + 96,
			initialBox.y + 40,
		);
		await page.mouse.up();

		const resizedBox = await pane.boundingBox();
		expect(resizedBox?.width).toBeGreaterThan(initialBox.width + 80);

		await page.reload();

		await expect(page.getByTestId("api-docs-sidebar-resize")).toHaveAttribute(
			"aria-valuenow",
			String(Math.round(resizedBox?.width ?? 0)),
		);
	});

	test("keeps the selected API version in a reloadable URL", async ({
		page,
	}) => {
		await page.goto("/api-docs");
		await expect(page.getByTestId("api-docs-version")).toBeVisible();

		const v1Request = page.waitForRequest(
			(req) =>
				req.url().includes("/rest/api/v1/openapi.json") &&
				req.method() === "GET",
		);
		await page.getByTestId("api-docs-version").selectOption("v1");
		await v1Request;
		await expect(page).toHaveURL(/\/api-docs\?version=v1$/);

		const reloadRequest = page.waitForRequest(
			(req) =>
				req.url().includes("/rest/api/v1/openapi.json") &&
				req.method() === "GET",
		);
		await page.reload();
		await reloadRequest;
		await expect(page.getByTestId("api-docs-version")).toHaveValue("v1");
	});

	test("reports and renders the viewport-aware maximum width", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 800, height: 720 });
		await page.goto("/api-docs");
		const handle = page.getByTestId("api-docs-sidebar-resize");
		await expect(handle).toBeVisible();

		await handle.press("End");

		await expect(handle).toHaveAttribute("aria-valuemax", "480");
		await expect(handle).toHaveAttribute("aria-valuenow", "480");
		expect(
			(await page.getByTestId("api-docs-sidebar-pane").boundingBox())?.width,
		).toBe(480);
	});
});
