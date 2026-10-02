import {
  authenticateAdminRequest,
  createItemViaAPI,
  createWorkspaceViaAPI,
} from '../fixtures/api-helpers';
import { expect, test } from '../fixtures/context-path';
import { generateItem, generateWorkspace } from '../fixtures/test-data';

/**
 * The item description read mode must render through the same readonly
 * Milkdown pipeline as the editor. A previous regression swapped in a
 * server-HTML pipeline whose stylesheet left headings at body size, which is
 * exactly the visual contract asserted here via computed styles.
 */
test('item description view mode styles markdown headings like the editor', async ({
  page,
  request,
}) => {
  await authenticateAdminRequest(request);

  const suffix = `mdview${Date.now()}w${test.info().workerIndex}`;
  const ws = await createWorkspaceViaAPI(request, generateWorkspace(suffix));
  const item = await createItemViaAPI(request, ws.id, {
    title: `Markdown view ${suffix}`,
    description: '## Styled heading\n\nPlain body paragraph with **bold** text.',
  });

  await page.goto(`/workspaces/${ws.id}/items/${item.id}`);
  const display = page.getByTestId('item-description-display');
  await expect(display).toBeVisible({ timeout: 15_000 });
  await expect(display).toContainText('Styled heading');

  const typography = await display.evaluate((node) => {
    const heading = node.querySelector('h2');
    const paragraph = node.querySelector('p');
    if (!heading || !paragraph) return null;
    const headingStyle = getComputedStyle(heading);
    const paragraphStyle = getComputedStyle(paragraph);
    return {
      headingFontSize: Number.parseFloat(headingStyle.fontSize),
      headingWeight: Number.parseInt(headingStyle.fontWeight, 10),
      paragraphFontSize: Number.parseFloat(paragraphStyle.fontSize),
      paragraphWeight: Number.parseInt(paragraphStyle.fontWeight, 10),
    };
  });
  expect(typography).not.toBeNull();
  // The regression rendered headings at body weight and size.
  expect(typography.headingWeight).toBeGreaterThanOrEqual(600);
  expect(typography.headingFontSize).toBeGreaterThan(typography.paragraphFontSize);
});
