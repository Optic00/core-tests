import { type APIRequestContext, expect, test } from '../fixtures/context-path';

/**
 * Workflow designer palette: inline status creation, palette filtering, and
 * the collapsed transition-hint control.
 *
 * The designer sidebar reuses the shared status dialog
 * (dialogs/StatusModal.svelte — the same dialog the admin statuses page
 * uses) behind a "+" button, filters the palette through a search box, and
 * keeps the transition instructions behind a help toggle so the palette
 * stays compact.
 *
 * Creation must round-trip: POST /statuses persists the status in the
 * global catalog, the palette pins it to the top so it cannot get buried,
 * clicking it adds it to the canvas, and saving the workflow persists it
 * as part of the transition graph.
 */

const SEC_FETCH = { 'Sec-Fetch-Site': 'same-origin' };

interface Status {
  id: number;
  name: string;
  category_id: number;
}

interface Workflow {
  id: number;
  name: string;
}

interface WorkflowTransition {
  id: number;
  from_status_id: number | null;
  to_status_id: number;
  from_all_statuses?: boolean;
}

async function createStatus(
  request: APIRequestContext,
  name: string,
  categoryId: number
): Promise<Status> {
  const resp = await request.post('/api/v2/statuses', {
    headers: SEC_FETCH,
    data: { name, category_id: categoryId },
  });
  expect(resp.ok(), `create status ${name}: ${resp.status()} ${await resp.text()}`).toBeTruthy();
  return (await resp.json()).data;
}

async function createWorkflow(request: APIRequestContext, name: string): Promise<Workflow> {
  const resp = await request.post('/api/v2/workflows', {
    headers: SEC_FETCH,
    data: { name, description: 'e2e workflow designer status creation' },
  });
  expect(resp.ok(), `create workflow ${name}: ${resp.status()} ${await resp.text()}`).toBeTruthy();
  return (await resp.json()).data;
}

async function setInitialTransition(
  request: APIRequestContext,
  workflowId: number,
  initialStatusId: number
): Promise<void> {
  const resp = await request.put(`/api/v2/workflows/${workflowId}/transitions`, {
    headers: SEC_FETCH,
    data: { transitions: [{ from_status_id: null, to_status_id: initialStatusId }] },
  });
  expect(resp.ok(), `seed transitions: ${resp.status()} ${await resp.text()}`).toBeTruthy();
}

async function defaultCategoryId(request: APIRequestContext): Promise<number> {
  const resp = await request.get('/api/v2/status-categories', { headers: SEC_FETCH });
  expect(resp.ok()).toBeTruthy();
  const cats: Array<{ id: number; is_default: boolean }> = (await resp.json()).data;
  const def = cats.find((c) => c.is_default) ?? cats[0];
  expect(def, 'no status categories seeded').toBeTruthy();
  return def.id;
}

function normalizeTransition(transition: {
  id: number;
  from: { id: number } | null;
  to: { id: number };
}): WorkflowTransition {
  return {
    id: transition.id,
    from_status_id: transition.from?.id ?? null,
    to_status_id: transition.to.id,
  };
}

async function getTransitions(
  request: APIRequestContext,
  workflowId: number
): Promise<WorkflowTransition[]> {
  const resp = await request.get(`/api/v2/workflows/${workflowId}/transitions`, {
    headers: SEC_FETCH,
  });
  expect(resp.ok(), `get transitions: ${resp.status()}`).toBeTruthy();
  return (await resp.json()).data.map(normalizeTransition);
}

async function listStatuses(
  request: APIRequestContext
): Promise<Array<{ id: number; name: string; builtin_key?: string | null }>> {
  const resp = await request.get('/api/v2/statuses', { headers: SEC_FETCH });
  expect(resp.ok(), `list statuses: ${resp.status()}`).toBeTruthy();
  return (await resp.json()).data;
}

test.describe('Workflow designer palette', () => {
  test('creating a status pins it to the palette top and persists after add + save', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);

    const prefix = `wfs-create-${Date.now()}`;
    const categoryId = await defaultCategoryId(request);
    const todo = await createStatus(request, `${prefix}-Todo`, categoryId);
    const workflow = await createWorkflow(request, `${prefix}-wf`);
    await setInitialTransition(request, workflow.id, todo.id);

    await page.goto(`/workflows/${workflow.id}/design`);
    await expect(page.getByTestId('workflow-canvas')).toBeVisible({ timeout: 20_000 });

    const statusName = `${prefix}-Blocked`;
    await page.getByTestId('workflow-status-add').click();
    const nameInput = page.getByTestId('status-modal-name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(statusName);
    // Category is preselected (first category) — the dialog must be usable
    // without touching the picker.
    await expect(page.getByTestId('status-modal-submit')).toBeEnabled();

    const createResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().endsWith('/api/v2/statuses') && resp.request().method() === 'POST'
    );
    await page.getByTestId('status-modal-submit').click();
    const createResponse = await createResponsePromise;
    expect(createResponse.ok(), `create status: ${createResponse.status()}`).toBeTruthy();
    const created: Status = (await createResponse.json()).data;

    // The dialog closes and the new status surfaces at the TOP of the
    // palette — never buried — regardless of catalog order. Compare it
    // against the seeded builtin card, which the unsorted catalog lists
    // before any freshly created status.
    await expect(page.getByTestId('status-modal-name')).toBeHidden();
    const createdCard = page.getByTestId(`workflow-status-option-${created.id}`);
    await expect(createdCard).toBeVisible({ timeout: 10_000 });
    const statusesAfterCreate = await listStatuses(request);
    const anchor = statusesAfterCreate.find((s) => s.builtin_key === 'open');
    expect(anchor, 'seeded open status exists').toBeDefined();
    const anchorCard = page.getByTestId(`workflow-status-option-${anchor!.id}`);
    await expect(anchorCard).toBeVisible();
    const createdBox = await createdCard.boundingBox();
    const anchorBox = await anchorCard.boundingBox();
    expect(createdBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
      anchorBox?.y ?? Number.NEGATIVE_INFINITY
    );

    // Creation alone must not touch the canvas — adding to the workflow is
    // an explicit palette click.
    await expect(page.getByTestId(`workflow-status-node-${created.id}`)).toHaveCount(0);
    await createdCard.click();
    await expect(page.getByTestId(`workflow-status-node-${created.id}`)).toBeVisible({
      timeout: 10_000,
    });

    // The status is persisted in the global catalog under the exact name.
    const statuses = await listStatuses(request);
    const persisted = statuses.find((s) => s.id === created.id);
    expect(persisted?.name).toBe(statusName);

    // Saving the workflow keeps the new status in the transition graph.
    const savePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes(`/api/v2/workflows/${workflow.id}/transitions`) &&
        resp.request().method() === 'PUT'
    );
    await page.getByTestId('workflow-save').click();
    const saveResp = await savePromise;
    expect(saveResp.ok(), `save: ${saveResp.status()}`).toBeTruthy();

    const transitions = await getTransitions(request, workflow.id);
    const statusIds = new Set<number>();
    for (const tx of transitions) {
      if (tx.from_status_id != null) statusIds.add(tx.from_status_id);
      statusIds.add(tx.to_status_id);
    }
    expect(statusIds.has(todo.id), 'initial status lost from workflow').toBe(true);
    expect(statusIds.has(created.id), 'created status not persisted in workflow').toBe(true);
  });

  test('palette filter narrows the status list until cleared', async ({ page, request }) => {
    test.setTimeout(90_000);

    const prefix = `wfs-filter-${Date.now()}`;
    const categoryId = await defaultCategoryId(request);
    const base = await createStatus(request, `${prefix}-Base`, categoryId);
    const alpha = await createStatus(request, `${prefix}-Alpha`, categoryId);
    const beta = await createStatus(request, `${prefix}-Beta`, categoryId);
    const workflow = await createWorkflow(request, `${prefix}-wf`);
    await setInitialTransition(request, workflow.id, base.id);

    await page.goto(`/workflows/${workflow.id}/design`);
    await expect(page.getByTestId('workflow-canvas')).toBeVisible({ timeout: 20_000 });

    const alphaCard = page.getByTestId(`workflow-status-option-${alpha.id}`);
    const betaCard = page.getByTestId(`workflow-status-option-${beta.id}`);
    await expect(alphaCard).toBeVisible({ timeout: 10_000 });
    await expect(betaCard).toBeVisible();

    const filter = page.getByTestId('workflow-status-filter');
    const emptyMessage = page.getByTestId('workflow-status-empty');
    await filter.fill(`${prefix}-Beta`);
    await expect(betaCard).toBeVisible();
    await expect(alphaCard).toBeHidden();
    await expect(emptyMessage).toBeHidden();

    // A filter with no hits falls back to an explicit empty message.
    await filter.fill('no-such-status-xyz');
    await expect(alphaCard).toBeHidden();
    await expect(betaCard).toBeHidden();
    await expect(emptyMessage).toBeVisible();
    await expect(emptyMessage).toContainText('No statuses match your filter');

    // Clearing restores the full palette.
    await filter.fill('');
    await expect(alphaCard).toBeVisible();
    await expect(betaCard).toBeVisible();
  });

  test('transition hints stay collapsed until the help control opens them', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);

    const prefix = `wfs-hints-${Date.now()}`;
    const categoryId = await defaultCategoryId(request);
    const todo = await createStatus(request, `${prefix}-Todo`, categoryId);
    const workflow = await createWorkflow(request, `${prefix}-wf`);
    await setInitialTransition(request, workflow.id, todo.id);

    await page.goto(`/workflows/${workflow.id}/design`);
    await expect(page.getByTestId('workflow-canvas')).toBeVisible({ timeout: 20_000 });

    const hints = page.getByTestId('workflow-transition-hints');
    await expect(hints).toBeHidden();

    const help = page.getByTestId('workflow-status-help');
    await expect(help).toHaveAttribute('aria-expanded', 'false');
    await help.click();
    await expect(hints).toBeVisible();
    await expect(help).toHaveAttribute('aria-expanded', 'true');
    await expect(hints).toContainText('How to create transitions:');

    await help.click();
    await expect(hints).toBeHidden();
    await expect(help).toHaveAttribute('aria-expanded', 'false');
  });
});
