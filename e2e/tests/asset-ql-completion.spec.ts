import { expect, test } from '../fixtures/context-path';

const headers = { 'Sec-Fetch-Site': 'same-origin' };

test('asset QL completes fields and types and executes the selected query', async ({
  page,
  request,
}, testInfo) => {
  const name = `QL assets ${testInfo.testId}-${testInfo.retry}`;
  const response = await request.post('/api/v2/asset-sets', { headers, data: { name } });
  expect(response.ok()).toBeTruthy();
  const set = (await response.json()).data;
  try {
    const typeResponse = await request.post(`/api/v2/asset-sets/${set.id}/types`, {
      headers,
      data: { name: 'Laptop' },
    });
    expect(typeResponse.ok()).toBeTruthy();
    const type = (await typeResponse.json()).data;
    const assetResponse = await request.post(`/api/v2/asset-sets/${set.id}/assets`, {
      headers,
      data: { title: 'Completion laptop', asset_type_id: type.id },
    });
    expect(assetResponse.ok()).toBeTruthy();
    await page.goto('/assets');
    await page.locator('#asset-set-select').click();
    await page.locator(`#asset-set-select-option-${set.id}`).click();
    await expect(page.getByTestId('asset-row')).toHaveCount(1);
    await page.getByTestId('asset-search-toggle-ql').click();
    const editor = page.getByTestId('asset-search');
    await editor.fill('typ');
    await page.getByTestId('ql-suggestion-field-type').click();
    await expect(editor).toHaveValue('type ');
    await editor.press('Tab');
    await expect(editor).toHaveValue('type = ');
    await page.getByTestId('ql-suggestion-value-laptop').click();
    await expect(editor).toHaveValue('type = "Laptop"');
    await editor.press('Escape');
    await editor.press('Enter');
    await expect(page.getByTestId('asset-row')).toHaveCount(1);
    await expect(page.getByTestId('asset-row')).toContainText('Completion laptop');
    await editor.fill('type = "Desktop"');
    await editor.press('Escape');
    await editor.press('Enter');
    await expect(page.getByTestId('asset-row')).toHaveCount(0);
  } finally {
    const cleanup = await request.delete(`/api/v2/asset-sets/${set.id}`, { headers });
    expect(cleanup.ok()).toBeTruthy();
  }
});
