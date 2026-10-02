import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../stores/i18n.svelte.js', () => ({
  t: (key) =>
    ({
      'common.filter': 'Filter',
      'common.addFilter': 'Add filter',
      'common.clear': 'Clear',
      'common.apply': 'Apply',
    })[key] || key,
}));

import DynamicFilterPopoverHarness from './DynamicFilterPopoverHarness.svelte';

afterEach(cleanup);

describe('DynamicFilterPopover', () => {
  it('owns filter row creation, updates, application, and clearing', async () => {
    render(DynamicFilterPopoverHarness);

    await fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    expect(screen.getByTestId('filter-row-0')).toBeInTheDocument();

    await fireEvent.click(screen.getByTestId('set-filter-0'));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByTestId('filter-state')).toHaveAttribute(
      'data-applied',
      JSON.stringify([{ field: { id: 'title' }, operator: '=', value: 'wind', values: [] }])
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Filter 1' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByTestId('filter-state')).toHaveAttribute('data-filters', '[]');
    expect(screen.getByTestId('filter-state')).toHaveAttribute('data-applied', '');
  });
});
