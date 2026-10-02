import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./core.js', () => ({
  API_BASE: '/api',
  fetchAPI: vi.fn(),
  fetchAPIV2: vi.fn(),
  fetchV2Data: vi.fn(),
}));

vi.mock('./createCrudClient.js', () => ({
  createCrudClient: vi.fn(() => ({})),
}));

const { fetchAPI, fetchAPIV2 } = await import('./core.js');
const { customFields, screens } = await import('./configuration.js');

describe('screen API', () => {
  beforeEach(() => fetchAPI.mockReset());

  it('requests all screen fields through the enriched list', async () => {
    fetchAPI.mockResolvedValue([]);

    await screens.getAllWithFields();

    expect(fetchAPI).toHaveBeenCalledOnce();
    expect(fetchAPI).toHaveBeenCalledWith('/screens?include_fields=true');
  });
});

describe('custom-field API', () => {
  it('projects the v2 metadata document for the admin overview', async () => {
	fetchAPIV2.mockResolvedValue({
	  data: [{ id: 7 }],
	  meta: { index_counts: { items: { current: 1, max: 20 } } },
	});

	await expect(customFields.getOverview()).resolves.toEqual({
	  customFields: [{ id: 7 }],
	  indexCounts: { items: { current: 1, max: 20 } },
	});
  });
});
