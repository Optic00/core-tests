import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./core.js', () => ({
  fetchV2Data: vi.fn(),
}));

const { fetchV2Data } = await import('./core.js');
const { actions } = await import('./actions.js');

describe('workspace actions API', () => {
  beforeEach(() => {
    fetchV2Data.mockReset();
  });

  it('sets the desired enabled state through the resource patch', async () => {
    await actions.update(4, 9, { is_enabled: true });

    expect(fetchV2Data).toHaveBeenCalledWith('/workspaces/4/actions/9', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify({ is_enabled: true }),
    });
  });

  it('creates actions through the canonical workspace route', async () => {
    const action = {
      name: 'Notify support',
      description: 'Send a notification',
      trigger_type: 'manual',
      is_enabled: false,
    };

    await actions.create(4, action);

    expect(fetchV2Data).toHaveBeenCalledWith('/workspaces/4/actions', {
      method: 'POST',
      body: JSON.stringify(action),
    });
  });

  it('removes response-only fields from strict v2 action updates', async () => {
    await actions.update(4, 9, {
      id: 9,
      workspace_id: 4,
      name: 'Notify support',
      description: 'Send a notification',
      trigger_type: 'manual',
      trigger_config: '{}',
      is_enabled: true,
      actor_user_id: null,
      allowed_role_ids: [3],
      nodes: [],
      edges: [],
      created_at: '2026-09-03T08:00:00Z',
    });

    expect(fetchV2Data).toHaveBeenCalledWith('/workspaces/4/actions/9', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify({
        name: 'Notify support',
        description: 'Send a notification',
        trigger_type: 'manual',
        trigger_config: '{}',
        is_enabled: true,
        actor_user_id: null,
        allowed_role_ids: [3],
        nodes: [],
        edges: [],
      }),
    });
  });
});
