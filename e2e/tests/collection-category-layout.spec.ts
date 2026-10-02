import { expect, test } from '../fixtures/errors';

test('collection category controls keep the name field wide and actions compact', async ({
  page,
  allowConsoleError,
}) => {
  // The disposable server can lack an active theme before its default is seeded.
  allowConsoleError(/\/api\/themes\/active/);
  allowConsoleError(/Failed to load active theme/);

  await page.goto('/collections');
  await page.getByTestId('collection-categories-manage').click();

  const form = page.getByTestId('category-create-form');
  const name = page.getByTestId('category-create-name');
  const color = page.getByTestId('category-create-color');
  const submit = page.getByTestId('category-create-submit');

  await expect(form).toBeVisible();
  await expect(name).toBeVisible();
  await expect(color).toBeVisible();
  await expect(submit).toBeVisible();

  const [formBox, nameBox, colorBox, submitBox] = await Promise.all([
    form.boundingBox(),
    name.boundingBox(),
    color.boundingBox(),
    submit.boundingBox(),
  ]);

  if (!formBox || !nameBox || !colorBox || !submitBox) {
    throw new Error('Category controls must have measurable layout boxes');
  }
  expect(nameBox.width).toBeGreaterThan(formBox.width / 2);
  expect(colorBox.width).toBeLessThan(40);
  expect(submitBox.height).toBeLessThanOrEqual(nameBox.height + 2);
});
