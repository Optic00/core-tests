import { cleanup, render, screen } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { collectionStore } = vi.hoisted(() => ({
  collectionStore: {
    collectionName: 'All of mine',
    itemsPagination: { total_items: 293 },
    collectionTotal: 671,
  },
}));

vi.mock('../../stores/i18n.svelte.js', () => ({
  t: (key) => (key === 'layout.items' ? 'items' : 'Collection'),
}));

vi.mock('../../stores/collectionContext.js', () => ({ collectionStore }));
vi.mock('../../router.js', () => ({
  navigate: vi.fn(),
  currentRoute: writable({ view: 'collection-board' }),
}));
vi.mock('../../stores/ui.svelte.js', () => ({
  uiStore: writable({ wsSidebarWidth: 260, wsSidebarCollapsed: false }),
  WS_SIDEBAR_DEFAULT_WIDTH: 260,
}));

import CollectionNavigation from './CollectionNavigation.svelte';

afterEach(cleanup);

describe('collection navigation item count', () => {
  it.each([
    ['including separately loaded board items', 293, 671],
    ['without separately loaded items', 293, 293],
    ['with an empty collection', 0, 0],
    ['with an unavailable total', 293, null],
  ])('shows the collection total %s', (_scenario, mainTotal, total) => {
    collectionStore.itemsPagination = { total_items: mainTotal };
    collectionStore.collectionTotal = total;

    render(CollectionNavigation, { collectionId: '7' });

    expect(screen.getByTestId('collection-sidebar-count')).toHaveTextContent(
      total === null ? 'Collection' : `Collection · ${total} items`
    );
  });
});
