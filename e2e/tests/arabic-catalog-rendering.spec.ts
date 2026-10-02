import { randomUUID } from 'node:crypto';
import { createItemViaAPI, createWorkspaceViaAPI } from '../fixtures/api-helpers';
import { createArabicSession } from '../fixtures/arabic-session';
import { expect, test } from '../fixtures/context-path';

// Arabic (RTL) catalog label rendering. Builtin status names resolve through
// objectDisplayName: display_name first, then the frontend i18n key
// systemCatalog.statuses.<builtinKey>, then the raw DB name. Locales missing
// that i18n section silently fall back to English on some surfaces while
// others show translated names — the mixed-language regression this spec
// guards against. A dedicated Arabic-language user keeps the shared admin's
// profile untouched for parallel specs.

const AR_OPEN = 'مفتوح';
const AR_PRIORITY_MEDIUM = 'متوسط';

test('Arabic session renders localized status labels on every item surface', async ({
	browser,
	request,
}) => {
	const workspace = await createWorkspaceViaAPI(request, {
		name: `AR Catalog ${Date.now()}`,
		key: `ARC${randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase()}`,
		description: 'Arabic catalog label rendering'
	});
	const parent = await createItemViaAPI(request, workspace.id, {
		title: 'لوحة تحكم التحليلات'
	});
	const child = await createItemViaAPI(request, workspace.id, {
		title: 'تصميم واجهة اللوحة',
		parent_id: parent.id
	});

	const { context, page } = await createArabicSession(
		request,
		browser,
		workspace.id,
		'catalog'
	);

	await page.goto(`/workspaces/${workspace.key}/items/${parent.workspace_item_number}`);
	// The app sets dir on <html> after hydration; wait rather than read once.
	await page.waitForFunction(() => document.documentElement.getAttribute('dir') === 'rtl');

	// Parent detail: the builtin status badge must use the localized label,
	// not the English fallback.
	const statusField = page.getByTestId('status-field');
	await expect(statusField).toContainText(AR_OPEN);
	await expect(statusField).not.toContainText(/open/i);

	// Priority labels come from the same systemCatalog key family.
	await expect(page.getByTestId('priority-field')).toContainText(AR_PRIORITY_MEDIUM);

	// Children list must agree with the parent badge — the surfaces resolve
	// status names through different data paths.
	const childCard = page.getByTestId(`item-child-card-${child.id}`);
	await expect(childCard).toBeVisible();
	await expect(childCard).toContainText(AR_OPEN);
	await expect(childCard).not.toContainText(/open/i);

	await context.close();
});
