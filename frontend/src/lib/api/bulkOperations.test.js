import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./core.js', () => ({
  // The planning module also constructs retained enum configuration clients.
  fetchAPI: vi.fn(),
  fetchV2Data: vi.fn(),
}));

vi.mock('../utils/crossTabSync.js', () => ({
  notifyItemMutation: vi.fn(),
}));

const { fetchAPI, fetchV2Data } = await import('./core.js');
const { notifyItemMutation } = await import('../utils/crossTabSync.js');
const { items } = await import('./items.js');
const { iterations } = await import('./milestones.js');

describe('bulk operation API clients', () => {
  beforeEach(() => {
    fetchAPI.mockReset();
    fetchV2Data.mockReset();
    notifyItemMutation.mockReset();
  });

  afterEach(() => expect(fetchAPI).not.toHaveBeenCalled());

  it('sends one atomic request for a flexible work-item field patch', async () => {
    fetchV2Data.mockResolvedValue({ updated_count: 100, items: [] });

    await items.bulkUpdate(
      Array.from({ length: 100 }, (_, index) => index + 1),
      { priority_id: 7, iteration_id: 12 }
    );

    expect(fetchV2Data).toHaveBeenCalledTimes(1);
    expect(fetchV2Data).toHaveBeenCalledWith('/items/bulk-update', {
      method: 'POST',
      body: JSON.stringify({
        item_ids: Array.from({ length: 100 }, (_, index) => index + 1),
        set: { priority_id: 7, iteration_id: 12 },
      }),
    });
    expect(notifyItemMutation).toHaveBeenCalledOnce();
  });

  it('sends distinct roadmap date patches in one atomic request', async () => {
    fetchV2Data.mockResolvedValue({ updated_count: 2, items: [] });
    const patches = [
      { item_id: 11, set: { start_date: '2026-08-10' } },
      { item_id: 12, set: { end_date: '2026-08-20' } },
    ];

    await items.bulkPatch(patches);

    expect(fetchV2Data).toHaveBeenCalledOnce();
    expect(fetchV2Data).toHaveBeenCalledWith('/items/bulk-patch', {
      method: 'POST',
      body: JSON.stringify({ patches }),
    });
    expect(notifyItemMutation).toHaveBeenCalledOnce();
  });

  it('loads the hierarchy date projection with one request', async () => {
    fetchV2Data.mockResolvedValue({ items: [], truncated: false });

    await items.getRoadmapHierarchyDates([11, 12]);

    expect(fetchV2Data).toHaveBeenCalledOnce();
    expect(fetchV2Data).toHaveBeenCalledWith('/items/roadmap-hierarchy-dates', {
      method: 'POST',
      body: JSON.stringify({ root_ids: [11, 12] }),
    });
    expect(notifyItemMutation).not.toHaveBeenCalled();
  });

  it('forwards a 500-item completion result with one v2 client call', async () => {
    fetchV2Data.mockResolvedValue({ moved_count: 500, items: [] });

    expect(await iterations.complete(41, 42)).toEqual({ moved_count: 500, items: [] });

    expect(fetchV2Data).toHaveBeenCalledTimes(1);
    expect(fetchV2Data).toHaveBeenCalledWith('/iterations/41/complete', {
      method: 'POST',
      body: JSON.stringify({ move_incomplete_to_iteration_id: 42 }),
    });
  });

  it.each([
    ['bulkUpdate', () => items.bulkUpdate([11], { priority_id: 7 })],
    ['bulkPatch', () => items.bulkPatch([{ item_id: 11, set: { priority_id: 7 } }])],
  ])('%s propagates rejection without broadcasting a successful mutation', async (_name, call) => {
    const denied = Object.assign(new Error('Denied'), { status: 404, code: 'not_found' });
    fetchV2Data.mockRejectedValueOnce(denied);
    await expect(call()).rejects.toBe(denied);
    expect(fetchV2Data).toHaveBeenCalledOnce();
    expect(notifyItemMutation).not.toHaveBeenCalled();
  });
});
