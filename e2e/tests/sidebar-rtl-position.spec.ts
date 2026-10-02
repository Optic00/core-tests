import { randomUUID } from 'node:crypto';
import { createWorkspaceViaAPI } from '../fixtures/api-helpers';
import { createArabicSession } from '../fixtures/arabic-session';
import { expect, test } from '../fixtures/context-path';

// The main nav rail is fixed-positioned with a physical left anchor, and the
// app shell offsets content with a physical margin-left. Under RTL the rail
// must stay on the physical left (inside that gutter) instead of flipping to
// the inline-start edge, where it overlaid content and left the gutter empty.
//
// Uses a dedicated Arabic-language user so the shared admin's profile (read
// by parallel specs) is never mutated.

test('keeps the main nav rail on the physical left under RTL', async ({
	browser,
	request,
}) => {
	const workspace = await createWorkspaceViaAPI(request, {
		name: `RTL Rail ${Date.now()}`,
		key: `RTLR${randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase()}`,
		description: 'RTL nav rail positioning'
	});

	const { context, page } = await createArabicSession(
		request,
		browser,
		workspace.id,
		'rail'
	);

	await page.goto(`/workspaces/${workspace.key}/items`);
	// The app sets dir on <html> after hydration; wait rather than read once.
	await page.waitForFunction(() => document.documentElement.getAttribute('dir') === 'rtl');

	const rail = page.getByTestId('main-sidebar');
	await expect(rail).toBeVisible({ timeout: 15000 });
	const box = await rail.evaluate((el) => {
		const rect = el.getBoundingClientRect();
		return { x: rect.x, width: rect.width };
	});
	expect(box.x).toBe(0);
	expect(box.width).toBe(64);
});
