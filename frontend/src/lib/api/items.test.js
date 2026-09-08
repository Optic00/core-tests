import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pin that the mutating `items.*` API methods broadcast a cross-tab freshness
 * notice to other open tabs on success (and only on success). The notice
 * itself is exercised by crossTabSync.test.js; here we only assert that the
 * wrapper wires `notifyItemMutation` into the post-success path and does not
 * alter the request/response shape.
 */

class FakeBroadcastChannel {
  static instances = new Set();
  #listeners = new Set();
  constructor() {
    FakeBroadcastChannel.instances.add(this);
  }
  postMessage(data) {
    for (const ch of FakeBroadcastChannel.instances) {
      if (ch === this) continue;
      for (const cb of ch.#listeners) cb({ data });
    }
  }
  addEventListener(_t, cb) {
    this.#listeners.add(cb);
  }
  removeEventListener(_t, cb) {
    this.#listeners.delete(cb);
  }
  close() {
    this.#listeners.clear();
    FakeBroadcastChannel.instances.delete(this);
  }
}

let posted = [];

describe('items API cross-tab broadcast', () => {
  let fetchSpy;

  beforeEach(() => {
    vi.resetModules();
    FakeBroadcastChannel.instances.clear();
    posted = [];
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);

    fetchSpy = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: { id: 42, title: 'x' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', Date: new Date().toUTCString() },
        })
    );
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    for (const channel of [...FakeBroadcastChannel.instances]) channel.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Create a peer channel that captures everything the items client broadcasts.
  async function captureBroadcasts() {
    const mod = await import('./items.js');
    const peer = new FakeBroadcastChannel();
    peer.addEventListener('message', (e) => posted.push(e.data));
    return { mod, peer };
  }

  it('create broadcasts a notice with the new item id from the response', async () => {
    const { mod, peer } = await captureBroadcasts();
    const result = await mod.items.create({ title: 'x', workspace_id: 7 });
    expect(result.id).toBe(42);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v2/items');
    expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ title: 'x', workspace_id: 7 });
    expect(posted).toEqual([expect.objectContaining({ type: 'create', itemId: 42 })]);
    peer.close();
  });

  it('update broadcasts with the id arg', async () => {
    const { mod, peer } = await captureBroadcasts();
    await mod.items.update(7, { title: 'y' });
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v2/items/7');
    expect(fetchSpy.mock.calls[0][1].method).toBe('PATCH');
    expect(fetchSpy.mock.calls[0][1].headers['Content-Type']).toBe('application/merge-patch+json');
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ title: 'y' });
    expect(posted[0]).toEqual(expect.objectContaining({ type: 'update', itemId: 7 }));
    peer.close();
  });

  it('transition broadcasts with the id arg', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { item: { id: 9, status_id: 2 } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', Date: new Date().toUTCString() },
      })
    );
    const { mod, peer } = await captureBroadcasts();
    const item = await mod.items.transition(9, 2);
    expect(item.id).toBe(9);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v2/items/9/transition');
    expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ to_status_id: 2 });
    expect(posted[0]).toEqual(expect.objectContaining({ type: 'transition', itemId: 9 }));
    peer.close();
  });

  it('updateFracIndex broadcasts a reorder notice', async () => {
    const { mod, peer } = await captureBroadcasts();
    await mod.items.updateFracIndex(3, { previous_item_id: 2, next_item_id: 4 });
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v2/items/3/rank');
    expect(fetchSpy.mock.calls[0][1].method).toBe('PATCH');
    expect(fetchSpy.mock.calls[0][1].headers['Content-Type']).toBe('application/merge-patch+json');
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({
      previous_item_id: 2,
      next_item_id: 4,
    });
    expect(posted[0]).toEqual(expect.objectContaining({ type: 'reorder', itemId: 3 }));
    peer.close();
  });

  it('previews a cross-workspace move without broadcasting a mutation', async () => {
    const { mod, peer } = await captureBroadcasts();
    await mod.items.previewWorkspaceMove(7, { destination_workspace_id: 9 });

    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v2/items/7/move-workspace/preview');
    expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ destination_workspace_id: 9 });
    expect(posted).toEqual([]);
    peer.close();
  });

  it('moves an item between workspaces and broadcasts the item id', async () => {
    const { mod, peer } = await captureBroadcasts();
    const payload = {
      destination_workspace_id: 9,
      target_item_type_id: 2,
      target_status_id: 3,
      target_priority_id: null,
    };
    await mod.items.moveWorkspace(7, payload);

    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v2/items/7/move-workspace');
    expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual(payload);
    expect(posted[0]).toEqual(expect.objectContaining({ type: 'update', itemId: 7 }));
    peer.close();
  });

  it('does not broadcast when the request rejects', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'internal_error', message: 'boom' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', Date: new Date().toUTCString() },
      })
    );
    const { mod, peer } = await captureBroadcasts();
    await expect(mod.items.update(1, { title: 'z' })).rejects.toMatchObject({
      status: 500,
      code: 'internal_error',
      message: 'boom',
    });
    expect(posted).toEqual([]);
    peer.close();
  });

  it('loads the numeric item-detail summary with the optional surface selector', async () => {
    const summary = { item: { id: 42, title: 'x' }, children: [], ancestors: [], watching: false };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: summary }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const { items } = await import('./items.js');
    const controller = new AbortController();

    expect(
      await items.getDetailSummary(42, { surface: 'mobile', signal: controller.signal })
    ).toEqual(summary);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v2/items/42/detail-summary?surface=mobile');
    expect(fetchSpy.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('loads a key-addressed item-detail summary without a preliminary item request', async () => {
    const summary = { item: { id: 42, title: 'x' }, children: [], ancestors: [], watching: false };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: summary }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const { items } = await import('./items.js');

    expect(await items.getDetailSummaryByKey('WI', 689)).toEqual(summary);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v2/workspaces/WI/items/689/detail-summary');
  });

  it('resolves the first item from the filtered backlog', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: 11 }],
          pagination: { page: 1, page_size: 1, total_items: 125, total_pages: 125 },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            Date: new Date().toUTCString(),
          },
        }
      )
    );
    const { items } = await import('./items.js');

    const boundary = await items.getBacklogBoundary(7, null, 'priority = high', 'start');

    expect(boundary).toEqual({ id: 11 });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toContain('/api/v2/items/backlog?');
    expect(fetchSpy.mock.calls[0][0]).toContain('workspace_id=7');
    expect(fetchSpy.mock.calls[0][0]).toContain('sub_ql=priority+%3D+high');
    expect(fetchSpy.mock.calls[0][0]).toContain('page=1');
    expect(fetchSpy.mock.calls[0][0]).toContain('page_size=1');
  });

  it('uses the current total to resolve the true last backlog item', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 11 }],
            pagination: { page: 1, page_size: 1, total_items: 125, total_pages: 125 },
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              Date: new Date().toUTCString(),
            },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 135 }],
            pagination: { page: 125, page_size: 1, total_items: 125, total_pages: 125 },
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              Date: new Date().toUTCString(),
            },
          }
        )
      );
    const { items } = await import('./items.js');

    const boundary = await items.getBacklogBoundary(null, 23, '', 'end');

    expect(boundary).toEqual({ id: 135 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toContain('collection_id=23');
    expect(fetchSpy.mock.calls[1][0]).toContain('collection_id=23');
    expect(fetchSpy.mock.calls[1][0]).toContain('page=125');
    expect(fetchSpy.mock.calls[1][0]).toContain('page_size=1');
  });
});
