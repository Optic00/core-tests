import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import ProgressSummary from './ProgressSummary.svelte';

afterEach(cleanup);

describe('ProgressSummary', () => {
  it('renders the shared progress, totals, and status breakdown contract', () => {
    render(ProgressSummary, {
      progress: {
        total_items: 8,
        completed_items: 4,
        percent_complete: 50,
        status_breakdown: [{ category_name: 'Done', category_color: '#22c55e', item_count: 4 }],
      },
      ariaLabel: 'Iteration progress',
      completeLabel: 'Complete',
      noItemsLabel: 'No items',
      summaryLabel: 'Summary',
      totalLabel: 'Total',
      completedLabel: 'Completed',
      remainingLabel: 'Remaining',
      statusLabel: 'By status',
      noStatusDataLabel: 'No status data',
    });

    expect(screen.getByRole('img', { name: 'Iteration progress' })).toHaveTextContent('50%');
    expect(screen.getByText('Total').parentElement).toHaveTextContent('8');
    expect(screen.getByText('Completed').parentElement).toHaveTextContent('4');
    expect(screen.getByText('Remaining').parentElement).toHaveTextContent('4');
    expect(screen.getByText('Done').parentElement?.parentElement).toHaveTextContent('4');
  });
});
