import { expect, type Locator, type Page, test } from "../fixtures/context-path";

test.describe.configure({ retries: 0 });

/**
 * Regression coverage for issue #279: on Linux Firefox, classic scrollbars
 * make `scrollbar-gutter: stable` reserve ~11px inside the collapsed 64px
 * sidebar, so every `w-full` button shrinks to ~32px while its icon stays at
 * the left-aligned position designed for a 43px button. The Create button's
 * filled chip makes the ~6px offset visible; every other sidebar button has
 * the same offset, just without a visible edge to compare against.
 *
 * The fix centers the icon when the nav is collapsed, so icon centering must
 * hold at any rail width. Headless Chromium cannot force classic scrollbars,
 * so the Linux condition is reproduced by narrowing the rail: the old
 * left-aligned layout puts the icon at a fixed x and fails the assertion,
 * the centered layout passes regardless of width.
 */

const NAV_COLLAPSED_INIT_SCRIPT =
	"window.localStorage.setItem('windshift-nav-expanded', 'false');";

const NARROW_RAIL_WIDTH = 40; // px — narrower than any scrollbar gutter could produce

async function waitForRailWidth(page: Page, width: number) {
	// The sidebar animates its width; sync on the final geometry instead of
	// sleeping through the transition.
	await expect
		.poll(() =>
			page.evaluate(
				(w) =>
					document.querySelector(".main-sidebar")?.getBoundingClientRect()
						.width ?? 0,
				width,
			),
		)
		.toBe(width);
}

async function iconOffsetFromButtonCenter(button: Locator): Promise<number> {
	return button.evaluate((el) => {
		const btn = el.getBoundingClientRect();
		const icon = el.querySelector("svg, img");
		if (!icon) throw new Error("button has no icon descendant");
		const iconBox = icon.getBoundingClientRect();
		return Math.abs(
			(iconBox.left + iconBox.right) / 2 - (btn.left + btn.right) / 2,
		);
	});
}

async function expectIconCentered(name: string, button: Locator) {
	const offset = await iconOffsetFromButtonCenter(button);
	expect(
		offset,
		`${name} icon should be horizontally centered in its button`,
	).toBeLessThanOrEqual(1.5);
}

test("collapsed sidebar icons stay centered when the rail is narrower than designed", async ({
	page,
}: { page: Page }) => {
	await page.addInitScript(NAV_COLLAPSED_INIT_SCRIPT);
	await page.goto("/");
	const createButton = page.locator("#global-create-button");
	await expect(createButton).toBeVisible();

	const cases: [string, Locator][] = [
		["create button", createButton],
		["search button", page.locator("#global-search-button")],
		["workspaces trigger", page.getByTestId("workspaces-dropdown-trigger")],
		["notifications trigger", page.getByTestId("notifications-trigger")],
		["user avatar trigger", page.getByTestId("user-avatar-trigger")],
		["nav toggle button", page.getByTestId("nav-toggle-button")],
		["logo link", page.getByTestId("nav-logo-link")],
	];

	for (const [name, locator] of cases) {
		await expectIconCentered(name, locator);
	}

	// Reproduce the Linux scrollbar-gutter shrink: buttons become narrower
	// than the icon position assumes. Centered icons must not move.
	await page.addStyleTag({
		content: `.main-sidebar { width: ${NARROW_RAIL_WIDTH}px !important; }`,
	});
	await waitForRailWidth(page, NARROW_RAIL_WIDTH);

	for (const [name, locator] of cases) {
		await expectIconCentered(`${name} (narrow rail)`, locator);
	}
});

test("collapsed create button icon does not touch the button edge", async ({
	page,
}: { page: Page }) => {
	await page.addInitScript(NAV_COLLAPSED_INIT_SCRIPT);
	await page.goto("/");
	const createButton = page.locator("#global-create-button");
	await expect(createButton).toBeVisible();

	// The reported symptom is the + glyph flush with the button's right
	// edge. The centered layout keeps the icon within the button at the
	// default rail width.
	const ratio = await createButton.evaluate((el) => {
		const btn = el.getBoundingClientRect();
		const icon = el.querySelector("svg");
		if (!icon) throw new Error("create button has no icon");
		const iconBox = icon.getBoundingClientRect();
		return iconBox.width / btn.width;
	});
	expect(ratio).toBeLessThan(0.8);
});
