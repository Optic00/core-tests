import type { Page } from '@playwright/test';
import { test as base, expect } from '../fixtures/context-path';

type Label = { id: number; name: string };
const headers = { 'Sec-Fetch-Site': 'same-origin' };

const test = base.extend<{
  labels: { own: Label; shared: Label; prefix: string };
}>({
  labels: async ({ request }, use, testInfo) => {
    const prefix = `pw-label-${testInfo.testId}-${testInfo.workerIndex}`;
    const me = await request.get('/api/auth/me', { headers });
    expect(me.status()).toBe(200);
    const { user } = await me.json();
    const create = async (suffix: string, userId: number | null): Promise<Label> => {
      const response = await request.post('/api/personal-labels', {
        headers,
        data: {
          name: `${prefix}-${suffix}`,
          user_id: userId,
          color: '#3B82F6',
        },
      });
      expect(response.status()).toBe(201);
      return response.json();
    };
    try {
      const own = await create('own', user.id);
      const shared = await create('shared', null);
      await use({ own, shared, prefix });
    } finally {
      // Include labels created through the UI, even if a later assertion failed.
      const response = await request.get('/api/personal-labels', { headers });
      expect(response.status()).toBe(200);
      const remaining: Label[] = await response.json();
      for (const label of remaining.filter((entry) => entry.name.startsWith(prefix))) {
        const deleted = await request.delete(`/api/personal-labels/${label.id}`, { headers });
        expect(deleted.status()).toBe(204);
      }
    }
  },
});

async function openLabels(page: Page) {
  const profileReady = page.waitForResponse(
    (response) => response.url().endsWith('/api/me/agents') && response.ok()
  );
  await page.goto('/profile');
  await profileReady;
  const loaded = page.waitForResponse(
    (response) => response.url().endsWith('/api/personal-labels') && response.ok()
  );
  await page.getByTestId('profile-tab-labels').click();
  await loaded;
  await expect(page.getByTestId('personal-label-search')).toBeVisible();
}

test.use({ trace: 'retain-on-failure' });

test.describe('Personal label browser workflows', () => {
  test.describe.configure({ retries: 0 });

  test('creates a named label and keeps it after revisiting the profile', async ({
    page,
    labels,
  }) => {
    const name = `${labels.prefix}-created`;
    await openLabels(page);
    await page.getByTestId('personal-label-new').click();
    await page.getByTestId('personal-label-name').fill(name);
    await page.getByTestId('personal-label-save').click();
    await expect(page.getByTestId('personal-label-form')).toBeHidden();
    await page.getByTestId('personal-label-search').fill(name);
    await expect(page.getByTestId('personal-label-row')).toHaveText(name);

    await openLabels(page);
    await page.getByTestId('personal-label-search').fill(name);
    await expect(page.getByTestId('personal-label-row')).toHaveCount(1);
    await expect(page.getByTestId('personal-label-row')).toHaveText(name);
  });

  test('renames the existing label without creating a second label', async ({ page, labels }) => {
    const name = `${labels.prefix}-renamed`;
    await openLabels(page);
    await page.getByTestId(`personal-label-edit-${labels.own.id}`).click();
    await expect(page.getByTestId('personal-label-name')).toHaveValue(labels.own.name);
    await page.getByTestId('personal-label-name').fill(name);
    await page.getByTestId('personal-label-save').click();
    await expect(page.getByTestId('personal-label-form')).toBeHidden();
    await page.getByTestId('personal-label-search').fill(labels.prefix);
    await expect(page.getByTestId('personal-label-row')).toHaveText(name);

    await openLabels(page);
    await page.getByTestId('personal-label-search').fill(labels.prefix);
    await expect(page.getByTestId('personal-label-row')).toHaveCount(1);
    await expect(page.getByTestId('personal-label-row')).toHaveText(name);
    await page.getByTestId(`personal-label-edit-${labels.own.id}`).click();
    await expect(page.getByTestId('personal-label-name')).toHaveValue(name);
  });

  test('cancelling an edit discards the draft and preserves the saved name', async ({
    page,
    labels,
  }) => {
    await openLabels(page);
    await page.getByTestId(`personal-label-edit-${labels.own.id}`).click();
    await page.getByTestId('personal-label-name').fill(`${labels.prefix}-discarded`);
    await page.getByTestId('personal-label-cancel').click();
    await expect(page.getByTestId('personal-label-form')).toBeHidden();
    await page.getByTestId(`personal-label-edit-${labels.own.id}`).click();
    await expect(page.getByTestId('personal-label-name')).toHaveValue(labels.own.name);

    await openLabels(page);
    await page.getByTestId('personal-label-search').fill(labels.prefix);
    await expect(page.getByTestId('personal-label-row')).toHaveText(labels.own.name);
  });

  test('deleting requires confirmation and stays deleted after revisiting', async ({
    page,
    labels,
  }) => {
    await openLabels(page);
    await page.getByTestId('personal-label-search').fill(labels.own.name);
    await page.getByTestId(`personal-label-delete-${labels.own.id}`).click();
    await expect(page.locator('#dialog-description')).toContainText(labels.own.name);
    await page.getByTestId('dialog-cancel').click();
    await expect(page.getByTestId('dialog-confirm')).toBeHidden();
    await expect(page.getByTestId('personal-label-row')).toHaveText(labels.own.name);

    await openLabels(page);
    await page.getByTestId(`personal-label-delete-${labels.own.id}`).click();
    await page.getByTestId('dialog-confirm').click();
    await expect(page.getByTestId(`personal-label-delete-${labels.own.id}`)).toBeHidden();

    await openLabels(page);
    await page.getByTestId('personal-label-search').fill(labels.own.name);
    await expect(page.getByTestId('personal-label-row')).toHaveCount(0);
  });

  test('search is case insensitive and clearing a nonmatch restores labels', async ({
    page,
    labels,
  }) => {
    await openLabels(page);
    const search = page.getByTestId('personal-label-search');
    await search.fill(labels.own.name.toUpperCase());
    await expect(page.getByTestId('personal-label-row')).toHaveText(labels.own.name);
    await search.fill(`${labels.prefix}-no-match`);
    await expect(page.getByTestId('personal-label-row')).toHaveCount(0);
    await search.fill('');
    await expect(page.getByTestId(`personal-label-edit-${labels.own.id}`)).toBeVisible();
  });

  test('the personal manager excludes shared labels even for an administrator', async ({
    page,
    labels,
  }) => {
    await openLabels(page);
    await page.getByTestId('personal-label-search').fill(labels.prefix);
    await expect(page.getByTestId('personal-label-row')).toHaveText(labels.own.name);
    await expect(page.getByTestId(`personal-label-edit-${labels.shared.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`personal-label-delete-${labels.shared.id}`)).toHaveCount(0);
    await page.getByTestId('personal-label-search').fill(labels.shared.name);
    await expect(page.getByTestId('personal-label-row')).toHaveCount(0);
  });

  test('a failed save preserves the draft and retry persists the requested name', async ({
    page,
    labels,
  }) => {
    const name = `${labels.prefix}-recovered`;
    await openLabels(page);
    await page.getByTestId(`personal-label-edit-${labels.own.id}`).click();
    await page.getByTestId('personal-label-name').fill(name);
    await page.route(`**/api/personal-labels/${labels.own.id}`, async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Label service temporarily unavailable',
          }),
        });
      } else {
        await route.continue();
      }
    });
    await page.getByTestId('personal-label-save').click();
    await expect(page.getByTestId('toast').first()).toHaveAttribute('data-toast-variant', 'error');
    await expect(page.getByTestId('toast').first()).toContainText(
      'Label service temporarily unavailable'
    );
    await expect(page.getByTestId('personal-label-name')).toHaveValue(name);
    await expect(page.getByTestId('personal-label-save')).toBeEnabled();
    await page.getByTestId('personal-label-search').fill(labels.prefix);
    await expect(page.getByTestId('personal-label-row')).toHaveText(labels.own.name);

    await page.unroute(`**/api/personal-labels/${labels.own.id}`);
    await page.getByTestId('personal-label-save').click();
    await expect(page.getByTestId('personal-label-form')).toBeHidden();
    await expect(page.getByTestId('personal-label-row')).toHaveText(name);
    await openLabels(page);
    await page.getByTestId('personal-label-search').fill(labels.prefix);
    await expect(page.getByTestId('personal-label-row')).toHaveCount(1);
    await expect(page.getByTestId('personal-label-row')).toHaveText(name);
  });
});
