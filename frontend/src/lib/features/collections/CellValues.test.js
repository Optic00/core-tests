import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import IterationCellEditor from './IterationCellEditor.svelte';
import IterationCellValue from './IterationCellValue.svelte';
import MilestoneCellValue from './MilestoneCellValue.svelte';
import UserCellValue from './UserCellValue.svelte';

afterEach(cleanup);

describe('collection cell values', () => {
  it('renders users, iterations, and milestone lists consistently', () => {
    const user = render(UserCellValue, {
      user: { first_name: 'Ada', last_name: 'Lovelace' },
    });
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    user.unmount();

    const iteration = render(IterationCellValue, {
      iteration: { name: 'Sprint 8', is_global: true },
    });
    expect(screen.getByText('Sprint 8')).toBeInTheDocument();
    iteration.unmount();

    render(MilestoneCellValue, {
      milestones: [
        { id: 1, name: 'Alpha', category_color: '#123456' },
        { id: 2, name: 'Beta', category_color: '#654321' },
      ],
    });
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('renders the shared iteration editor in read-only mode', () => {
    render(IterationCellEditor, {
      iteration: { name: 'Sprint 9', is_global: false },
    });

    expect(screen.getByText('Sprint 9')).toBeInTheDocument();
  });
});
