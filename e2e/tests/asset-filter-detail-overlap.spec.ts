import { expect, test } from "../fixtures/context-path";

const headers = { "Sec-Fetch-Site": "same-origin" };

test("asset filter remains selectable over the open detail pane", async ({
	page,
	request,
}, testInfo) => {
	await page.setViewportSize({ width: 1100, height: 1000 });
	const name = `Filter overlay ${testInfo.testId}-${testInfo.retry}`;
	const setResponse = await request.post("/api/v2/asset-sets", {
		headers,
		data: { name },
	});
	expect(setResponse.status()).toBe(201);
	const assetSet = (await setResponse.json()).data;
	try {
		const typeResponse = await request.post(
			`/api/v2/asset-sets/${assetSet.id}/types`,
			{
				headers,
				data: { name: "Component" },
			},
		);
		expect(typeResponse.status()).toBe(201);
		const assetType = (await typeResponse.json()).data;
		const assetResponse = await request.post(
			`/api/v2/asset-sets/${assetSet.id}/assets`,
			{
				headers,
				data: { title: name, asset_type_id: assetType.id },
			},
		);
		expect(assetResponse.status()).toBe(201);
		const asset = (await assetResponse.json()).data;

		await page.goto("/assets");
		await page.locator("#asset-set-select").click();
		await page.locator(`#asset-set-select-option-${assetSet.id}`).click();
		await page.getByTestId(`asset-title-${asset.id}`).click();
		const detail = page.getByTestId("asset-detail-pane");
		await expect(detail).toBeVisible();
		await page.getByTestId("dynamic-filter-toggle").click();
		await page.getByTestId("field-selector-trigger").click();
		const option = page.getByTestId("field-option-status");
		await expect(option).toBeVisible();
		const paneBounds = await detail.boundingBox();
		const panel = page.getByTestId("dynamic-filter-panel");
		const panelBounds = await panel.boundingBox();
		if (!paneBounds || !panelBounds)
			throw new Error("Filter panel and detail pane must have visible bounds");
		const x = panelBounds.x + panelBounds.width - 2;
		const y = panelBounds.y + panelBounds.height / 2;
		expect(x).toBeGreaterThan(paneBounds.x);
		expect(x).toBeLessThan(1100);
		await expect
			.poll(() =>
				panel.evaluate(
					(element, point) => {
						return element.contains(
							document.elementFromPoint(point.x, point.y),
						);
					},
					{ x, y },
				),
			)
			.toBe(true);
		await option.click();
		await expect(page.getByTestId("field-selector-value")).toHaveText("Status");
		await expect(page.getByTestId("field-selector-menu")).toHaveCount(0);
		await page.getByTestId("dynamic-filter-apply").click();
		await expect(page.getByTestId("dynamic-filter-panel")).toHaveCount(0);
		await expect(detail).toBeVisible();
		await expect(page.getByTestId(`asset-title-${asset.id}`)).toBeVisible();
	} finally {
		const response = await request.delete(`/api/v2/asset-sets/${assetSet.id}`, {
			headers,
		});
		expect(response.status()).toBe(204);
	}
});
