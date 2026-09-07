import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { iterations, milestones } from './milestones.js';

describe('planning v2 API transport', () => {
  let fetchSpy;

  function json(data, pagination, status = 200) {
    return new Response(JSON.stringify({ data, ...(pagination ? { pagination } : {}) }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  function expectRequest(index, url, method, body) {
    const [actualURL, init] = fetchSpy.mock.calls[index];
    expect(actualURL).toBe(url);
    expect(init.method).toBe(method);
    expect(init.credentials).toBe('same-origin');
    expect(init.headers['Content-Type']).toBe(
      method === 'PATCH' ? 'application/merge-patch+json' : 'application/json'
    );
    expect(JSON.parse(init.body)).toEqual(body);
    return init;
  }

  it('requests test statistics for unique milestone IDs in one v2 POST and maps entries', async () => {
    const first = { total_test_cases: 3 },
      second = { total_test_cases: 4 };
    fetchSpy.mockResolvedValueOnce(
      json([
        { milestone_id: 3, statistics: first },
        { milestone_id: 4, statistics: second },
      ])
    );
    expect(await milestones.getTestStatisticsMany([3, 4, 3])).toEqual({ 3: first, 4: second });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expectRequest(0, '/api/v2/milestones/test-statistics', 'POST', { ids: [3, 4] });
  });

  it('sends the release idempotency key and returns the unwrapped milestone', async () => {
    const released = { id: 9, status: 'completed' };
    fetchSpy.mockResolvedValueOnce(json(released));
    expect(await milestones.release(9, { tag_name: 'v0.8.4' }, 'release-request-1')).toEqual(
      released
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
    const init = expectRequest(0, '/api/v2/milestones/9/release', 'POST', { tag_name: 'v0.8.4' });
    expect(init.headers['Idempotency-Key']).toBe('release-request-1');
  });

  it.each([
    ['iterations', iterations],
    ['milestones', milestones],
  ])(
    '%s fetches every local page and combines the global list without forwarding legacy scope filters',
    async (resource, api) => {
      const localFirst = Array.from({ length: 100 }, (_, index) => ({ id: index + 100 }));
      const localLast = [{ id: 200 }],
        global = [{ id: 301 }];
      const signal = new AbortController().signal;
      const status = resource === 'iterations' ? 'active' : 'in-progress';
      fetchSpy.mockImplementation(async (url) => {
        const request = new URL(url, 'https://windshift.invalid');
        const local = request.pathname === `/api/v2/workspaces/42/${resource}`;
        expect([`/api/v2/workspaces/42/${resource}`, `/api/v2/${resource}`]).toContain(
          request.pathname
        );
        expect(request.searchParams.get('status')).toBe(status);
        expect(request.searchParams.get('page_size')).toBe('100');
        expect(request.searchParams.has('workspace_id')).toBe(false);
        expect(request.searchParams.has('include_global')).toBe(false);
        expect(request.searchParams.has('is_global')).toBe(false);
        const page = Number(request.searchParams.get('page'));
        expect(local ? [1, 2] : [1]).toContain(page);
        return json(local ? (page === 1 ? localFirst : localLast) : global, {
          page,
          page_size: 100,
          total_items: local ? 101 : 1,
          total_pages: local ? 2 : 1,
        });
      });
      expect(
        await api.getAll(
          { workspace_id: 42, include_global: true, is_global: false, status },
          { signal }
        )
      ).toEqual([...localFirst, ...localLast, ...global]);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      for (const [, init] of fetchSpy.mock.calls) {
        expect(init.signal).toBe(signal);
        expect(init.credentials).toBe('same-origin');
      }
    }
  );

  it.each([
    ['iterations', iterations],
    ['milestones', milestones],
  ])('%s respects explicit local-only list scope', async (resource, api) => {
    fetchSpy.mockResolvedValueOnce(
      json([{ id: 8 }], { page: 1, page_size: 100, total_items: 1, total_pages: 1 })
    );
    expect(await api.getAll({ workspace_id: 42, include_global: false })).toEqual([{ id: 8 }]);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe(
      `/api/v2/workspaces/42/${resource}?page_size=100&page=1`
    );
  });

  it.each([
    ['iterations', iterations],
    ['milestones', milestones],
  ])(
    '%s selects create scope through the path and strips scope fields from JSON',
    async (resource, api) => {
      fetchSpy
        .mockResolvedValueOnce(json({ id: 9 }, undefined, 201))
        .mockResolvedValueOnce(json({ id: 10 }, undefined, 201));
      const fields =
        resource === 'iterations'
          ? { start_date: '2026-07-01', end_date: '2026-07-14', status: 'planned' }
          : { target_date: '2026-07-14', status: 'planning' };
      expect(
        await api.create({ name: 'Global', ...fields, is_global: true, workspace_id: 99 })
      ).toEqual({
        id: 9,
      });
      expect(
        await api.create({ name: 'Local', ...fields, is_global: false, workspace_id: 42 })
      ).toEqual({
        id: 10,
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expectRequest(0, `/api/v2/${resource}`, 'POST', { name: 'Global', ...fields });
      expectRequest(1, `/api/v2/workspaces/42/${resource}`, 'POST', { name: 'Local', ...fields });
    }
  );

  it.each([
    ['iterations', iterations, 'type_id'],
    ['milestones', milestones, 'category_id'],
  ])(
    '%s sends only mutable merge-patch fields, preserving empty and null values',
    async (resource, api, nullableField) => {
      fetchSpy.mockResolvedValueOnce(
        json({ id: 8, name: 'Renamed', description: '', [nullableField]: null })
      );
      expect(
        await api.update(8, {
          name: 'Renamed',
          description: '',
          [nullableField]: null,
          is_global: false,
          workspace_id: 42,
          created_at: 'ignored',
        })
      ).toEqual({ id: 8, name: 'Renamed', description: '', [nullableField]: null });
      expect(fetchSpy).toHaveBeenCalledOnce();
      expectRequest(0, `/api/v2/${resource}/8`, 'PATCH', {
        name: 'Renamed',
        description: '',
        [nullableField]: null,
      });
    }
  );

  it('posts deduplicated iteration progress IDs and maps the response by identity', async () => {
    const progress = { iteration_id: 8, total_items: 2 };
    fetchSpy.mockResolvedValueOnce(json([{ iteration_id: 8, progress }]));
    expect(await iterations.getProgressMany([8, 8])).toEqual({ 8: progress });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expectRequest(0, '/api/v2/iterations/progress', 'POST', { ids: [8] });
  });
});
