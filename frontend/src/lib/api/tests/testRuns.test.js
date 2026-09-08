import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testRuns } from './testRuns.js';

describe('test runs v2 API', () => {
  let fetchSpy;
  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  function respond(data) {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  }

  it('loads and unwraps the complete run graph through one v2 detail request', async () => {
    const graph = {
      run: { id: 9 },
      test_cases: [{ id: 12 }],
      results: [{ id: 13 }],
      step_results: [{ id: 17 }],
    };
    respond(graph);
    expect(await testRuns.getDetail(3, 9)).toEqual(graph);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v2/workspaces/3/test-runs/9/detail');
    expect(fetchSpy.mock.calls[0][1].credentials).toBe('same-origin');
  });

  it.each([
    [
      'result',
      (body) => testRuns.updateResult(3, 9, 13, body),
      'results/13',
      { id: 13, status: 'passed', notes: '' },
    ],
    ['step', (body) => testRuns.updateStepResult(3, 9, 17, body), 'steps/17', { updated: true }],
  ])(
    'updates one %s with merge-patch without losing explicit empty fields',
    async (_name, call, suffix, result) => {
      const body = { status: 'passed', notes: '' };
      respond(result);
      expect(await call(body)).toEqual(result);
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(`/api/v2/workspaces/3/test-runs/9/${suffix}`);
      expect(init.method).toBe('PATCH');
      expect(init.headers['Content-Type']).toBe('application/merge-patch+json');
      expect(JSON.parse(init.body)).toEqual(body);
    }
  );
});
