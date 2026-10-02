import { expect, test } from "../fixtures/context-path";

/**
 * Admin status and status-category managers (/admin/statuses).
 * These pages previously had no browser coverage; the tests drive the real
 * CRUD modals so a broken render, API drift, or a failing save is caught.
 */

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };

test.describe("Admin statuses", () => {
  test("creates, renames, and deletes a status through the admin UI", async ({
    page,
    request,
  }) => {
    const name = `E2E Status ${Date.now()}`;
    const renamed = `${name} Renamed`;

    await page.goto("/admin/statuses");
    await expect(page.locator('[data-testid^="status-row-"]').first()).toBeVisible();

    // Create — the modal preselects the first status category.
    await page.getByTestId("status-add").click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await page.getByTestId("status-modal-name").fill(name);
    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v2/statuses") &&
        response.request().method() === "POST",
    );
    await page.getByTestId("status-modal-submit").click();
    const created = await (await createResponse).json();
    const statusId = created.data.id;
    expect(statusId).toBeGreaterThan(0);
    const row = page.getByTestId(`status-row-${statusId}`);
    await expect(row).toBeVisible();

    // The status is visible through the catalog API and after a reload.
    const listResponse = await request.get("/api/v2/statuses", { headers: SEC_FETCH });
    expect(listResponse.ok()).toBeTruthy();
    const listed = (await listResponse.json()).data as Array<{
      id: number;
      name: string;
    }>;
    expect(listed.find((status) => status.id === statusId)?.name).toBe(name);
    await page.reload();
    await expect(page.getByTestId(`status-row-${statusId}`)).toBeVisible();

    // Rename through the row action menu (canonical name field).
    await page.getByTestId(`status-actions-${statusId}`).click();
    await page.getByTestId(`status-edit-${statusId}`).click();
    await expect(dialog).toBeVisible();
    await page.getByTestId(/^localized-object-name-/).fill(renamed);
    await page.getByTestId("status-modal-submit").click();
    await expect(row).toContainText(renamed);

    // Delete via the row action menu and confirm.
    await page.getByTestId(`status-actions-${statusId}`).click();
    await page.getByTestId(`status-delete-${statusId}`).click();
    await expect(dialog).toBeVisible();
    await page.getByTestId("dialog-confirm").click();
    await expect(page.getByTestId(`status-row-${statusId}`)).toHaveCount(0);

    const finalList = await request.get("/api/v2/statuses", { headers: SEC_FETCH });
    expect(finalList.ok()).toBeTruthy();
    const remaining = (await finalList.json()).data as Array<{ id: number }>;
    expect(remaining.find((status) => status.id === statusId)).toBeUndefined();
  });

  test("protected builtin statuses offer edit but no delete", async ({ page, request }) => {
    await page.goto("/admin/statuses");
    await expect(page.locator('[data-testid^="status-row-"]').first()).toBeVisible();

    const statusesResponse = await request.get("/api/v2/statuses", { headers: SEC_FETCH });
    expect(statusesResponse.ok()).toBeTruthy();
    const statuses = (await statusesResponse.json()).data as Array<{
      id: number;
      builtin_key?: string | null;
    }>;
    const protectedStatus = statuses.find(
      (status) => status.builtin_key === "open" || status.builtin_key === "done",
    );
    expect(protectedStatus, "a seeded builtin status exists").toBeDefined();

    await page.getByTestId(`status-actions-${protectedStatus!.id}`).click();
    await expect(page.getByTestId(`status-edit-${protectedStatus!.id}`)).toBeVisible();
    await expect(page.getByTestId(`status-delete-${protectedStatus!.id}`)).toHaveCount(0);
  });

  test("creates and deletes a status category, and blocks delete while statuses use it", async ({
    page,
    request,
  }) => {
    const name = `E2E Category ${Date.now()}`;
    const renamed = `${name} Renamed`;

    await page.goto("/admin/statuses?subtab=status-categories");
    await expect(
      page.locator('[data-testid^="status-category-row-"]').first(),
    ).toBeVisible();

    // A category that already owns statuses must not offer deletion.
    const [categoriesResponse, statusesResponse] = await Promise.all([
      request.get("/api/v2/status-categories", { headers: SEC_FETCH }),
      request.get("/api/v2/statuses", { headers: SEC_FETCH }),
    ]);
    expect(categoriesResponse.ok()).toBeTruthy();
    expect(statusesResponse.ok()).toBeTruthy();
    const categories = (await categoriesResponse.json()).data as Array<{
      id: number;
      name: string;
    }>;
    const statuses = (await statusesResponse.json()).data as Array<{
      id: number;
      category: { id: number };
    }>;
    const usedCategory = categories.find((category) =>
      statuses.some((status) => status.category?.id === category.id),
    );
    expect(usedCategory, "a category with statuses exists").toBeDefined();

    await page.getByTestId(`status-category-actions-${usedCategory!.id}`).click();
    await expect(page.getByTestId(`status-category-edit-${usedCategory!.id}`)).toBeVisible();
    await expect(page.getByTestId(`status-category-delete-${usedCategory!.id}`)).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    // Create a fresh category.
    await page.getByTestId("status-category-add").click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await page.getByTestId("status-category-name").fill(name);
    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v2/status-categories") &&
        response.request().method() === "POST",
    );
    await page.getByTestId("status-category-save").click();
    const created = await (await createResponse).json();
    const categoryId = created.data.id;
    expect(categoryId).toBeGreaterThan(0);
    const row = page.getByTestId(`status-category-row-${categoryId}`);
    await expect(row).toBeVisible();

    // Rename it and verify the visible name follows.
    await page.getByTestId(`status-category-actions-${categoryId}`).click();
    await page.getByTestId(`status-category-edit-${categoryId}`).click();
    await expect(dialog).toBeVisible();
    await page.getByTestId(/^localized-object-name-/).fill(renamed);
    await page.getByTestId("status-category-save").click();
    await expect(row).toContainText(renamed);

    // Delete the unused category.
    await page.getByTestId(`status-category-actions-${categoryId}`).click();
    await page.getByTestId(`status-category-delete-${categoryId}`).click();
    await expect(dialog).toBeVisible();
    await page.getByTestId("dialog-confirm").click();
    await expect(page.getByTestId(`status-category-row-${categoryId}`)).toHaveCount(0);
  });
});
