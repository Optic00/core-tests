import { createCustomerOrgViaAPI, createTimeProjectViaAPI } from '../fixtures/api-helpers';
import { expect, test } from '../fixtures/context-path';
import { TimeTrackingPage } from '../pages/time-tracking.page';

/**
 * Overnight worklog flow (WI-1282): a 23:00-01:00 entry saves as one
 * continuous interval, reopens with both local clocks preserved, moves both
 * local dates together on a date edit, and keeps the exact stored interval
 * when only the description changes (WI-1280). The default test profile is
 * UTC, so form clocks equal stored UTC clocks.
 */
test.describe('Time Tracking overnight worklogs', () => {
  let timeTrackingPage: TimeTrackingPage;
  let projectName: string;

  test.beforeAll(async ({ request }, workerInfo) => {
    const fixtureSuffix = `${workerInfo.workerIndex}-${Date.now()}`;
    const customer = await createCustomerOrgViaAPI(request, {
      name: `E2E Overnight Customer ${fixtureSuffix}`,
      active: true,
    });
    const customerData = customer.data || customer;

    const project = await createTimeProjectViaAPI(request, {
      name: `E2E Overnight Project ${fixtureSuffix}`,
      customer_id: customerData.id,
    });
    projectName = (project.data || project).name;
  });

  test.beforeEach(async ({ page }) => {
    timeTrackingPage = new TimeTrackingPage(page);
  });

  const todayKey = () => new Date().toISOString().slice(0, 10);
  const tomorrowKey = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  test('saves, reopens, date-edits, and description-edits an overnight entry', async ({ page }) => {
    const description = `E2E Overnight ${Date.now()}`;

    await timeTrackingPage.goto();
    await timeTrackingPage.logTime({
      project: projectName,
      description,
      duration: '2h',
      date: todayKey(),
      startTime: '23:00',
      endTime: '01:00',
    });

    const row = timeTrackingPage.findWorklogByDescription(description);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText('23:00');
    await expect(row).toContainText('01:00');

    // Reopen through the mobile timer list, whose rows open the same modal
    // prefilled from the stored timestamps.
    await page.goto('/m/timer');
    const worklogButton = page
      .locator('[data-testid="worklog-edit"]', { hasText: description })
      .first();
    await expect(worklogButton).toBeVisible({ timeout: 10_000 });
    await worklogButton.click();

    const dialog = page.getByTestId('time-log-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#time-log-start-time')).toHaveValue('23:00');
    await expect(dialog.locator('#time-log-end-time')).toHaveValue('01:00');
    await expect(dialog.locator('#time-log-duration')).toHaveValue('2h');
    await expect(dialog.locator('#time-log-date')).toHaveValue(todayKey());

    // Moving the selected date preserves the clocks and the day difference.
    await dialog.locator('#time-log-date').fill(tomorrowKey());
    await dialog.getByTestId('dialog-confirm').click();
    await dialog.waitFor({ state: 'detached', timeout: 10_000 });

    await worklogButton.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#time-log-date')).toHaveValue(tomorrowKey());
    await expect(dialog.locator('#time-log-start-time')).toHaveValue('23:00');
    await expect(dialog.locator('#time-log-end-time')).toHaveValue('01:00');

    // A description-only edit must not resubmit or shift the interval.
    await dialog.locator('#time-log-description').fill(`${description} renamed`);
    await dialog.getByTestId('dialog-confirm').click();
    await dialog.waitFor({ state: 'detached', timeout: 10_000 });

    const renamedButton = page
      .locator('[data-testid="worklog-edit"]', { hasText: `${description} renamed` })
      .first();
    await expect(renamedButton).toBeVisible({ timeout: 10_000 });
    await renamedButton.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#time-log-date')).toHaveValue(tomorrowKey());
    await expect(dialog.locator('#time-log-start-time')).toHaveValue('23:00');
    await expect(dialog.locator('#time-log-end-time')).toHaveValue('01:00');
    await expect(dialog.locator('#time-log-duration')).toHaveValue('2h');
  });
});
