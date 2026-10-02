import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => ({
  api: {
    collections: {
      getBoardConfiguration: vi.fn(),
    },
  },
}));

import { api } from '../api.js';
import { viewSettingsStore } from './viewSettings.svelte.js';

describe('view settings store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewSettingsStore.invalidateWorkspace(1);
    viewSettingsStore.invalidateWorkspace(2);
  });

  it('exposes every toggleable nav entry before a lookup and on failure', async () => {
    // The fallback covers tools entries too; view membership checks only
    // ever match the view ids among them.
    expect(viewSettingsStore.enabledViewIds(1, null)).toEqual(viewSettingsStore.allNavIds);

    api.collections.getBoardConfiguration.mockRejectedValue(new Error('boom'));
    await viewSettingsStore.load(1, null);

    expect(viewSettingsStore.enabledViewIds(1, null)).toEqual(viewSettingsStore.allNavIds);
    expect(viewSettingsStore.entryFor(1, null).loaded).toBe(false);
  });

  it('caches the effective override per scope', async () => {
    api.collections.getBoardConfiguration.mockResolvedValue({
      view_settings: { enabled_views: ['board', 'list'] },
      view_settings_inherited: false,
    });

    await viewSettingsStore.load(1, 7);

    expect(api.collections.getBoardConfiguration).toHaveBeenCalledWith(7, 1);
    expect(viewSettingsStore.enabledViewIds(1, 7)).toEqual(['board', 'list']);
    expect(viewSettingsStore.inherited(1, 7)).toBe(false);

    await viewSettingsStore.load(1, 7);
    expect(api.collections.getBoardConfiguration).toHaveBeenCalledTimes(1);
  });

  it('falls back to every view for missing and empty settings', async () => {
    api.collections.getBoardConfiguration
      .mockResolvedValueOnce({ view_settings_inherited: true })
      .mockResolvedValueOnce({ view_settings: { enabled_views: [] } });

    await viewSettingsStore.load(2, null);
    expect(viewSettingsStore.enabledViewIds(2, null)).toEqual(viewSettingsStore.allNavIds);
    expect(viewSettingsStore.inherited(2, null)).toBe(true);

    await viewSettingsStore.load(2, 9);
    expect(viewSettingsStore.enabledViewIds(2, 9)).toEqual(viewSettingsStore.allNavIds);
  });

  it('exposes the workspace nav set for tools entries', async () => {
    api.collections.getBoardConfiguration.mockResolvedValue({
      view_settings: { enabled_views: ['board', 'agents'] },
    });

    // Unloaded scopes resolve to everything enabled, agents included.
    expect(viewSettingsStore.enabledNavIds(1)).toContain('agents');
    await viewSettingsStore.load(1, null);

    expect(viewSettingsStore.enabledNavIds(1)).toEqual(['board', 'agents']);
    // Other workspaces keep the everything-enabled fallback until their own
    // lookup resolves.
    expect(viewSettingsStore.enabledNavIds(2)).toEqual(viewSettingsStore.allNavIds);
    // Test entries are not nav-configurable and never appear in the set.
    expect(viewSettingsStore.allNavIds).not.toContain('test-cases');
  });

  it('invalidates a single scope and whole workspaces independently', async () => {
    api.collections.getBoardConfiguration.mockResolvedValue({
      view_settings: { enabled_views: ['board'] },
    });
    await viewSettingsStore.load(1, null);
    await viewSettingsStore.load(1, 7);
    await viewSettingsStore.load(2, null);
    api.collections.getBoardConfiguration.mockClear();

    viewSettingsStore.invalidate(1, 7);
    await viewSettingsStore.load(1, 7);
    expect(api.collections.getBoardConfiguration).toHaveBeenCalledTimes(1);

    api.collections.getBoardConfiguration.mockClear();
    viewSettingsStore.invalidateWorkspace(1);
    await viewSettingsStore.load(1, null);
    await viewSettingsStore.load(1, 7);
    expect(api.collections.getBoardConfiguration).toHaveBeenCalledTimes(2);

    // The other workspace's caches survive.
    api.collections.getBoardConfiguration.mockClear();
    await viewSettingsStore.load(2, null);
    expect(api.collections.getBoardConfiguration).not.toHaveBeenCalled();
  });
});

describe('disabled view redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewSettingsStore.invalidateWorkspace(1);
  });

  it('ignores non-workspace and unguarded views', async () => {
    const { getDisabledViewRedirect } = await import('../pages/mainAppViewGuard.js');
    expect(getDisabledViewRedirect({ view: 'workspace-settings-general', params: { id: 1 } }, {})).toBeNull();
    expect(getDisabledViewRedirect({ view: 'workspace-agents', params: { id: 1 } }, {})).toBeNull();
    expect(getDisabledViewRedirect({ view: 'workspace-board', params: {} }, {})).toBeNull();
  });

  it('redirects disabled workspace-only nav entries to the workspace root', async () => {
    const { getDisabledViewRedirect } = await import('../pages/mainAppViewGuard.js');
    api.collections.getBoardConfiguration.mockResolvedValue({
      view_settings: { enabled_views: ['board', 'pages'] },
    });
    await viewSettingsStore.load(1, null);

    // A disabled tools entry bounces to the workspace root; an enabled one
    // stays. Test routes are not guarded: test entries are not configurable.
    expect(
      getDisabledViewRedirect({ view: 'workspace-agents', params: { id: 1 } }, {})
    ).toBe('/workspaces/1');
    expect(getDisabledViewRedirect({ view: 'workspace-pages', params: { id: 1 } }, {})).toBeNull();
    expect(getDisabledViewRedirect({ view: 'test-cases', params: { id: 1 } }, {})).toBeNull();
    // Detail views of a guarded entry are not themselves guarded.
    expect(getDisabledViewRedirect({ view: 'workspace-agent-profile', params: { id: 1 } }, {})).toBeNull();
  });

  it('keeps enabled views and redirects disabled ones to the default view', async () => {
    const { getDisabledViewRedirect } = await import('../pages/mainAppViewGuard.js');
    api.collections.getBoardConfiguration.mockResolvedValue({
      view_settings: { enabled_views: ['board', 'list'] },
    });
    await viewSettingsStore.load(1, null);

    const route = { view: 'workspace-board', params: { id: 1 } };
    expect(getDisabledViewRedirect(route, { default_view: 'board' })).toBeNull();

    // The disabled map route falls back to the enabled workspace default.
    expect(
      getDisabledViewRedirect({ view: 'workspace-map', params: { id: 1 } }, { default_view: 'board' })
    ).toBe('/workspaces/1/board');
  });

  it('falls back to the first enabled view when the default is disabled', async () => {
    const { getDisabledViewRedirect } = await import('../pages/mainAppViewGuard.js');
    api.collections.getBoardConfiguration.mockResolvedValue({
      view_settings: { enabled_views: ['list'] },
    });
    await viewSettingsStore.load(1, 7);

    expect(
      getDisabledViewRedirect(
        { view: 'workspace-board', params: { id: 1, collectionId: 7 } },
        { default_view: 'board' }
      )
    ).toBe('/workspaces/1/collections/7/list');
  });
});
