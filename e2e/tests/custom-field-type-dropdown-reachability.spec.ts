import { expect, test } from '../fixtures/context-path';
import { CustomFieldsPage } from '../pages/custom-fields.page';

/**
 * GH #264: the custom field type dropdown must let users reach every option
 * on short viewports and at high zoom, where the anchored dropdown can extend
 * past the bottom of the screen.
 */
test.describe('Custom field type dropdown reachability', () => {
  for (const viewport of [
    { name: 'short viewport', height: 500 },
    { name: 'small laptop viewport', height: 700 },
  ]) {
    test(`last field type is selectable at ${viewport.name} (${viewport.height}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: viewport.height });
      const customFieldsPage = new CustomFieldsPage(page);
      await customFieldsPage.goto();
      await customFieldsPage.clickCreateField();

      await customFieldsPage.fieldTypePicker().click();
      const optionList = page.getByTestId('picker-option-list');
      await expect(optionList).toBeVisible();

      const lastOption = page.getByTestId('custom-field-type-linking');
      // scrollIntoViewIfNeeded fails (times out) when the option lives in a
      // container that cannot scroll it into view — the reported bug.
      await lastOption.scrollIntoViewIfNeeded();
      await expect(lastOption).toBeVisible();

      await lastOption.click();
      await expect(customFieldsPage.fieldTypePicker()).toHaveValue('Linking');
    });
  }

  test('last field type is selectable at 150% zoom', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const customFieldsPage = new CustomFieldsPage(page);
    await customFieldsPage.goto();
    await customFieldsPage.clickCreateField();

    // 150% browser zoom, emulated via CDP like a real user would get.
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 });

    await customFieldsPage.fieldTypePicker().click();
    const lastOption = page.getByTestId('custom-field-type-linking');
    await lastOption.scrollIntoViewIfNeeded();
    await expect(lastOption).toBeVisible();
    await lastOption.click();
    await expect(customFieldsPage.fieldTypePicker()).toHaveValue('Linking');
  });
});
