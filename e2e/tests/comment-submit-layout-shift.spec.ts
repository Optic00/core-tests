import {
	createItemViaAPI,
	createWorkspaceViaAPI,
} from "../fixtures/api-helpers";
import { expect, test } from "../fixtures/context-path";

/**
 * GH #263 / WI-1349: mousedown on the comment submit button blurs the
 * Milkdown composer, which unmounts the focus-revealed toolbar and shifts the
 * button before mouseup lands — the first click never registers. The button's
 * geometry must stay stable between mousedown and mouseup, and a single
 * press must submit the comment.
 */
test.describe("comment submit layout stability", () => {
	test("comment button does not move between mousedown and mouseup", async ({
		page,
		request,
	}) => {
		const stamp = Date.now();
		const workspace = await createWorkspaceViaAPI(request, {
			name: `comment-shift-${stamp}`,
			key: `CS${stamp.toString().slice(-6)}`.toUpperCase(),
			description: "WI-1349 comment submit layout shift",
		});
		const item = await createItemViaAPI(request, workspace.id, {
			title: `Comment shift ${stamp}`,
		});

		await page.goto(`/workspaces/${workspace.id}/items/${item.id}`);
		const section = page.getByTestId("comments-section");
		await expect(section).toBeVisible({ timeout: 15_000 });

		const composer = page.getByTestId("comment-composer");
		await expect(composer).toHaveAttribute("data-ready", "true", {
			timeout: 15_000,
		});
		await composer.click();
		await page.keyboard.type("first click comment");
		await expect(page.getByTestId("comment-submit")).toBeEnabled();

		const submit = page.getByTestId("comment-submit");
		const before = await submit.boundingBox();
		expect(before).not.toBeNull();

		// Press and hold: the editor blur must not reflow the button mid-click.
		await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
		await page.mouse.down();
		const during = await submit.boundingBox();
		await page.mouse.up();

		expect(Math.abs(during!.y - before!.y)).toBeLessThan(2);
		expect(Math.abs(during!.x - before!.x)).toBeLessThan(2);

		await expect(section.getByTestId("comment-item")).toHaveCount(1);
		await expect(section.getByTestId("comment-item")).toContainText(
			"first click comment",
		);
	});
});
