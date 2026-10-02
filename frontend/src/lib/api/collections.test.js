import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./core.js', () => ({
  fetchAPI: vi.fn(),
  fetchAPIV2: vi.fn(),
  fetchV2Data: vi.fn(),
  fetchAllV2Pages: vi.fn(),
}));

vi.mock('./createCrudClient.js', () => ({
  createCrudClient: vi.fn(() => ({})),
}));

const { fetchAllV2Pages, fetchAPIV2, fetchV2Data } = await import('./core.js');
const { collections } = await import('./collections.js');

describe('collections API', () => {
  beforeEach(() => {
    fetchAPIV2.mockReset();
    fetchV2Data.mockReset();
    fetchAllV2Pages.mockReset();
  });

  it('uses canonical v2 pagination and merge patch contracts', async () => {
    await collections.list({ workspace_id: 4 }, { signal: 'signal' });
    await collections.getAll({ category_id: 3 });
    await collections.update(9, { description: 'Updated' });
    await collections.updatePublicSharing(9, { is_public: false });

    expect(fetchAPIV2).toHaveBeenCalledWith('/collections?workspace_id=4', { signal: 'signal' });
    expect(fetchAllV2Pages).toHaveBeenCalledWith('/collections?category_id=3', {});
    expect(fetchV2Data).toHaveBeenNthCalledWith(1, '/collections/9', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify({ description: 'Updated' }),
    });
    expect(fetchV2Data).toHaveBeenNthCalledWith(2, '/collections/9/sharing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify({ is_public: false }),
    });
  });

  it('requests the Board Configuration bootstrap with workspace fallback context', async () => {
    await collections.getBoardConfigurationBootstrap(9, 4);

    expect(fetchV2Data).toHaveBeenCalledOnce();
    expect(fetchV2Data).toHaveBeenCalledWith(
      '/collections/9/board-configuration/bootstrap?workspace_id=4'
    );
  });

  it('requests a default workspace Board Configuration bootstrap', async () => {
    await collections.getBoardConfigurationBootstrap(null, 4);

    expect(fetchV2Data).toHaveBeenCalledWith('/workspaces/4/board-configuration/bootstrap');
  });

  it('upserts and deletes Board Configuration through its scope', async () => {
    await collections.createBoardConfiguration(null, 4, { columns: [] });
    await collections.updateBoardConfiguration(9, 12, { columns: [] }, 4);
    await collections.deleteBoardConfiguration(null, 12, 4);

    expect(fetchV2Data).toHaveBeenNthCalledWith(1, '/workspaces/4/board-configuration', {
      method: 'PUT',
      body: JSON.stringify({ columns: [] }),
    });
    expect(fetchV2Data).toHaveBeenNthCalledWith(2, '/collections/9/board-configuration', {
      method: 'PUT',
      body: JSON.stringify({ columns: [] }),
    });
    expect(fetchV2Data).toHaveBeenNthCalledWith(3, '/workspaces/4/board-configuration', {
      method: 'DELETE',
    });
  });
});
