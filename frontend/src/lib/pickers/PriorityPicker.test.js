import { render, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => ({
  api: {
    workspaces: {
      get: vi.fn(),
      // WI-1351: workspace-scoped priority configuration resolves through
      // workspaceDataStore.screenConfig, which calls getEffectiveConfig.
      getEffectiveConfig: vi.fn(),
    },
    configurationSets: { get: vi.fn() },
    priorities: { getAll: vi.fn() },
  },
}));

vi.mock('../stores/i18n.svelte.js', () => ({
  t: (key) => key,
}));

const { api } = await import('../api.js');
const { default: PriorityPicker } = await import('./PriorityPicker.svelte');

describe('PriorityPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads default priorities when the workspace configuration set has none', async () => {
    // Store is uninitialized in this test, so screenConfig resolves to null
    // without hitting the API, and the picker falls back to the global
    // priority list.
    api.workspaces.getEffectiveConfig.mockResolvedValue({ priorities: [] });
    api.priorities.getAll.mockResolvedValue([{ id: 3, name: 'Medium', sort_order: 0 }]);

    render(PriorityPicker, { props: { workspaceId: 9 } });

    await waitFor(() => {
      expect(api.priorities.getAll).toHaveBeenCalled();
    });
  });
});
