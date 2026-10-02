import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api.js', () => ({
  api: {
    items: { getAll: vi.fn(), getBacklog: vi.fn() },
    collections: { get: vi.fn() },
  },
}));

const { api } = await import('../../api.js');
const { fetchCollectionItems, fetchCollectionBacklog } = await import('./collectionService.js');

beforeEach(() => {
  vi.resetAllMocks();
  api.collections.get.mockResolvedValue({ name: 'Everything', ql_query: '' });
});

describe('collection pagination contract', () => {
  it.each([
    ['items', fetchCollectionItems, 'getAll'],
    ['backlog', fetchCollectionBacklog, 'getBacklog'],
  ])('preserves the server page size for %s continuation', async (_name, fetch, method) => {
    api.items[method].mockResolvedValue({
      data: [{ id: 51 }],
      pagination: { page: 2, page_size: 50, total_items: 51, total_pages: 2 },
    });
    const result = await fetch(null, 7, { page: 2, limit: 50 });
    expect(result.items).toEqual([{ id: 51 }]);
    expect(result.pagination).toEqual({
      page: 2,
      page_size: 50,
      limit: 50,
      total_items: 51,
      total_pages: 2,
    });
  });
});
