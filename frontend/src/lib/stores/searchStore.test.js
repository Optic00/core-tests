import { beforeEach, describe, expect, test, vi } from 'vitest';
import { api } from '../api.js';
import { createWorkItemSearchStore } from './searchStore.svelte.js';

vi.mock('../api.js', () => ({ api: { items: { getAll: vi.fn() } } }));

beforeEach(() => vi.resetAllMocks());

test('collection searches treat an empty query as unrestricted and preserve v2 pagination', async () => {
  const store = createWorkItemSearchStore({ allowEmptyQuery: true });
  let state;
  const unsubscribe = store.subscribe((value) => {
    state = value;
  });
  const pagination = { page: 2, page_size: 25, total_items: 26, total_pages: 2 };
  api.items.getAll.mockResolvedValue({ data: [{ id: 26 }], pagination });
  try {
    await store.executeSearch({ page: 2, limit: 25 });
    expect(api.items.getAll).toHaveBeenCalledWith({ ql: '', page: 2, limit: 25 });
    expect(state.workItems).toEqual([{ id: 26 }]);
    expect(state.pagination).toEqual(pagination);
  } finally {
    unsubscribe();
  }
});

test('an unconfigured global search waits for a query', async () => {
  const store = createWorkItemSearchStore();
  await store.executeSearch();
  expect(api.items.getAll).not.toHaveBeenCalled();
});

describe('createWorkItemSearchStore workspace queries', () => {
  test('serializes selected workspace IDs as stable workspace keys', () => {
    const store = createWorkItemSearchStore();
    let state;
    const unsubscribe = store.subscribe((value) => {
      state = value;
    });

    store.setWorkspaces([
      { id: 7, key: 'WI', name: 'Windshift' },
      { id: 8, key: 'OPS', name: 'Operations' },
    ]);
    store.setSelectedWorkspaces([7, 8]);

    expect(state.qlQuery).toBe('workspaceKey IN ("WI", "OPS")');
    unsubscribe();
  });
});
