import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routeSubscriber: null,
  fetchCollectionBacklog: vi.fn(),
  fetchCollectionItemChanges: vi.fn(),
  fetchCollectionItems: vi.fn(),
  getBoardConfigurationBootstrap: vi.fn(),
  getCollection: vi.fn(),
}));

vi.mock('../api.js', () => ({
  api: {
    collections: {
      getBoardConfigurationBootstrap: mocks.getBoardConfigurationBootstrap,
    },
  },
}));

vi.mock('../features/collections/collectionService.js', () => ({
  fetchCollectionTotal: vi.fn().mockResolvedValue({ total: 300, watermark: 100 }),
  fetchCollectionBacklog: mocks.fetchCollectionBacklog,
  fetchCollectionItemChanges: mocks.fetchCollectionItemChanges,
  fetchCollectionItems: mocks.fetchCollectionItems,
  fetchItemsById: vi.fn(),
  getCollection: mocks.getCollection,
}));

vi.mock('../router.js', () => ({
  currentRoute: {
    subscribe(callback) {
      mocks.routeSubscriber = callback;
      callback({ view: 'home', params: {} });
      return vi.fn();
    },
  },
  GLOBAL_COLLECTION_VIEWS: new Set(['collection-board', 'collection-list']),
}));

vi.mock('./workspaceDataStore.svelte.js', () => ({
  workspaceDataStore: {
    initialize: vi.fn(),
    initializeGlobal: vi.fn(),
    statuses: [],
  },
}));

const { collectionStore } = await import('./collectionContext.svelte.js');

function itemResult(options) {
  const page = options.page ?? 1;
  return {
    items: [{ id: page, status_id: 1 }],
    collectionName: 'Test board',
    pagination: { page, page_size: options.limit, total_items: 2, total_pages: 2 },
    sortableFields: [],
    watermark: 1,
  };
}

describe('CollectionStore board ordering', () => {
  beforeEach(() => {
    // These partition and retention tests explicitly include completed work.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) =>
      key.startsWith('collection-show-completed:') ? 'true' : null
    );
  });
  afterAll(() => collectionStore.destroy());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the first unfinished page without waiting for background pages', async () => {
    let resolveSecondPage;
    mocks.fetchCollectionItems.mockImplementation((_workspaceId, _collectionId, options) => {
      if (options.status_id === '2') {
        return Promise.resolve({
          items: [],
          pagination: { page: 1, page_size: 100, total_items: 0, total_pages: 0 },
          watermark: 1,
        });
      }
      if (options.page === 1) {
        return Promise.resolve({
          items: [{ id: 1, status_id: 1 }],
          collectionName: 'Large board',
          pagination: { page: 1, page_size: 100, total_items: 200, total_pages: 2 },
          watermark: 1,
        });
      }
      return new Promise((resolve) => {
        resolveSecondPage = resolve;
      });
    });
    mocks.fetchCollectionBacklog.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 100, total_items: 0, total_pages: 0 },
      watermark: 1,
    });
    mocks.getBoardConfigurationBootstrap.mockResolvedValue({
      board_configuration: { columns: [], show_rightmost_column_last_50: false },
      statuses: [{ id: 1, category_name: 'To Do', is_completed: false }],
      referenced_workspace_ids: [60],
    });

    mocks.routeSubscriber({ view: 'workspace-board', params: { id: '60' } });

    await vi.waitFor(() => expect(collectionStore.loading).toBe(false));
    expect(collectionStore.items).toContainEqual({ id: 1, status_id: 1 });
    expect(resolveSecondPage).toBeTypeOf('function');

    resolveSecondPage({
      items: [{ id: 2, status_id: 1 }],
      collectionName: 'Large board',
      pagination: { page: 2, page_size: 100, total_items: 200, total_pages: 2 },
      watermark: 1,
    });
    await vi.waitFor(() => expect(collectionStore.items).toHaveLength(2));
  });

  it('paces unfinished board pages after the first thousand items', async () => {
    vi.useFakeTimers();
    mocks.fetchCollectionItems.mockImplementation((_workspaceId, _collectionId, options) => {
      if (options.status_id === '2') {
        return Promise.resolve({
          items: [],
          pagination: { page: 1, page_size: 100, total_items: 0, total_pages: 0 },
          watermark: 1,
        });
      }
      return Promise.resolve({
        items: Array.from({ length: 100 }, (_, index) => ({
          id: (options.page - 1) * 100 + index + 1,
          status_id: 1,
        })),
        collectionName: 'Very large board',
        pagination: { page: options.page, page_size: 100, total_items: 1100, total_pages: 11 },
        watermark: 1,
      });
    });
    mocks.fetchCollectionBacklog.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 100, total_items: 0, total_pages: 0 },
      watermark: 1,
    });
    mocks.getBoardConfigurationBootstrap.mockResolvedValue({
      board_configuration: { columns: [], show_rightmost_column_last_50: false },
      statuses: [
        { id: 1, category_name: 'To Do', is_completed: false },
        { id: 2, category_name: 'Done', is_completed: true },
      ],
      referenced_workspace_ids: [61],
    });

    mocks.routeSubscriber({ view: 'workspace-board', params: { id: '61' } });
    await vi.advanceTimersByTimeAsync(0);

    const unfinishedCalls = () =>
      mocks.fetchCollectionItems.mock.calls.filter(
        ([, , options]) => options.status_id_not === '2'
      );
    expect(collectionStore.loading).toBe(false);
    expect(unfinishedCalls()).toHaveLength(10);
    expect(collectionStore.items).toHaveLength(1000);

    await vi.advanceTimersByTimeAsync(249);
    expect(unfinishedCalls()).toHaveLength(10);
    await vi.advanceTimersByTimeAsync(1);
    expect(unfinishedCalls()).toHaveLength(11);
    await vi.waitFor(() => expect(collectionStore.items).toHaveLength(1100));
  });

  it('reuses the collection returned by the board bootstrap', async () => {
    const collection = { id: 62, name: 'Aggregate board', ql_query: 'workspace_id = 7' };
    mocks.getBoardConfigurationBootstrap.mockResolvedValue({
      board_configuration: { columns: [] },
      collection,
      statuses: [],
      referenced_workspace_ids: [7],
    });
    mocks.fetchCollectionItems.mockResolvedValue({
      items: [],
      collectionName: collection.name,
      pagination: { page: 1, page_size: 100, total_items: 0, total_pages: 0 },
      watermark: 1,
    });
    mocks.fetchCollectionBacklog.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 100, total_items: 0, total_pages: 0 },
      watermark: 1,
    });

    mocks.routeSubscriber({ view: 'collection-board', params: { id: '62' } });
    await vi.waitFor(() => expect(collectionStore.loading).toBe(false));

    expect(mocks.getCollection).not.toHaveBeenCalled();
    expect(mocks.fetchCollectionItems).toHaveBeenCalledWith(
      null,
      '62',
      expect.objectContaining({ collection })
    );
  });

  it('loads all unfinished board items before paging completed work', async () => {
    mocks.fetchCollectionItems.mockClear();
    mocks.fetchCollectionBacklog.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 100, total_items: 0, total_pages: 0 },
      watermark: 4,
    });
    mocks.getBoardConfigurationBootstrap.mockResolvedValue({
      board_configuration: { columns: [], show_rightmost_column_last_50: false },
      statuses: [
        { id: 1, name: 'Open', category_name: 'To Do', is_completed: false },
        { id: 2, name: 'Done', category_name: 'Done', is_completed: true },
      ],
      referenced_workspace_ids: [41],
    });
    mocks.fetchCollectionItems.mockImplementation((_workspaceId, _collectionId, options) => {
      if (options.status_id_not === '2') {
        return Promise.resolve({
          items: Array.from({ length: 38 }, (_, index) => ({
            id: index + 1,
            status_id: 1,
          })),
          collectionName: 'Split board',
          pagination: { page: 1, page_size: 1000, total_items: 38, total_pages: 1 },
          watermark: 4,
        });
      }
      if (options.status_id === '2') {
        const count = options.page === 1 ? 100 : 5;
        const start = options.page === 1 ? 1000 : 1100;
        return Promise.resolve({
          items: Array.from({ length: count }, (_, index) => ({
            id: start + index,
            status_id: 2,
          })),
          collectionName: 'Split board',
          pagination: {
            page: options.page,
            page_size: 100,
            total_items: 105,
            total_pages: 2,
          },
          watermark: 4,
        });
      }
      throw new Error(`unexpected item request: ${JSON.stringify(options)}`);
    });

    mocks.routeSubscriber({ view: 'workspace-board', params: { id: '41' } });
    await vi.waitFor(() => expect(collectionStore.loading).toBe(false));

    expect(mocks.fetchCollectionItems).toHaveBeenCalledTimes(2);
    expect(collectionStore.items.filter((item) => item.status_id === 1)).toHaveLength(38);
    expect(collectionStore.items.filter((item) => item.status_id === 2)).toHaveLength(100);
    expect(collectionStore.itemsTotalCount).toBe(143);
    expect(collectionStore.itemsRemainingCount).toBe(5);
    expect(collectionStore.itemsHasMore).toBe(true);

    await collectionStore.loadMoreItems();

    expect(mocks.fetchCollectionItems).toHaveBeenLastCalledWith(
      '41',
      null,
      expect.objectContaining({ page: 2, limit: 100, status_id: '2' })
    );
    expect(collectionStore.items.filter((item) => item.status_id === 2)).toHaveLength(105);
    expect(collectionStore.itemsRemainingCount).toBe(0);
    expect(collectionStore.itemsHasMore).toBe(false);
  });

  it('keeps load-more completed rows across a background refresh', async () => {
    mocks.fetchCollectionItems.mockClear();
    mocks.fetchCollectionBacklog.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 100, total_items: 0, total_pages: 0 },
      watermark: 4,
    });
    mocks.getBoardConfigurationBootstrap.mockResolvedValue({
      board_configuration: { columns: [], show_rightmost_column_last_50: false },
      statuses: [
        { id: 1, name: 'Open', category_name: 'To Do', is_completed: false },
        { id: 2, name: 'Done', category_name: 'Done', is_completed: true },
      ],
      referenced_workspace_ids: [63],
    });
    const deferredPage = (page, count) => ({
      items: Array.from({ length: count }, (_, index) => ({
        id: 1000 + (page - 1) * 100 + index,
        status_id: 2,
      })),
      collectionName: 'Deep completed board',
      pagination: {
        page,
        page_size: count,
        total_items: 250,
        total_pages: Math.ceil(250 / count),
      },
      watermark: 4,
    });
    mocks.fetchCollectionItems.mockImplementation((_workspaceId, _collectionId, options) => {
      if (options.status_id_not === '2') {
        return Promise.resolve({
          items: [{ id: 1, status_id: 1 }],
          collectionName: 'Deep completed board',
          pagination: { page: 1, page_size: 1000, total_items: 1, total_pages: 1 },
          watermark: 4,
        });
      }
      if (options.status_id === '2') {
        if (options.page === 1 && options.limit === 100) return deferredPage(1, 100);
        if (options.page === 2 && options.limit === 100) return deferredPage(2, 100);
        if (options.page === 1 && options.limit === 200) return deferredPage(1, 200);
      }
      throw new Error(`unexpected item request: ${JSON.stringify(options)}`);
    });

    mocks.routeSubscriber({ view: 'workspace-board', params: { id: '63' } });
    await vi.waitFor(() => expect(collectionStore.loading).toBe(false));
    expect(collectionStore.items.filter((item) => item.status_id === 2)).toHaveLength(100);

    await collectionStore.loadMoreItems();
    expect(collectionStore.items.filter((item) => item.status_id === 2)).toHaveLength(200);

    mocks.fetchCollectionItems.mockClear();
    await collectionStore.refresh();

    expect(mocks.fetchCollectionItems).toHaveBeenCalledWith(
      '63',
      null,
      expect.objectContaining({ page: 1, limit: 200, status_id: '2' })
    );
    expect(collectionStore.items.filter((item) => item.status_id === 2)).toHaveLength(200);
    expect(collectionStore.itemsRemainingCount).toBe(50);
    expect(collectionStore.itemsHasMore).toBe(true);
  });

  it('sends one completed-activity day window to initial and later completed pages', async () => {
    mocks.fetchCollectionItems.mockClear();
    mocks.fetchCollectionBacklog.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 100, total_items: 0, total_pages: 0 },
      watermark: 5,
    });
    mocks.getBoardConfigurationBootstrap.mockResolvedValue({
      board_configuration: {
        columns: [],
        show_rightmost_column_last_50: false,
        completed_item_retention_days: 30,
      },
      statuses: [
        { id: 1, name: 'Open', category_name: 'To Do', is_completed: false },
        { id: 2, name: 'Done', category_name: 'Done', is_completed: true },
      ],
      referenced_workspace_ids: [47],
    });
    mocks.fetchCollectionItems.mockImplementation((_workspaceId, _collectionId, options) => {
      if (options.status_id_not === '2') {
        return Promise.resolve({
          items: [{ id: 1, status_id: 1 }],
          collectionName: 'Age-trimmed board',
          pagination: { page: 1, page_size: 1000, total_items: 1, total_pages: 1 },
          watermark: 5,
        });
      }
      if (options.status_id === '2') {
        return Promise.resolve({
          items: [{ id: 100 + options.page, status_id: 2 }],
          collectionName: 'Age-trimmed board',
          pagination: {
            page: options.page,
            page_size: 100,
            total_items: 2,
            total_pages: 2,
          },
          watermark: 5,
        });
      }
      throw new Error(`unexpected item request: ${JSON.stringify(options)}`);
    });

    mocks.routeSubscriber({ view: 'workspace-board', params: { id: '47' } });
    await vi.waitFor(() => expect(collectionStore.loading).toBe(false));

    expect(mocks.fetchCollectionItems).toHaveBeenCalledWith(
      '47',
      null,
      expect.objectContaining({
        page: 1,
        status_id: '2',
        completed_activity_days: 30,
      })
    );

    await collectionStore.loadMoreItems();
    expect(mocks.fetchCollectionItems).toHaveBeenLastCalledWith(
      '47',
      null,
      expect.objectContaining({
        page: 2,
        status_id: '2',
        completed_activity_days: 30,
      })
    );
  });

  it('searches the complete collection scope without board trimming filters', async () => {
    mocks.fetchCollectionItems.mockClear();
    mocks.fetchCollectionBacklog.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 100, total_items: 0, total_pages: 0 },
      watermark: 6,
    });
    const collection = { id: 88, name: 'Scoped search collection' };
    mocks.getBoardConfigurationBootstrap.mockResolvedValue({
      board_configuration: {
        columns: [
          { id: 1, status_ids: [1] },
          { id: 2, status_ids: [2] },
        ],
        show_rightmost_column_last_50: true,
      },
      collection,
      statuses: [
        { id: 1, name: 'Open', category_name: 'To Do', is_completed: false },
        { id: 2, name: 'Done', category_name: 'Done', is_completed: true },
      ],
      referenced_workspace_ids: [51],
    });
    mocks.fetchCollectionItems.mockImplementation((_workspaceId, _collectionId, options) => {
      if (options.search) {
        return Promise.resolve({
          items: [{ id: 900 + options.page, status_id: 2 }],
          collectionName: collection.name,
          pagination: {
            page: options.page,
            page_size: 100,
            total_items: 2,
            total_pages: 2,
          },
          watermark: 6,
        });
      }
      if (options.status_id_not === '2') {
        return Promise.resolve({
          items: [{ id: 1, status_id: 1 }],
          collectionName: collection.name,
          pagination: { page: 1, page_size: 1000, total_items: 1, total_pages: 1 },
          watermark: 6,
        });
      }
      if (options.status_id === '2') {
        return Promise.resolve({
          items: [{ id: 2, status_id: 2 }],
          collectionName: collection.name,
          pagination: { page: 1, page_size: 50, total_items: 55, total_pages: 2 },
          watermark: 6,
        });
      }
      throw new Error(`unexpected item request: ${JSON.stringify(options)}`);
    });

    mocks.routeSubscriber({ view: 'collection-board', params: { id: '88' } });
    await vi.waitFor(() => expect(collectionStore.loading).toBe(false));
    collectionStore.subFilterQL = 'status = "Done"';

    await collectionStore.searchBoardItems('description needle');

    const searchCall = mocks.fetchCollectionItems.mock.calls.find(
      ([, , options]) => options.search === 'description needle'
    );
    expect(searchCall).toBeDefined();
    expect(searchCall[0]).toBeNull();
    expect(searchCall[1]).toBe('88');
    expect(searchCall[2]).toEqual(
      expect.objectContaining({
        page: 1,
        limit: 100,
        search: 'description needle',
        sub_ql: 'status = "Done"',
        collection,
      })
    );
    expect(searchCall[2]).not.toHaveProperty('status_id');
    expect(searchCall[2]).not.toHaveProperty('status_id_not');
    expect(searchCall[2]).not.toHaveProperty('completed_activity_days');
    expect(collectionStore.boardSearchItems).toEqual([{ id: 901, status_id: 2 }]);
    expect(collectionStore.boardSearchRemainingCount).toBe(1);
    expect(collectionStore.boardSearchHasMore).toBe(true);

    await collectionStore.loadMoreBoardSearchItems();
    expect(collectionStore.boardSearchItems).toEqual([
      { id: 901, status_id: 2 },
      { id: 902, status_id: 2 },
    ]);
    expect(collectionStore.boardSearchRemainingCount).toBe(0);
    expect(collectionStore.boardSearchHasMore).toBe(false);
  });

  it('applies Bubble Mode before pagination on loads, refreshes, and later pages', async () => {
    mocks.fetchCollectionItems.mockImplementation((_workspaceId, _collectionId, options) =>
      Promise.resolve(itemResult(options))
    );
    mocks.fetchCollectionBacklog.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 100, total_items: 0, total_pages: 0 },
    });
    mocks.fetchCollectionItemChanges.mockResolvedValue({ watermark: 1 });
    mocks.getBoardConfigurationBootstrap.mockResolvedValue({ board_configuration: null });

    mocks.routeSubscriber({ view: 'workspace-board', params: { id: '42' } });
    await vi.waitFor(() => expect(mocks.fetchCollectionItems).toHaveBeenCalledTimes(2));
    expect(mocks.fetchCollectionItems.mock.calls).toEqual(
      expect.arrayContaining([
        [
          '42',
          null,
          expect.objectContaining({
            page: 1,
            limit: 1000,
            order_by: 'frac_index',
            sort_direction: 'asc',
          }),
        ],
        [
          '42',
          null,
          expect.objectContaining({
            page: 2,
            limit: 1000,
            order_by: 'frac_index',
            sort_direction: 'asc',
          }),
        ],
      ])
    );

    mocks.fetchCollectionItems.mockClear();
    collectionStore.setBoardSortMode('bubble');
    await vi.waitFor(() => expect(mocks.fetchCollectionItems).toHaveBeenCalledTimes(2));
    for (const [, , options] of mocks.fetchCollectionItems.mock.calls) {
      expect(options).toEqual(
        expect.objectContaining({ order_by: 'last_active_at', sort_direction: 'desc' })
      );
    }

    mocks.fetchCollectionItems.mockClear();
    await collectionStore.loadMoreItems();
    expect(mocks.fetchCollectionItems).not.toHaveBeenCalled();

    mocks.fetchCollectionItems.mockClear();
    await collectionStore.refresh();
    expect(mocks.fetchCollectionItems).toHaveBeenCalledTimes(2);
    for (const [, , options] of mocks.fetchCollectionItems.mock.calls) {
      expect(options).toEqual(
        expect.objectContaining({ order_by: 'last_active_at', sort_direction: 'desc' })
      );
    }

    mocks.fetchCollectionItems.mockClear();
    mocks.routeSubscriber({ view: 'workspace-board', params: { id: '43' } });
    // A workspace change must synchronously hide the previous board while the
    // new request is in flight. MainApp reuses the mounted board component.
    expect(collectionStore.items).toEqual([]);
    expect(collectionStore.backlogItems).toEqual([]);
    expect(collectionStore.itemsPagination).toBeNull();
    await vi.waitFor(() => expect(mocks.fetchCollectionItems).toHaveBeenCalledTimes(2));
    for (const [workspaceId, , options] of mocks.fetchCollectionItems.mock.calls) {
      expect(workspaceId).toBe('43');
      expect(options).toEqual(
        expect.objectContaining({ order_by: 'last_active_at', sort_direction: 'desc' })
      );
    }

    mocks.fetchCollectionItems.mockClear();
    collectionStore.setBoardSortMode('rank');
    await vi.waitFor(() => expect(mocks.fetchCollectionItems).toHaveBeenCalledTimes(2));
    for (const [, , options] of mocks.fetchCollectionItems.mock.calls) {
      expect(options).toEqual(
        expect.objectContaining({ order_by: 'frac_index', sort_direction: 'asc' })
      );
    }
  });

  it('does not log expected connectivity failures from delta polling', async () => {
    mocks.fetchCollectionItems.mockImplementation((_workspaceId, _collectionId, options) =>
      Promise.resolve(itemResult(options))
    );
    mocks.fetchCollectionBacklog.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 100, total_items: 0, total_pages: 0 },
    });
    mocks.getBoardConfigurationBootstrap.mockResolvedValue({ board_configuration: null });

    mocks.routeSubscriber({ view: 'workspace-list', params: { id: '44' } });
    await vi.waitFor(() => expect(collectionStore.loading).toBe(false));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.fetchCollectionItemChanges.mockRejectedValueOnce(
      Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' })
    );

    await collectionStore.refreshDeltas();

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('loads only items for list views and only backlog for backlog views', async () => {
    mocks.fetchCollectionItems.mockClear();
    mocks.fetchCollectionBacklog.mockClear();
    mocks.fetchCollectionItemChanges.mockClear();
    mocks.fetchCollectionItems.mockImplementation((_workspaceId, _collectionId, options) =>
      Promise.resolve(itemResult(options))
    );
    mocks.fetchCollectionBacklog.mockResolvedValue({
      items: [{ id: 2, status_id: 1 }],
      collectionName: 'Backlog',
      pagination: { page: 1, page_size: 100, total_items: 1, total_pages: 1 },
      watermark: 3,
    });

    mocks.routeSubscriber({ view: 'workspace-list', params: { id: '45' } });
    await vi.waitFor(() => expect(collectionStore.loading).toBe(false));

    expect(mocks.fetchCollectionItems).toHaveBeenCalledTimes(1);
    expect(mocks.fetchCollectionBacklog).not.toHaveBeenCalled();
    expect(mocks.fetchCollectionItemChanges).not.toHaveBeenCalled();

    mocks.fetchCollectionItems.mockClear();
    mocks.fetchCollectionBacklog.mockClear();
    mocks.routeSubscriber({ view: 'workspace-backlog', params: { id: '46' } });
    await vi.waitFor(() => expect(collectionStore.loading).toBe(false));

    expect(mocks.fetchCollectionItems).not.toHaveBeenCalled();
    expect(mocks.fetchCollectionBacklog).toHaveBeenCalledTimes(1);
  });

  it('polls from the oldest watermark returned by parallel board snapshots', async () => {
    mocks.fetchCollectionItems.mockImplementation((_workspaceId, _collectionId, options) =>
      Promise.resolve({ ...itemResult(options), watermark: 5 })
    );
    mocks.fetchCollectionBacklog.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 100, total_items: 0, total_pages: 0 },
      watermark: 7,
    });
    mocks.fetchCollectionItemChanges.mockResolvedValue({
      watermark: 7,
      changed_item_ids: [],
      removed_item_ids: [],
    });
    mocks.getBoardConfigurationBootstrap.mockResolvedValue({ board_configuration: null });

    mocks.routeSubscriber({ view: 'workspace-board', params: { id: '47' } });
    await vi.waitFor(() => expect(collectionStore.loading).toBe(false));
    await collectionStore.refreshDeltas();

    expect(mocks.fetchCollectionItemChanges).toHaveBeenLastCalledWith(
      '47',
      null,
      expect.objectContaining({ since: 5 })
    );
  });

  it('single-flights board configuration for store and view consumers', async () => {
    mocks.getBoardConfigurationBootstrap.mockClear();
    let resolveConfiguration;
    mocks.getBoardConfigurationBootstrap.mockReturnValue(
      new Promise((resolve) => {
        resolveConfiguration = resolve;
      })
    );

    const storeLoad = collectionStore.getBoardConfiguration(48, null, { force: true });
    const viewLoad = collectionStore.getBoardConfiguration(48, null);

    expect(mocks.getBoardConfigurationBootstrap).toHaveBeenCalledTimes(1);
    resolveConfiguration({
      board_configuration: { id: 9, columns: [] },
      collection: { id: 7, ql_query: 'workspace_id = 48' },
      referenced_workspace_ids: [48],
    });
    await Promise.all([storeLoad, viewLoad]);
    expect(collectionStore.boardWorkspaceScopeLoaded).toBe(true);
    expect(collectionStore.boardWorkspaceIds).toEqual([48]);
    expect(collectionStore.boardCollection).toEqual({ id: 7, ql_query: 'workspace_id = 48' });
  });
});

describe('CollectionStore list-view sorting', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => collectionStore.destroy());

  it('sends server-side sort options from setSorting and resets to page 1', async () => {
    mocks.fetchCollectionItems.mockImplementation((_workspaceId, _collectionId, options) =>
      Promise.resolve({
        ...itemResult(options),
        sortableFields: ['key', 'status', 'priority'],
      })
    );
    mocks.fetchCollectionBacklog.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 100, total_items: 0, total_pages: 0 },
    });
    mocks.getBoardConfigurationBootstrap.mockResolvedValue({ board_configuration: null });

    mocks.routeSubscriber({ view: 'workspace-list', params: { id: '49' } });
    await vi.waitFor(() => expect(collectionStore.loading).toBe(false));

    // The server's sortable fields surface in the store for the header UI.
    expect(collectionStore.sortableFields).toEqual(['key', 'status', 'priority']);

    mocks.fetchCollectionItems.mockClear();
    collectionStore.setSorting('priority', 'desc');

    // Sorting reloads from page 1 with the sort options on every page request.
    await vi.waitFor(() => expect(collectionStore.loading).toBe(false));
    expect(mocks.fetchCollectionItems).toHaveBeenCalledTimes(1);
    expect(mocks.fetchCollectionItems).toHaveBeenCalledWith(
      '49',
      null,
      expect.objectContaining({
        page: 1,
        order_by: 'priority',
        sort_direction: 'desc',
      })
    );
  });
});
