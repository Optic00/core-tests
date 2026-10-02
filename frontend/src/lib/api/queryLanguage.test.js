import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./core.js', () => ({
  fetchV2Data: vi.fn(),
}));

const { fetchV2Data } = await import('./core.js');
const { queryLanguage } = await import('./queryLanguage.js');

describe('query language API', () => {
  beforeEach(() => fetchV2Data.mockReset());

  it('loads filtered values through the centralized completion endpoint', async () => {
    fetchV2Data.mockResolvedValue([{ value: 'Frontend', label: 'Frontend' }]);

    const result = await queryLanguage.getValues(
      { source: 'labels', value_field: 'name' },
      'front end'
    );

    expect(fetchV2Data).toHaveBeenCalledWith(
      '/query-language/values?source=labels&value_field=name&q=front+end'
    );
    expect(result).toEqual([{ value: 'Frontend', label: 'Frontend' }]);
  });
});
