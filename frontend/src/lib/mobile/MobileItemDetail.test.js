import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const stream = vi.hoisted(() => ({ handlers: null }));

vi.mock('../api.js', () => ({
  api: {
    items: {
      get: vi.fn(),
      getAvailableStatusTransitions: vi.fn(),
      getChildren: vi.fn(),
      getWatchStatus: vi.fn(),
    },
  },
}));
vi.mock('./mobileItemDetailData.js', () => ({ loadMobileItemDetailSummary: vi.fn() }));
vi.mock('../router.js', () => ({ navigate: vi.fn() }));
vi.mock('../stores/toasts.svelte.js', () => ({ infoToast: vi.fn(), errorToast: vi.fn() }));
vi.mock('../stores/notifications.js', () => ({ notificationActions: { markItemAsRead: vi.fn() } }));
vi.mock('../stores/timerStore.svelte.js', () => ({ timerStore: { hasActive: false } }));
vi.mock('../stores/agentRuns.svelte.js', () => ({ agentRuns: { subscribe: () => () => {} } }));
vi.mock('../stores/itemLiveUpdates.svelte.js', () => ({ itemLiveUpdates: { isLive: () => true } }));
vi.mock('../stores', async () => {
  const { writable } = await import('svelte/store');
  return { workspacesStore: writable({ personalWorkspace: { id: 999 } }) };
});
vi.mock('../stores/i18n.svelte.js', () => ({ t: (key) => key }));
vi.mock('../composables/useWorkItemPoller.svelte.js', () => ({ useWorkItemPoller: () => {} }));
vi.mock('../composables/useItemEventStream.svelte.js', () => ({
  useItemEventStream: (_itemId, handlers) => { stream.handlers = handlers; },
}));
vi.mock('../composables/usePullToRefresh.svelte.js', () => ({
  usePullToRefresh: () => ({ pulling: false, refreshing: false, pullDistance: 0, threshold: 60 }),
}));
vi.mock('./MobileHeader.svelte', () => ({ default: function MobileHeader() {} }));
vi.mock('./MobileOptionSheet.svelte', () => ({ default: function MobileOptionSheet() {} }));
vi.mock('../components/StatusPill.svelte', () => ({ default: function StatusPill() {} }));
vi.mock('../features/items/Comments.svelte', () => ({ default: function Comments() {} }));

import { api } from '../api.js';
import { navigate } from '../router.js';
import { infoToast } from '../stores/toasts.svelte.js';
import { loadMobileItemDetailSummary } from './mobileItemDetailData.js';
import MobileItemDetail from './MobileItemDetail.svelte';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function summary(id) {
  return {
    item: {
      id,
      title: `Item ${id}`,
      workspace_id: 1,
      workspace_key: 'WI',
      workspace_item_number: id,
      status_name: 'Open',
    },
  };
}

beforeEach(() => {
  stream.handlers = null;
  vi.mocked(loadMobileItemDetailSummary).mockImplementation(async (id) => summary(id));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  stream.handlers = null;
});

describe('MobileItemDetail deletion refresh', () => {
  test('keeps item B visible when a pending refresh of item A returns 404', async () => {
    const pendingA = deferred();
    api.items.get.mockReturnValueOnce(pendingA.promise);
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(2);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const view = render(MobileItemDetail, { itemId: 101 });
    expect(await screen.findByTestId('detail-title')).toHaveTextContent('Item 101');

    const refreshA = stream.handlers.onItem();
    expect(api.items.get).toHaveBeenCalledWith(101);
    await view.rerender({ itemId: 202 });
    expect(await screen.findByTestId('detail-title')).toHaveTextContent('Item 202');

    pendingA.reject({ status: 404 });
    await refreshA;
    await tick();
    expect(screen.getByTestId('detail-title')).toHaveTextContent('Item 202');
    expect(infoToast).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  test('navigates away when the current item refresh returns 404', async () => {
    const pending = deferred();
    api.items.get.mockReturnValueOnce(pending.promise);
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(2);
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(MobileItemDetail, { itemId: 101 });
    expect(await screen.findByTestId('detail-title')).toHaveTextContent('Item 101');

    const refresh = stream.handlers.onItem();
    expect(api.items.get).toHaveBeenCalledWith(101);
    pending.reject({ status: 404 });
    await refresh;
    expect(infoToast).toHaveBeenCalledWith('mobile.item.deleted');
    expect(back).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });
});
