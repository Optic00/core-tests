import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../stores/i18n.svelte.js', async (importOriginal) => ({
  ...(await importOriginal()),
  t: (key) =>
    ({
      'aria.resizeNavigation': 'Resize navigation sidebar',
      'aria.sidebarResizeHint': 'Drag to resize. Double-click to reset.',
    })[key] ?? key,
}));

import ApiDocs from './ApiDocs.svelte';

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/api-docs');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubSpec() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        paths: {
          '/items': {
            get: {
              tags: ['Items'],
              summary: 'List work items',
              responses: { 200: { description: 'OK' } },
            },
            post: {
              tags: ['Items'],
              summary: 'Create a work item',
              responses: { 201: { description: 'Created' } },
            },
          },
          '/users/me': {
            get: {
              tags: ['Users'],
              summary: 'Get the current user',
              responses: { 200: { description: 'OK' } },
            },
          },
        },
      }),
    }))
  );
}

describe('API documentation browser', () => {
  it('defaults to v2 and reloads the explicit v1 compatibility document', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => ({
        ok: true,
        json: async () => ({
          paths: {
            [url.includes('/v1/') ? '/v1-operation' : '/v2-operation']: {
              get: {
                summary: 'Operation',
                responses: { 200: { description: 'OK' } },
              },
            },
          },
        }),
      }))
    );
    render(ApiDocs);

    const selector = await screen.findByTestId('api-docs-version');
    await waitFor(() =>
      expect(screen.getByTestId('api-docs-op-link')).toHaveTextContent('/v2-operation')
    );
    expect(selector).toHaveValue('v2');
    expect(fetch).toHaveBeenCalledWith('/api/v2/openapi.json', {
      headers: { Accept: 'application/json' },
    });

    await fireEvent.change(selector, { target: { value: 'v1' } });

    await waitFor(() =>
      expect(screen.getByTestId('api-docs-op-link')).toHaveTextContent('/v1-operation')
    );
    expect(window.location.search).toBe('?version=v1');
    expect(fetch).toHaveBeenCalledWith('/rest/api/v1/openapi.json', {
      headers: { Accept: 'application/json' },
    });
  });

  it('restores the selected API version and operation from the URL', async () => {
    window.history.replaceState({}, '', '/api-docs?version=v1#op-get-users-me');
    stubSpec();

    render(ApiDocs);

    const selector = await screen.findByTestId('api-docs-version');
    expect(selector).toHaveValue('v1');
    expect(fetch).toHaveBeenCalledWith('/rest/api/v1/openapi.json', {
      headers: { Accept: 'application/json' },
    });
    await waitFor(() =>
      expect(screen.getAllByTestId('api-docs-op-link')[2]).toHaveAttribute('aria-current', 'page')
    );
  });

  it('resizes the navigation by pointer or keyboard and remembers the width', async () => {
    stubSpec();
    render(ApiDocs);

    const pane = await screen.findByTestId('api-docs-sidebar-pane');
    const handle = screen.getByTestId('api-docs-sidebar-resize');
    expect(pane).toHaveStyle({ width: '320px' });

    await fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 320,
      pointerId: 4,
    });
    await fireEvent.pointerMove(handle, { clientX: 420, pointerId: 4 });
    await fireEvent.pointerUp(handle, { pointerId: 4 });

    expect(pane).toHaveStyle({ width: '420px' });
    expect(handle).toHaveAttribute('aria-valuenow', '420');
    expect(localStorage.getItem('api-docs-sidebar-width')).toBe('420');

    await fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(pane).toHaveStyle({ width: '436px' });
    expect(localStorage.getItem('api-docs-sidebar-width')).toBe('436');
  });

  it('keeps the restored width within the viewport-aware bounds', async () => {
    vi.stubGlobal('innerWidth', 800);
    localStorage.setItem('api-docs-sidebar-width', '900');
    stubSpec();

    render(ApiDocs);

    expect(await screen.findByTestId('api-docs-sidebar-pane')).toHaveStyle({
      width: '480px',
    });
    expect(screen.getByTestId('api-docs-sidebar-resize')).toHaveAttribute('aria-valuemax', '480');
  });

  it('moves within the filtered operation results', async () => {
    stubSpec();
    render(ApiDocs);

    await screen.findByTestId('api-docs-filter');
    await fireEvent.input(screen.getByTestId('api-docs-filter'), {
      target: { value: 'current user' },
    });

    expect(screen.getAllByTestId('api-docs-op-link')).toHaveLength(1);
    expect(screen.getByTestId('api-docs-operation-position')).toHaveTextContent('1 matching');
    await fireEvent.click(screen.getByTestId('api-docs-next-operation'));

    expect(screen.getByTestId('api-docs-op-link')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('api-docs-operation-position')).toHaveTextContent('1 of 1');
    expect(screen.getByTestId('api-docs-next-operation')).toBeDisabled();
    expect(window.location.hash).toBe('#op-get-users-me');
  });

  it('collapses tag groups and reveals matching tags while searching', async () => {
    stubSpec();
    render(ApiDocs);

    const toggles = await screen.findAllByTestId('api-docs-tag-toggle');
    expect(screen.getAllByTestId('api-docs-op-link')).toHaveLength(3);

    await fireEvent.click(toggles[0]);
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByTestId('api-docs-op-link')).toHaveLength(1);

    await fireEvent.input(screen.getByTestId('api-docs-filter'), {
      target: { value: 'Items' },
    });
    expect(screen.getAllByTestId('api-docs-op-link')).toHaveLength(2);
    expect(screen.getByText('List work items')).toBeInTheDocument();
  });

  it('moves between adjacent operations and resets the detail scroll position', async () => {
    stubSpec();
    render(ApiDocs);

    const main = await screen.findByTestId('api-docs-main');
    main.scrollTop = 240;

    await fireEvent.click(screen.getByTestId('api-docs-next-operation'));

    expect(screen.getAllByTestId('api-docs-op-link')[1]).toHaveAttribute('aria-current', 'page');
    expect(main.scrollTop).toBe(0);
    expect(window.location.hash).toBe('#op-post-items');
  });
});
