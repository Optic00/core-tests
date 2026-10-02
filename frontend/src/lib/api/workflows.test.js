import { beforeEach, describe, expect, it, vi } from 'vitest';

const clients = vi.hoisted(() => ({
  statuses: {
    create: vi.fn(),
    get: vi.fn(),
    getAll: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('./core.js', () => ({
  fetchAPI: vi.fn(),
  fetchV2Data: vi.fn(),
}));

vi.mock('./createCrudClient.js', () => ({
  createCrudClient: vi.fn(() => clients.statuses),
}));

const { statuses, workflows } = await import('./workflows.js');
const { fetchV2Data } = await import('./core.js');

describe('status API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes nested v2 categories for existing frontend consumers', async () => {
    clients.statuses.getAll.mockResolvedValue([
      {
        id: 3,
        name: 'Closed',
        category: {
          id: 30,
          name: 'Done',
          display_name: 'Completed',
          builtin_key: 'done',
          color: '#22c55e',
          is_completed: true,
        },
      },
    ]);

    await expect(statuses.getAll()).resolves.toEqual([
      expect.objectContaining({
        id: 3,
        category_id: 30,
        category_name: 'Done',
        category_display_name: 'Completed',
        category_builtin_key: 'done',
        category_color: '#22c55e',
        is_completed: true,
      }),
    ]);
  });
});

describe('workflow transitions API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flattens nested v2 status objects and keeps from-all transitions', async () => {
    fetchV2Data.mockResolvedValue([
      {
        id: 10,
        from_all_statuses: false,
        from: { id: 1, name: 'Open' },
        to: { id: 2, name: 'Review' },
      },
      {
        id: 11,
        from_all_statuses: true,
        from: null,
        to: { id: 3, name: 'Rejected' },
      },
    ]);

    await expect(workflows.getTransitions(5)).resolves.toEqual([
      expect.objectContaining({
        id: 10,
        from_status_id: 1,
        from_status_name: 'Open',
        to_status_id: 2,
        to_status_name: 'Review',
        from_all_statuses: false,
      }),
      expect.objectContaining({
        id: 11,
        from_status_id: null,
        from_status_name: '',
        to_status_id: 3,
        to_status_name: 'Rejected',
        from_all_statuses: true,
      }),
    ]);
    expect(fetchV2Data).toHaveBeenCalledWith('/workflows/5/transitions');
  });
});
