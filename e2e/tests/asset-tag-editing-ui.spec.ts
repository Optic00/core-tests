import { authenticateAdminRequest } from '../fixtures/api-helpers';
import { expect, logicalPath, test } from '../fixtures/context-path';

const SEC_FETCH = { 'Sec-Fetch-Site': 'same-origin' };

test('asset UI creates, preserves, changes, and clears asset tags', async ({ request, page }) => {
  await authenticateAdminRequest(request);
  const stamp = Date.now();
  const originalTag = `TAG-${stamp}`;
  const changedTag = `TAG-${stamp}-changed`;

  const setResponse = await request.post('/api/v2/asset-sets', {
    headers: SEC_FETCH,
    data: { name: `Tagged assets ${stamp}` },
  });
  expect(setResponse.status(), `create asset set: ${await setResponse.text()}`).toBe(201);
  const assetSet = (await setResponse.json()).data;
  expect(assetSet.id).toBeGreaterThan(0);

  const typeResponse = await request.post(`/api/v2/asset-sets/${assetSet.id}/types`, {
    headers: SEC_FETCH,
    data: { name: `Tagged server ${stamp}` },
  });
  expect(typeResponse.status(), `create asset type: ${await typeResponse.text()}`).toBe(201);
  expect((await typeResponse.json()).data.id).toBeGreaterThan(0);

  await page.goto('/assets');
  await page.locator('#asset-set-select').click();
  await page.locator(`#asset-set-select-option-${assetSet.id}`).click();
  await page.getByTestId('asset-create').click();
  await page.locator('#asset-title-input').fill(`Tagged asset ${stamp}`);
  await page.locator('#asset-tag-input').fill(originalTag);
  await expect(page.locator('#asset-tag-input')).toHaveValue(originalTag);
  await page.locator('#asset-tag-input').blur();
  const createPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v2/asset-sets/${assetSet.id}/assets`) &&
      response.request().method() === 'POST'
  );
  await page.getByTestId('asset-submit').click();
  const createResponse = await createPromise;
  expect(createResponse.status()).toBe(201);
  expect(createResponse.request().postDataJSON().asset_tag).toBe(originalTag);
  const asset = (await createResponse.json()).data;
  expect(asset.id).toBeGreaterThan(0);
  expect(asset.asset_tag).toBe(originalTag);

  await page.goto(`/assets/${asset.id}`);
  await page.getByTestId('asset-edit').click();
  await expect(page.locator('#asset-tag-input')).toHaveValue(originalTag);
  await page.locator('#asset-title-input').fill(`Tagged asset renamed ${stamp}`);
  const preservePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v2/assets/${asset.id}`) &&
      response.request().method() === 'PATCH'
  );
  await page.getByTestId('asset-submit').click();
  const preserveResponse = await preservePromise;
  expect(preserveResponse.status()).toBe(200);
  expect(preserveResponse.request().postDataJSON().asset_tag).toBe(originalTag);
  expect((await preserveResponse.json()).data.asset_tag).toBe(originalTag);
  await expect(page.getByTestId('asset-submit')).toHaveCount(0);

  await page.getByTestId('asset-edit').click();
  await expect(page.locator('#asset-tag-input')).toHaveValue(originalTag);
  await page.locator('#asset-tag-input').fill(changedTag);
  const changePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v2/assets/${asset.id}`) &&
      response.request().method() === 'PATCH'
  );
  await page.getByTestId('asset-submit').click();
  const changeResponse = await changePromise;
  expect(changeResponse.status()).toBe(200);
  expect(changeResponse.request().postDataJSON().asset_tag).toBe(changedTag);
  expect((await changeResponse.json()).data.asset_tag).toBe(changedTag);
  await expect(page.getByTestId('asset-submit')).toHaveCount(0);

  await page.getByTestId('asset-edit').click();
  await expect(page.locator('#asset-tag-input')).toHaveValue(changedTag);
  await page.locator('#asset-tag-input').fill('');
  await expect(page.locator('#asset-tag-input')).toHaveValue('');
  const clearPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v2/assets/${asset.id}`) &&
      response.request().method() === 'PATCH'
  );
  await page.getByTestId('asset-submit').click();
  const clearResponse = await clearPromise;
  expect(clearResponse.status()).toBe(200);
  expect(clearResponse.request().postDataJSON().asset_tag).toBe('');
  expect((await clearResponse.json()).data.asset_tag ?? '').toBe('');

  await expect(page.getByTestId('asset-submit')).toHaveCount(0);
  await page.reload();
  await page.getByTestId('asset-edit').click();
  await expect(page.locator('#asset-tag-input')).toHaveValue('');

  const storedResponse = await request.get(`/api/v2/assets/${asset.id}`, {
    headers: SEC_FETCH,
  });
  expect(storedResponse.status()).toBe(200);
  expect((await storedResponse.json()).data.asset_tag ?? '').toBe('');

  // Search is part of the browser contract, not merely an API capability.
  // Re-enter the set from a fresh page and prove both the matching and empty
  // result states against the asset persisted above.
  await page.goto('/assets');
  await page.locator('#asset-set-select').click();
  await page.locator(`#asset-set-select-option-${assetSet.id}`).click();

  await expect(page.getByTestId('asset-row')).toHaveCount(1);

  let releaseMatchingResponse!: () => void;
  let matchingRequestStarted!: () => void;
  let matchingResponseReleased!: () => void;
  const matchingRequest = new Promise<void>((resolve) => {
    matchingRequestStarted = resolve;
  });
  const matchingRelease = new Promise<void>((resolve) => {
    releaseMatchingResponse = resolve;
  });
  const matchingReleased = new Promise<void>((resolve) => {
    matchingResponseReleased = resolve;
  });
  await page.route(
    (url) =>
      logicalPath(url.pathname) === `/api/v2/asset-sets/${assetSet.id}/assets` &&
      (url.searchParams.get('ql') ?? '').includes(`renamed ${stamp}`),
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.data.map((entry: { id: number }) => entry.id)).toEqual([asset.id]);
      matchingRequestStarted();
      await matchingRelease;
      await route.fulfill({ response });
      matchingResponseReleased();
    }
  );

  const staleResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      logicalPath(url.pathname) === `/api/v2/asset-sets/${assetSet.id}/assets` &&
      (url.searchParams.get('ql') ?? '').includes(`renamed ${stamp}`)
    );
  });
  try {
    await page.getByTestId('asset-search').fill(`renamed ${stamp}`);
    await matchingRequest;
    const emptyResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        logicalPath(url.pathname) === `/api/v2/asset-sets/${assetSet.id}/assets` &&
        (url.searchParams.get('ql') ?? '').includes(`no-match-${stamp}`)
      );
    });
    await page.getByTestId('asset-search').fill(`no-match-${stamp}`);
    const emptyResponse = await emptyResponsePromise;
    expect(emptyResponse.status()).toBe(200);
    expect((await emptyResponse.json()).data).toEqual([]);
    await expect(page.getByTestId('asset-row')).toHaveCount(0);
  } finally {
    releaseMatchingResponse();
  }
  await matchingReleased;
  await (await staleResponsePromise).finished();
  await expect(page.getByTestId('asset-row')).toHaveCount(0);
});
