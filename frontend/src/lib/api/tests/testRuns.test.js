import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core.js', () => ({
  fetchV2Data: vi.fn(),
}));

vi.mock('../createCrudClient.js', () => ({
  createCrudClient: vi.fn(() => ({})),
}));

const { fetchV2Data } = await import('../core.js');
const { testRuns } = await import('./testRuns.js');

describe('test runs API', () => {
  beforeEach(() => fetchV2Data.mockReset());

  it('loads the complete run graph through one detail request', async () => {
    fetchV2Data.mockResolvedValue({ run: { id: 9 } });

    await testRuns.getDetail(3, 9);

    expect(fetchV2Data).toHaveBeenCalledOnce();
    expect(fetchV2Data).toHaveBeenCalledWith('/workspaces/3/test-runs/9/detail');
  });
});
