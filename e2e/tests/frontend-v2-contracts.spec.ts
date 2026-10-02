import { randomUUID } from "node:crypto";
import {
	createItemViaAPI,
	createWorkspaceViaAPI,
} from "../fixtures/api-helpers";
import { expect, test } from "../fixtures/errors";

const headers = { "Sec-Fetch-Site": "same-origin" };

test("global search reaches every item beyond the first fifty", async ({
	page,
	request,
}) => {
	const stamp = randomUUID().slice(0, 8);
	const workspace = await createWorkspaceViaAPI(request, {
		name: `V2 search ${stamp}`,
		key: `VS${stamp}`.toUpperCase(),
	});
	try {
		const ids: number[] = [];
		for (let i = 0; i < 51; i++) {
			const item = await createItemViaAPI(request, workspace.id, {
				title: `V2 search ${stamp} ${i}`,
			});
			ids.push(item.id);
		}
		await page.goto(
			`/search?ql=${encodeURIComponent(`workspace_id = ${workspace.id}`)}`,
		);
		const rows = page.getByTestId(/^global-search-result-/);
		await expect(rows).toHaveCount(50);
		const first = await rows.evaluateAll((elements) =>
			elements.map((element) =>
				Number(element.getAttribute("data-testid")?.split("-").at(-1)),
			),
		);
		await page.getByTestId("pagination-next").click();
		await expect(rows).toHaveCount(1);
		const last = await rows.evaluateAll((elements) =>
			elements.map((element) =>
				Number(element.getAttribute("data-testid")?.split("-").at(-1)),
			),
		);
		expect([...first, ...last].sort((a, b) => a - b)).toEqual(
			ids.sort((a, b) => a - b),
		);
		await expect(page.getByTestId("pagination-next")).toBeDisabled();
		await page.getByTestId("pagination-previous").click();
		await expect(rows).toHaveCount(50);
	} finally {
		const response = await request.delete(
			`/api/v2/workspaces/${workspace.id}`,
			{ headers },
		);
		expect(response.ok(), await response.text()).toBeTruthy();
	}
});

test("watching an item persists and can be undone", async ({
	page,
	request,
}) => {
	const stamp = randomUUID().slice(0, 8);
	const workspace = await createWorkspaceViaAPI(request, {
		name: `V2 watch ${stamp}`,
		key: `VW${stamp}`.toUpperCase(),
	});
	try {
		const item = await createItemViaAPI(request, workspace.id, {
			title: `Watch ${stamp}`,
		});
		await page.goto(`/workspaces/${workspace.id}/items/${item.id}`);
		await expect(page.getByTestId("item-detail-ready")).toBeVisible();
		await page.getByTestId("item-detail-actions-menu").click();
		await expect(page.getByTestId("item-watch-toggle")).toContainText("Watch");
		await page.getByTestId("item-watch-toggle").click();
		await page.getByTestId("item-detail-actions-menu").click();
		await expect(page.getByTestId("item-watch-toggle")).toContainText(
			"Unwatch",
		);
		await page.reload();
		await expect(page.getByTestId("item-detail-ready")).toBeVisible();
		await page.getByTestId("item-detail-actions-menu").click();
		await expect(page.getByTestId("item-watch-toggle")).toContainText(
			"Unwatch",
		);
		const unwatchSaved = page.waitForResponse(
			(response) =>
				response.request().method() === "DELETE" &&
				new URL(response.url()).pathname.endsWith(
					`/api/v2/items/${item.id}/watch`,
				) &&
				response.ok(),
		);
		await page.getByTestId("item-watch-toggle").click();
		await unwatchSaved;
		await page.reload();
		await expect(page.getByTestId("item-detail-ready")).toBeVisible();
		await page.getByTestId("item-detail-actions-menu").click();
		await expect(page.getByTestId("item-watch-toggle")).toHaveText(
			"Watch Work Item",
		);
	} finally {
		const response = await request.delete(
			`/api/v2/workspaces/${workspace.id}`,
			{ headers },
		);
		expect(response.ok(), await response.text()).toBeTruthy();
	}
});
