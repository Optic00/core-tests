import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./core.js', () => ({
  fetchAllV2Pages: vi.fn(),
  fetchAPI: vi.fn(),
  fetchV2Data: vi.fn(),
}));

const { fetchAllV2Pages, fetchAPI, fetchV2Data } = await import('./core.js');
const { createCrudClient } = await import('./createCrudClient.js');

describe('createCrudClient read request options', () => {
  beforeEach(() => {
    fetchAPI.mockReset();
  });

  it('passes request options through plain reads', () => {
    const client = createCrudClient('/things');
    const requestOptions = { signal: new AbortController().signal };

    client.getAll({ state: 'open' }, requestOptions);
    client.get(9, requestOptions);

    expect(fetchAPI).toHaveBeenNthCalledWith(1, '/things?state=open', requestOptions);
    expect(fetchAPI).toHaveBeenNthCalledWith(2, '/things/9', requestOptions);
  });

  it('passes request options through fully parent-scoped reads', () => {
    const client = createCrudClient('/children', { parentPath: '/parents' });
    const requestOptions = { signal: new AbortController().signal };

    client.getAll(3, { state: 'open' }, requestOptions);
    client.get(3, 9, requestOptions);

    expect(fetchAPI).toHaveBeenNthCalledWith(1, '/parents/3/children?state=open', requestOptions);
    expect(fetchAPI).toHaveBeenNthCalledWith(2, '/parents/3/children/9', requestOptions);
  });

  it('passes request options through nested-list and flat-item reads', () => {
    const client = createCrudClient('/children', {
      parentPath: '/parents',
      itemPath: '/children',
    });
    const requestOptions = { signal: new AbortController().signal };

    client.getAll(3, {}, requestOptions);
    client.get(9, requestOptions);

    expect(fetchAPI).toHaveBeenNthCalledWith(1, '/parents/3/children', requestOptions);
    expect(fetchAPI).toHaveBeenNthCalledWith(2, '/children/9', requestOptions);
  });
});

describe('createCrudClient v2 reads', () => {
  beforeEach(() => {
    fetchAllV2Pages.mockReset();
    fetchAPI.mockReset();
    fetchV2Data.mockReset();
  });

  it('uses canonical v2 documents for reads while retaining legacy writes', async () => {
    const client = createCrudClient('/things', { readV2: true });
    const requestOptions = { signal: new AbortController().signal };

    await client.getAll({ state: 'open' }, requestOptions);
    await client.get(9, requestOptions);
    await client.update(9, { name: 'changed' });

    expect(fetchV2Data).toHaveBeenNthCalledWith(1, '/things?state=open', requestOptions);
    expect(fetchV2Data).toHaveBeenNthCalledWith(2, '/things/9', requestOptions);
    expect(fetchAPI).toHaveBeenCalledWith('/things/9', {
      method: 'PUT',
      body: JSON.stringify({ name: 'changed' }),
    });
  });

  it('drains collection pages without treating detail documents as pages', async () => {
    const client = createCrudClient('/things', { v2: true, allV2: true });
    const requestOptions = { signal: new AbortController().signal };

    await client.getAll({ state: 'open' }, requestOptions);
    await client.get(9, requestOptions);

    expect(fetchAllV2Pages).toHaveBeenCalledOnce();
    expect(fetchAllV2Pages).toHaveBeenCalledWith('/things?state=open', requestOptions);
    expect(fetchV2Data).toHaveBeenCalledOnce();
    expect(fetchV2Data).toHaveBeenCalledWith('/things/9', requestOptions);
  });
});
