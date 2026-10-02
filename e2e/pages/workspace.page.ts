import { expect, type Page } from '../fixtures/context-path';

/**
 * Page Object for Workspace Management
 */
export class WorkspacePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // Selectors
  readonly workspacesLink = 'a:has-text("Workspaces")';
  readonly createButton = '[data-testid="workspaces-create"]';
  readonly workspaceModal = 'div[role="dialog"]';
  readonly nameInput = '#workspace-name';
  readonly keyInput = '#workspace-key';
  readonly workspaceRow = 'tbody tr';
  readonly successToast =
    'text=created successfully, text=updated successfully, text=deleted successfully';
  readonly errorToast = '.error, .error-message, [role="alert"]';

  /**
   * Wait for the paginated workspace-list fetch chain to finish: an OK
   * response whose page is at least the total page count seen in the chain.
   */
  private listChainSettled() {
    return this.page.waitForResponse(async (response) => {
      if (response.request().method() !== 'GET' || !response.url().includes('/api/v2/workspaces?')) {
        return false;
      }
      if (!response.ok()) return false;
      const url = new URL(response.url());
      const page = Number(url.searchParams.get('page') ?? '1');
      const body = await response.json().catch(() => null);
      const totalPages = body?.pagination?.total_pages;
      return typeof totalPages === 'number' && totalPages >= 1 && page >= totalPages;
    });
  }

  /**
   * Navigate to workspaces page
   */
  async goto() {
    // The list streams in across paginated API responses, so wait for the
    // final page request before returning — under full-suite load the
    // multi-page fetch completes after 'load', and callers assert on rows
    // right after.
    let listSettled = this.listChainSettled();
    await this.page.goto('/workspaces');
    if (!(await listSettled.then(() => true).catch(() => false))) {
      // A failed page request leaves the app's workspace store permanently
      // empty for the session; reload once for a clean second pass.
      listSettled = this.listChainSettled();
      await this.page.reload();
      await listSettled;
    }
  }

  /**
   * Navigate via menu
   */
  async navigateViaMenu() {
    await this.page.click(this.workspacesLink);
  }

  /**
   * Click create workspace button and wait for the form to mount.
   * The CreateModal is lazily loaded — the dialog backdrop appears before the form.
   */
  async clickCreate() {
    await this.page.click(this.createButton);
    // Wait for the workspace name input in the modal (uses placeholder-based locator
    // because the create modal form inputs may not have id attributes in DOM)
    await this.page.getByPlaceholder('Workspace name').waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Fill workspace form in the create modal.
   * Uses pressSequentially() instead of fill() to trigger Svelte 5 $state reactivity
   * via real input events per keystroke.
   * The name field auto-generates the key via onNameInput(), so key is only filled
   * if explicitly provided and different from what would be auto-generated.
   * Description uses MilkdownEditor (rich text editor) — insertText() avoids global hotkeys.
   */
  async fillForm(data: { name: string; key?: string; description?: string }) {
    // Name field — clear and type char-by-char to trigger Svelte reactivity
    const nameField = this.page.getByPlaceholder('Workspace name');
    await nameField.click();
    await nameField.fill(''); // clear any existing value
    await nameField.pressSequentially(data.name, { delay: 30 });

    // Key field — only fill if explicitly provided (name auto-generates key)
    if (data.key) {
      const keyField = this.page.getByPlaceholder('Workspace key');
      await keyField.click();
      await keyField.fill(''); // clear auto-generated value
      await keyField.pressSequentially(data.key, { delay: 30 });
    }

    // Description is a MilkdownEditor (ProseMirror). Use insertText to avoid
    // character-by-character typing which can lose focus to global hotkeys.
    if (data.description) {
      const dialog = this.page.locator(this.workspaceModal);
      const editor = dialog.locator('.ProseMirror');
      await editor.waitFor({ state: 'attached', timeout: 5000 });
      await editor.click();
      await this.page.keyboard.insertText(data.description);
    }
  }

  /**
   * Submit the create modal form by clicking the submit button.
   */
  async clickSave() {
    const submitBtn = this.page.locator('#create-modal-submit');
    await submitBtn.waitFor({ state: 'visible', timeout: 5000 });
    await submitBtn.click();
    // `createWorkspace` follows up with a strict "modal detached" wait, so
    // nothing more is needed here.
  }

  /**
   * Create a new workspace
   */
  async createWorkspace(data: { name: string; key?: string; description?: string }) {
    await this.goto();
    await this.clickCreate();
    await this.fillForm(data);
    const createResponse = this.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/v2/workspaces') &&
        response.status() === 201,
    );
    await this.clickSave();
    const created = (await (await createResponse).json()).data;

    // After creation, the app closes the modal and navigates to /workspaces/{id}.
    // Wait for modal to disappear (detached or hidden) — works reliably for SPA navigation.
    await this.page.locator(this.workspaceModal).waitFor({ state: 'detached', timeout: 15000 });

    // Navigate to list and verify workspace exists
    await this.goto();
    await this.sortByNewestFirst();
    await expect(this.page.getByTestId(`workspace-row-${created.id}`)).toBeVisible();
    return created;
  }

  /**
   * Sort the directory by created date, newest first. The table pages at 50
   * rows, so a freshly created workspace is only reachable on page 1 when the
   * newest entries sort first.
   */
  async sortByNewestFirst() {
    const createdHeader = this.page.getByTestId('table-column-created_at');
    const direction = await createdHeader.getAttribute('aria-sort');
    if (direction === 'descending') return;
    await createdHeader.click();
    if (direction !== 'ascending') {
      // Unsorted sorts ascending on the first click, descending on the second.
      await createdHeader.click();
    }
    await expect(createdHeader).toHaveAttribute('aria-sort', 'descending');
  }

  /**
   * Find workspace by name
   */
  async findWorkspaceByName(name: string) {
    // Find table row containing the workspace name
    await this.sortByNewestFirst();
    return this.page.locator(`${this.workspaceRow}:has-text("${name}")`).first();
  }

  /**
   * Verify workspace exists
   */
  async verifyWorkspaceExists(name: string) {
    const workspace = await this.findWorkspaceByName(name);
    await expect(workspace).toBeVisible({ timeout: 10000 });
  }

  /**
   * Click on a workspace to view details
   */
  async clickWorkspace(name: string) {
    const workspace = await this.findWorkspaceByName(name);
    await workspace.click();
    // The row navigates to /workspaces/{id}, which then redirects to the
    // workspace's default view. Under load that redirect can lag, so bound
    // the wait explicitly instead of the 5s expect default.
    await expect(this.page).toHaveURL(/\/workspaces\/\d+\/board(?:[/?]|$)/, { timeout: 15000 });
    await expect(this.page.getByTestId('board-view')).toBeVisible();
  }

  /**
   * Get the numeric workspace ID by navigating to the workspace list,
   * clicking the workspace row, and extracting the ID from the resulting URL.
   */
  async getWorkspaceId(name: string): Promise<string> {
    await this.goto();
    await this.clickWorkspace(name);
    const match = this.page.url().match(/\/workspaces\/(\d+)/);
    if (!match) throw new Error(`Cannot extract workspace ID from URL: ${this.page.url()}`);
    return match[1];
  }

  /**
   * Open dropdown menu for a workspace row
   */
  private async openRowDropdown(name: string) {
    const row = await this.findWorkspaceByName(name);
    await row.locator('button').last().click();
    await this.page.locator('button[role="menuitem"]').first().waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Click a menuitem from the open dropdown
   */
  private async clickMenuItem(text: string) {
    await this.page.locator('button[role="menuitem"]').filter({ hasText: text }).click();
  }

  /**
   * Extract workspace ID from the current URL after navigating to a workspace.
   * URL pattern: /workspaces/{id} or /workspaces/{id}/settings/...
   */
  private getWorkspaceIdFromUrl(): string {
    const match = this.page.url().match(/\/workspaces\/(\d+)/);
    if (!match) throw new Error(`Cannot extract workspace ID from URL: ${this.page.url()}`);
    return match[1];
  }

  /**
   * Edit a workspace.
   * The "Edit" dropdown item navigates to /workspaces/{id}. From there we go
   * to the settings/general tab and update fields.
   */
  async editWorkspace(
    currentName: string,
    newData: {
      name?: string;
      description?: string;
    }
  ) {
    await this.goto();

    // Open dropdown and click Edit — this navigates to /workspaces/{id}
    await this.openRowDropdown(currentName);
    await this.clickMenuItem('Edit');
    await this.page.waitForURL(/\/workspaces\/\d+/, { timeout: 10000 });

    // Extract workspace ID from URL then navigate to settings/general
    const workspaceId = this.getWorkspaceIdFromUrl();
    await this.page.goto(`/workspaces/${workspaceId}/settings/general`);

    // Wait for the workspace to finish loading (name input populated) before
    // editing — an in-flight load can otherwise clobber freshly typed values.
    const nameField = this.page.locator(this.nameInput);
    await expect(nameField).not.toHaveValue('', { timeout: 10000 });

    // The v2 PATCH contract has no workspace key; the form must not offer it.
    await expect(this.page.locator(this.keyInput)).toBeDisabled();

    // Settings page uses standard Input/Textarea components with proper IDs
    if (newData.name) {
      await nameField.fill(newData.name);
    }
    if (newData.description) {
      // Settings page uses a plain Textarea, not MilkdownEditor
      await this.page.fill('#workspace-description', newData.description);
    }

    // Click "Save Changes" and wait for the PATCH to complete
    const saveRequest = this.page.waitForResponse(
      (res) => res.request().method() === 'PATCH' && res.url().includes('/workspaces/'),
      { timeout: 10000 }
    );
    await this.page.click('button:has-text("Save Changes")');
    const response = await saveRequest;
    expect(response.ok(), `workspace PATCH failed: ${response.status()}`).toBeTruthy();

    // If name was updated, navigate to list and verify
    if (newData.name) {
      await this.goto();
      await this.verifyWorkspaceExists(newData.name);
    }
  }

  /**
   * Delete a workspace.
   * Navigate to workspace settings → Remove Workspace tab → confirm deletion.
   */
  async deleteWorkspace(name: string) {
    await this.goto();

    // Open the workspace dropdown and click Edit — navigates to /workspaces/{id}
    await this.openRowDropdown(name);
    await this.clickMenuItem('Edit');
    await this.page.waitForURL(/\/workspaces\/\d+/, { timeout: 10000 });

    // Navigate to danger tab (labeled "Remove Workspace")
    const workspaceId = this.getWorkspaceIdFromUrl();
    await this.page.goto(`/workspaces/${workspaceId}/settings/danger`);

    // Reveal the confirmation form via the stable testid (the button's
    // styling uses design-system tokens, not a fixed class).
    await this.page.getByTestId('delete-workspace-open').click();

    // Wait for confirmation input to appear
    await this.page.locator('#delete-confirm').waitFor({ state: 'visible', timeout: 5000 });

    // Type the workspace name in the confirmation input
    await this.page.fill('#delete-confirm', name);

    // Click confirm (disabled until the exact workspace name is typed)
    await this.page.getByTestId('delete-workspace-confirm').click();

    // After deletion, the app redirects to /workspaces after a 1s delay
    await this.page.waitForURL(/\/workspaces$/, { timeout: 15000 });
  }

  /**
   * Verify workspace does not exist
   */
  async verifyWorkspaceDoesNotExist(name: string, workspaceId?: string) {
    // Re-enter through goto() so the paged fetch chain has settled before
    // absence is asserted — an in-flight list renders an empty table.
    await this.goto();
    const row = workspaceId
      ? this.page.getByTestId(`workspace-row-${workspaceId}`)
      : this.page.locator(`${this.workspaceRow}:has-text("${name}")`).first();
    // The table mounts 50 rows per page, so absence must hold on every page,
    // not just the first one. Walk pages until the pager reports the end.
    const nextButton = this.page.getByTestId('table-pagination-next');
    const status = this.page.getByTestId('table-pagination-status');
    // 40 pages × 50 rows bounds the walk; a larger directory is a test bug.
    for (let pageNumber = 0; pageNumber < 40; pageNumber++) {
      await expect(row).not.toBeVisible();
      if (!(await nextButton.isVisible())) return;
      if (await nextButton.isDisabled()) return;
      const pageLabel = await status.textContent();
      await nextButton.click();
      await expect(status).not.toHaveText(pageLabel ?? '');
    }
    throw new Error('workspace table exceeded 40 pages; widen the bound or shrink fixtures');
  }

  /**
   * Get workspace count
   */
  async getWorkspaceCount(): Promise<number> {
    const workspaces = await this.page.locator(this.workspaceRow).count();
    return workspaces;
  }

  /**
   * Search for workspace
   */
  async searchWorkspace(query: string) {
    const searchInput = this.page.locator('input[type="search"], input[placeholder*="Search"]');
    await searchInput.fill(query);
    // Debounced filter refreshes the list; wait for the network to settle.
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }
}
