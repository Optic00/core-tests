import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api.js', () => ({
  api: {
    sla: {},
  },
}));

import { api } from '../../api.js';
import { getItemSLA, invalidateSLAState } from './slaState.js';

function flushMicrotasks() {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe('slaState batch coalescing', () => {
  beforeEach(() => {
    invalidateSLAState();
    vi.clearAllMocks();
    // Assignments in earlier tests persist on the shared mock object.
    delete api.sla.getItemSLABatch;
    delete api.sla.getItemSLA;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('coalesces same-tick reads for one workspace into a single batch request', async () => {
    api.sla.getItemSLABatch = vi.fn().mockResolvedValue({
      11: [{ metric_id: 1, metric_name: 'First response' }],
      12: [{ metric_id: 1, metric_name: 'First response' }],
    });

    const first = getItemSLA(11, 5);
    const second = getItemSLA(12, 5);
    await Promise.all([first, second]);
    await flushMicrotasks();

    expect(api.sla.getItemSLABatch).toHaveBeenCalledTimes(1);
    expect(api.sla.getItemSLABatch).toHaveBeenCalledWith(5, [11, 12]);
    expect(await first).toEqual([{ metric_id: 1, metric_name: 'First response' }]);
    expect(await second).toEqual([{ metric_id: 1, metric_name: 'First response' }]);
    // The per-item fallback must stay unused when the batch succeeds.
    expect(api.sla.getItemSLA?.mock?.calls?.length ?? 0).toBe(0);
  });

  it('falls back to per-item reads when the batch request fails', async () => {
    api.sla.getItemSLABatch = vi.fn().mockRejectedValue(new Error('boom'));
    api.sla.getItemSLA = vi.fn().mockResolvedValue([{ metric_id: 2, metric_name: 'Fallback' }]);

    const value = await getItemSLA(13, 5);
    await flushMicrotasks();

    expect(api.sla.getItemSLABatch).toHaveBeenCalledTimes(1);
    expect(api.sla.getItemSLA).toHaveBeenCalledWith(13);
    expect(value).toEqual([{ metric_id: 2, metric_name: 'Fallback' }]);
  });

  it('issues separate batch requests per workspace', async () => {
    api.sla.getItemSLABatch = vi.fn().mockResolvedValue({});

    await Promise.all([getItemSLA(14, 5), getItemSLA(15, 6)]);
    await flushMicrotasks();

    const workspaces = api.sla.getItemSLABatch.mock.calls.map((call) => call[0]);
    expect(workspaces.sort()).toEqual([5, 6]);
  });

  it('uses the single-item read when batching is unavailable', async () => {
    api.sla.getItemSLA = vi.fn().mockResolvedValue([{ metric_id: 3 }]);

    const value = await getItemSLA(16, 5);

    expect(value).toEqual([{ metric_id: 3 }]);
    expect(api.sla.getItemSLA).toHaveBeenCalledWith(16);
  });
});
