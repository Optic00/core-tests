import type { BrowserContext } from '@playwright/test';
import {
  createPriorityViaAPI,
  createUserViaAPI,
  deletePriorityViaAPI,
  listPrioritiesViaAPI,
} from '../fixtures/api-helpers';
import { expect, test } from '../fixtures/context-path';
import { generatePriority, generateUser } from '../fixtures/test-data';
import { PriorityManagerPage } from '../pages/priority-manager.page';

/**
 * Priority Manager E2E Tests
 * Tests CRUD operations for priorities via the admin UI.
 * The "create" test is the most important — it covers a regression where adding priorities didn't work.
 */

test.describe('Priority Manager', () => {
  let priorityManagerPage: PriorityManagerPage;
  const createdPriorityNames: string[] = [];

  test.beforeEach(async ({ page }) => {
    priorityManagerPage = new PriorityManagerPage(page);
  });

  test.afterAll(async ({ request }) => {
    // Clean up all priorities created during this test run
    const priorities = await listPrioritiesViaAPI(request);
    for (const name of createdPriorityNames) {
      const priority = priorities.find((p: { name: string }) => p.name === name);
      if (priority) {
        await deletePriorityViaAPI(request, priority.id);
      }
    }
  });

  test('should create a priority', async () => {
    const data = generatePriority();
    createdPriorityNames.push(data.name);

    await priorityManagerPage.goto();
    await priorityManagerPage.createPriority({
      name: data.name,
      description: data.description,
      sortOrder: data.sort_order,
    });
    await priorityManagerPage.verifyPriorityExists(data.name);
  });

  test('should edit a priority', async ({ request }) => {
    // Create a priority via API for setup
    const data = generatePriority('edit-test');
    createdPriorityNames.push(data.name);
    await createPriorityViaAPI(request, data);

    const newName = `E2E Priority Edited ${Date.now()}`;
    createdPriorityNames.push(newName);

    await priorityManagerPage.goto();
    await priorityManagerPage.verifyPriorityExists(data.name);

    await priorityManagerPage.editPriority(data.name, {
      name: newName,
      sortOrder: 50,
    });

    await priorityManagerPage.verifyPriorityExists(newName);
    await priorityManagerPage.verifyPriorityDoesNotExist(data.name);
  });

  test('should delete a priority', async () => {
    const data = generatePriority('delete-test');
    createdPriorityNames.push(data.name);

    await priorityManagerPage.goto();
    await priorityManagerPage.createPriority({
      name: data.name,
      description: data.description,
    });
    await priorityManagerPage.verifyPriorityExists(data.name);

    await priorityManagerPage.deletePriority(data.name);
    await priorityManagerPage.verifyPriorityDoesNotExist(data.name);
  });

  test('should show validation error for empty name', async ({ page }) => {
    await priorityManagerPage.goto();
    await priorityManagerPage.clickCreatePriority();

    // Clear the name field and try to save
    await priorityManagerPage.fillName('');
    await priorityManagerPage.clickSave();

    // Verify error message appears
    const errorMessage = await priorityManagerPage.getErrorMessage();
    expect(errorMessage).toContain('Priority name is required');

    // Verify modal stays open
    await expect(page.locator(priorityManagerPage.modal)).toBeVisible();
  });

  test('should localize Medium without changing its canonical name', async ({
    browser,
    request,
  }) => {
    const headers = { 'Sec-Fetch-Site': 'same-origin' };
    const userData = generateUser('localized-priority');
    const localizedAdmin = await createUserViaAPI(request, userData);
    const permissionsResponse = await request.get('/api/permissions', { headers });
    expect(permissionsResponse.ok()).toBeTruthy();
    const permissions = await permissionsResponse.json();
    const systemAdminPermission = permissions.find(
      (permission: { permission_key: string }) => permission.permission_key === 'system.admin'
    );
    expect(systemAdminPermission, 'system.admin permission').toBeDefined();
    const grantResponse = await request.post('/api/permissions/global/grant', {
      headers,
      data: { user_id: localizedAdmin.id, permission_id: systemAdminPermission.id },
    });
    expect(grantResponse.ok()).toBeTruthy();

    const prioritiesResponse = await request.get('/api/v2/priorities', {
      headers: { ...headers, 'Accept-Language': 'en' },
    });
    expect(prioritiesResponse.ok()).toBeTruthy();
    const priorities = (await prioritiesResponse.json()).data;
    const medium = priorities.find(
      (priority: { builtin_key?: string }) => priority.builtin_key === 'medium'
    );
    expect(medium, 'seeded Medium priority').toBeDefined();

    const translationPath = `/api/admin/object-translations/priority/${medium.id}/name/de`;
    await request.delete(translationPath, { headers });

    let localeContext: BrowserContext | undefined;
    const openInLocale = async (locale: 'de' | 'en') => {
      await localeContext?.close();
      const regionalResponse = await request.put(
        `/api/users/${localizedAdmin.id}/regional-settings`,
        {
          headers,
          data: { language: locale, timezone: 'Europe/Zurich' },
        }
      );
      expect(regionalResponse.ok()).toBeTruthy();
      localeContext = await browser.newContext({
        baseURL: process.env.BASE_URL,
        locale,
      });
      const loginResponse = await localeContext.request.post('/api/auth/login', {
        headers,
        data: {
          email_or_username: userData.username,
          password: userData.password_hash,
          remember_me: false,
        },
      });
      expect(loginResponse.ok()).toBeTruthy();
      const localizedPage = await localeContext.newPage();
      await localizedPage.goto('/admin/priorities');
      await expect
        .poll(() => localizedPage.evaluate(() => document.documentElement.lang))
        .toBe(locale);
      return localizedPage;
    };

    try {
      let localizedPage = await openInLocale('de');
      let row = localizedPage.getByTestId(`priority-row-${medium.id}`);
      await expect(row).toBeVisible();

      await localizedPage.getByTestId(`priority-actions-${medium.id}`).click();
      await localizedPage.getByTestId(`priority-edit-${medium.id}`).click();
      const activeName = localizedPage.getByTestId('localized-object-name-de');
      await expect(activeName).toBeVisible();
      await activeName.fill('Mittlere Priorität');
      await localizedPage.getByTestId('dialog-confirm').click();

      await expect(row).toContainText('Mittlere Priorität');

      const germanResponse = await request.get('/api/v2/priorities', {
        headers: { ...headers, 'Accept-Language': 'de' },
      });
      expect(germanResponse.ok()).toBeTruthy();
      const germanPriorities = (await germanResponse.json()).data;
      const localizedMedium = germanPriorities.find(
        (priority: { id: number }) => priority.id === medium.id
      );
      expect(localizedMedium.name).toBe('Medium');
      expect(localizedMedium.display_name).toBe('Mittlere Priorität');

      localizedPage = await openInLocale('en');
      row = localizedPage.getByTestId(`priority-row-${medium.id}`);
      await expect(row).toContainText('Medium');

      localizedPage = await openInLocale('de');
      row = localizedPage.getByTestId(`priority-row-${medium.id}`);
      await expect(row).toContainText('Mittlere Priorität');

      await localizedPage.getByTestId(`priority-actions-${medium.id}`).click();
      await localizedPage.getByTestId(`priority-edit-${medium.id}`).click();
      await localizedPage.getByTestId('localized-object-overrides-toggle').click();
      await localizedPage.getByTestId('localized-object-remove-name-de').click();
      await expect(localizedPage.getByTestId('localized-object-name-de')).not.toHaveValue(
        'Mittlere Priorität'
      );
      await localizedPage.getByTestId('dialog-confirm').click();
      await expect(row).not.toContainText('Mittlere Priorität');
    } finally {
      await request.delete(translationPath, { headers });
      await localeContext?.close();
      await request.delete(`/api/users/${localizedAdmin.id}`, { headers });
    }
  });
});
