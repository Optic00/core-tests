import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { pages } from './pages.js';

/**
 * Pin the URL / method / body shape of each `pages.*` client method.
 * fetchAPI is invoked through the global `fetch`; we stub `fetch` and
 * assert what got sent. Catching a path or verb mismatch here surfaces a
 * server-vs-client wiring drift before it lands in production.
 *
 * Page routes mirror the v2 adapter and use real frontend transport decoding.
 * Knowledge search remains on its explicitly supported legacy route.
 */

describe('pages API client', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: { id: 7, title: 'Page result' } }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            Date: new Date().toUTCString(),
          },
        })
    );
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const lastCall = () => {
    expect(fetchSpy).toHaveBeenCalledOnce();
    return fetchSpy.mock.calls[0];
  };

  function respond(body, status = 200) {
    fetchSpy.mockResolvedValueOnce(
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }

  test('getAll → GET the flat v2 page metadata list', async () => {
    const metadata = [
      { id: 7, title: 'Root', parent_id: null },
      { id: 8, title: 'Child', parent_id: 7 },
    ];
    respond({ data: metadata });
    expect(await pages.getAll(42)).toEqual(metadata);
    const [url, init] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages');
    expect(init.method).toBeUndefined(); // fetchAPI defaults to GET
    expect(init.credentials).toBe('same-origin');
  });

  test('getPage → GET /api/v2/workspaces/:id/pages/:pageId', async () => {
    expect(await pages.getPage(42, 7)).toEqual({ id: 7, title: 'Page result' });
    const [url] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages/7');
  });

  test('createPage → POST with body, optional parentId and isHome', async () => {
    const created = { id: 9, title: 'New', content: 'body', parent_id: 5, is_home: true };
    respond({ data: created }, 201);
    expect(
      await pages.createPage(42, {
        title: 'New',
        content: 'body',
        parentId: 5,
        isHome: true,
      })
    ).toEqual(created);
    const [url, init] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      title: 'New',
      content: 'body',
      parent_id: 5,
      is_home: true,
      metadata: {},
    });
  });

  test('createPage defaults parentId=null and isHome=false', async () => {
    await pages.createPage(42, { title: 'New' });
    const [, init] = lastCall();
    const body = JSON.parse(init.body);
    expect(body.parent_id).toBeNull();
    expect(body.is_home).toBe(false);
    expect(body.content).toBe('');
    expect(body.metadata).toEqual({});
  });

  test('updatePage → PATCH with title and content only', async () => {
    await pages.updatePage(42, 7, { title: 'Edited', content: 'rewritten' });
    const [url, init] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages/7');
    expect(init.method).toBe('PATCH');
    expect(init.headers['Content-Type']).toBe('application/merge-patch+json');
    expect(JSON.parse(init.body)).toEqual({
      title: 'Edited',
      content: 'rewritten',
    });
  });

  test('updatePage forwards the optional content-hash precondition', async () => {
    await pages.updatePage(42, 7, {
      title: 'Edited',
      content: 'rewritten',
      expectedContentHash: 'hash-before-edit',
    });
    const [, init] = lastCall();
    expect(JSON.parse(init.body)).toEqual({
      title: 'Edited',
      content: 'rewritten',
      expected_content_hash: 'hash-before-edit',
    });
  });

  test('archivePage → DELETE /api/v2/workspaces/:id/pages/:pageId', async () => {
    respond(null, 204);
    expect(await pages.archivePage(42, 7)).toBeUndefined();
    const [url, init] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages/7');
    expect(init.method).toBe('DELETE');
  });

  test('movePage → POST /api/v2/workspaces/:id/pages/:pageId/move with parent_id', async () => {
    await pages.movePage(42, 7, 11);
    const [url, init] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages/7/move');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      parent_id: 11,
      prev_sibling_id: null,
      next_sibling_id: null,
    });
  });

  test('movePage to root passes parent_id: null', async () => {
    await pages.movePage(42, 7, null);
    const [, init] = lastCall();
    expect(JSON.parse(init.body)).toEqual({
      parent_id: null,
      prev_sibling_id: null,
      next_sibling_id: null,
    });
  });

  test('movePage forwards prev/next sibling positioning for reorder', async () => {
    await pages.movePage(42, 7, 11, { prevSiblingId: 3, nextSiblingId: 5 });
    const [, init] = lastCall();
    expect(JSON.parse(init.body)).toEqual({
      parent_id: 11,
      prev_sibling_id: 3,
      next_sibling_id: 5,
    });
  });

  test('movePage forwards a destination workspace for cross-workspace moves', async () => {
    await pages.movePage(42, 7, null, { destinationWorkspaceId: 99 });
    const [, init] = lastCall();
    expect(JSON.parse(init.body)).toEqual({
      destination_workspace_id: 99,
      parent_id: null,
      prev_sibling_id: null,
      next_sibling_id: null,
    });
  });

  test('getHistory → GET with default v2 page/page_size query string', async () => {
    const revisions = [{ id: 31, page_id: 7, revision_type: 'update' }];
    respond({
      data: revisions,
      pagination: { page: 1, page_size: 50, total_items: 1, total_pages: 1 },
    });
    expect(await pages.getHistory(42, 7)).toEqual(revisions);
    const [url] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages/7/history?page=1&page_size=50');
  });

  test('getHistory honors custom pagination', async () => {
    await pages.getHistory(42, 7, { limit: 10, offset: 20 });
    const [url] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages/7/history?page=3&page_size=10');
  });

  test('getRevision → GET /api/v2/workspaces/:id/pages/:pageId/history/:revId', async () => {
    await pages.getRevision(42, 7, 99);
    const [url] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages/7/history/99');
  });

  test('restoreRevision → POST /api/v2/workspaces/:id/pages/:pageId/history/:revId/restore', async () => {
    await pages.restoreRevision(42, 7, 99);
    const [url, init] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages/7/history/99/restore');
    expect(init.method).toBe('POST');
  });

  test('createDiagram → POST with scene, placement, and content hash', async () => {
    const scene = { elements: [], appState: {}, files: {} };
    await pages.createDiagram(42, 7, {
      name: 'Flow',
      excalidraw: scene,
      placement: 'end',
      expectedContentHash: 'hash-1',
    });
    const [url, init] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages/7/diagrams');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      name: 'Flow',
      excalidraw: scene,
      placement: 'end',
      expected_content_hash: 'hash-1',
    });
  });

  test('updateDiagram → PATCH with replacement name, scene, and content hash', async () => {
    const scene = {
      elements: [{ id: 'one', type: 'rectangle' }],
      appState: {},
      files: {},
    };
    await pages.updateDiagram(42, 7, 91, {
      name: 'Updated flow',
      excalidraw: scene,
      expectedContentHash: 'hash-2',
    });
    const [url, init] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages/7/diagrams/91');
    expect(init.method).toBe('PATCH');
    expect(init.headers['Content-Type']).toBe('application/merge-patch+json');
    expect(JSON.parse(init.body)).toEqual({
      name: 'Updated flow',
      excalidraw: scene,
      expected_content_hash: 'hash-2',
    });
  });

  test('getPermissions → GET /api/v2/workspaces/:id/pages/:pageId/permissions', async () => {
    await pages.getPermissions(42, 7);
    const [url] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages/7/permissions');
  });

  test('grantPermission → POST /api/v2/workspaces/:id/pages/:pageId/permissions with snake_cased body', async () => {
    await pages.grantPermission(42, 7, {
      principalType: 'user',
      principalId: 8,
      permissionLevel: 'edit',
    });
    const [url, init] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages/7/permissions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      principal_type: 'user',
      principal_id: 8,
      permission_level: 'edit',
    });
  });

  test('revokePermission → DELETE /api/v2/workspaces/:id/pages/:pageId/permissions/:permId', async () => {
    respond(null, 204);
    expect(await pages.revokePermission(42, 7, 99)).toBeUndefined();
    const [url, init] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages/7/permissions/99');
    expect(init.method).toBe('DELETE');
  });

  test('setInheritance → PATCH /api/v2/workspaces/:id/pages/:pageId/inheritance with inherit_permissions body', async () => {
    await pages.setInheritance(42, 7, false);
    const [url, init] = lastCall();
    expect(url).toBe('/api/v2/workspaces/42/pages/7/inheritance');
    expect(init.method).toBe('PATCH');
    expect(init.headers['Content-Type']).toBe('application/merge-patch+json');
    expect(JSON.parse(init.body)).toEqual({ inherit_permissions: false });
  });

  test('searchKnowledge → GET /api/workspaces/:id/knowledge/search with q and limit', async () => {
    const matches = { results: [{ id: 7, title: 'Onboarding' }] };
    respond(matches);
    expect(await pages.searchKnowledge(42, 'onboarding', { limit: 10 })).toEqual(matches);
    const [url] = lastCall();
    expect(url).toBe('/api/workspaces/42/knowledge/search?q=onboarding&limit=10');
  });

  test('searchKnowledge applies the default limit when none is passed', async () => {
    await pages.searchKnowledge(42, 'onboarding');
    const [url] = lastCall();
    expect(url).toBe('/api/workspaces/42/knowledge/search?q=onboarding&limit=25');
  });

  test('updatePage keeps omitted fields absent while forwarding an explicit empty value', async () => {
    await pages.updatePage(42, 7, { content: '' });
    const [, init] = lastCall();
    expect(JSON.parse(init.body)).toEqual({ content: '' });
    expect(init.headers['Content-Type']).toBe('application/merge-patch+json');
  });

  test('propagates a structured v2 conflict instead of returning data', async () => {
    respond(
      { error: { code: 'conflict', message: 'Page has changed' }, request_id: 'synthetic-request' },
      409
    );
    await expect(
      pages.updatePage(42, 7, { content: 'New', expectedContentHash: 'old' })
    ).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
      message: 'Page has changed',
      requestId: 'synthetic-request',
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
