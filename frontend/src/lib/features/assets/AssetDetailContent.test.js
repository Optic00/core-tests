import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import AssetDetailContent from './AssetDetailContent.svelte';

afterEach(cleanup);

describe('AssetDetailContent', () => {
  it('renders the asset metadata shared by full-page and sidebar details', () => {
    render(AssetDetailContent, {
      asset: {
        description: 'Primary database host',
        asset_type_name: 'Server',
        asset_type_color: '#3b82f6',
        category_name: 'Infrastructure',
        status_name: 'Active',
        status_color: '#22c55e',
        asset_tag: 'SRV-12',
        creator_name: 'Ada Lovelace',
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-03T00:00:00Z',
        linked_item_count: 3,
      },
    });

    expect(screen.getByText('Primary database host')).toBeInTheDocument();
    expect(screen.getByText('Server')).toBeInTheDocument();
    expect(screen.getByText('Infrastructure')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('SRV-12')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
