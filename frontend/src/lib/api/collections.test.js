import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collections } from './collections.js';

describe('collections v2 API', () => {
  let fetchSpy;
  const bootstrap = { board_configuration: { id: 9 }, statuses: [], referenced_workspace_ids: [4] };

  beforeEach(() => {
    fetchSpy = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: bootstrap }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('requests the Board Configuration bootstrap with workspace fallback context', async () => {
    expect(await collections.getBoardConfigurationBootstrap(9, 4)).toEqual(bootstrap);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe(
      '/api/v2/collections/9/board-configuration/bootstrap?workspace_id=4'
    );
    expect(fetchSpy.mock.calls[0][1].credentials).toBe('same-origin');
  });

  it('requests the default Board Configuration through the workspace scope path', async () => {
    expect(await collections.getBoardConfigurationBootstrap(null, 4)).toEqual(bootstrap);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v2/workspaces/4/board-configuration/bootstrap');
  });

  it('does not invent workspace fallback context for an explicit collection', async () => {
    expect(await collections.getBoardConfigurationBootstrap(9)).toEqual(bootstrap);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/v2/collections/9/board-configuration/bootstrap');
  });
});
