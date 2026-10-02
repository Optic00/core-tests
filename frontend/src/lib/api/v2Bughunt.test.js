import { afterEach, describe, expect, it, vi } from 'vitest';
import { assets } from './assets.js';
import { iterations, milestones } from './milestones.js';

afterEach(() => vi.unstubAllGlobals());

function serve(rows) {
  const requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path) => {
      const url = new URL(path, 'https://example.invalid');
      requests.push(url);
      const data = rows[url.pathname] ?? [];
      return new Response(JSON.stringify({ data, pagination: { total_pages: 1 } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
  return requests;
}

it('sends configured asset picker queries under the canonical ql parameter', async () => {
  const requests = serve({});
  await assets.getAll(7, { cql: 'status = "Active"', search: 'Laptop' });
  expect(requests[0].searchParams.get('ql')).toBe('status = "Active"');
  expect(requests[0].searchParams.has('cql')).toBe(false);
  expect(requests[0].searchParams.get('search')).toBe('Laptop');
});

describe.each([
  ['iterations', iterations],
  ['milestones', milestones],
])('%s scope', (path, client) => {
  it('sends one unscoped request; the server merges global and accessible workspace rows', async () => {
    const requests = serve({
      [`/api/v2/${path}`]: [{ id: 1 }],
    });
    expect(await client.getAll()).toEqual([{ id: 1 }]);
    expect(requests.map((url) => url.pathname)).toEqual([`/api/v2/${path}`]);
  });

  it('narrows unscoped lists to global rows with is_global', async () => {
    const requests = serve({});
    await client.getAll({ is_global: true });
    expect(requests).toHaveLength(1);
    expect(requests[0].pathname).toBe(`/api/v2/${path}`);
    expect(requests[0].searchParams.get('is_global')).toBe('true');
  });

  it('keeps explicitly scoped reads in their workspace', async () => {
    const requests = serve({ [`/api/v2/workspaces/7/${path}`]: [{ id: 2 }] });
    expect(await client.getAll({ workspace_id: 7, include_global: false })).toEqual([{ id: 2 }]);
    expect(requests.map((url) => url.pathname)).toEqual([`/api/v2/workspaces/7/${path}`]);
  });

  it('requests workspace and global rows in one scoped call by default', async () => {
    const requests = serve({
      [`/api/v2/workspaces/7/${path}`]: [{ id: 2 }],
    });
    expect(await client.getAll({ workspace_id: 7 })).toEqual([{ id: 2 }]);
    expect(requests).toHaveLength(1);
    expect(requests[0].pathname).toBe(`/api/v2/workspaces/7/${path}`);
    expect(requests[0].searchParams.get('include_global')).toBe('true');
  });
});
