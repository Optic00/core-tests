import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../stores/i18n.svelte.js', () => ({
  t: (key, params) => (key === 'layout.items' ? 'items' : `${params.count} shown`),
}));

import ViewHeader from './ViewHeader.svelte';

afterEach(cleanup);

describe('quiet contextual item count', () => {
  it.each([
    [300, 50, 'Workspace • 300 items · 50 shown'],
    [50, 50, 'Workspace • 50 items'],
    [0, 0, 'Workspace • 0 items'],
    [300, 0, 'Workspace • 300 items · 0 shown'],
    [null, 50, 'Workspace • 50 shown'],
  ])(
    'renders total %s with %s shown in the existing subtitle',
    (itemCount, shownCount, expected) => {
      render(ViewHeader, { workspaceName: 'Workspace', itemCount, shownCount });
      expect(screen.getByTestId('page-header-subtitle')).toHaveTextContent(expected);
    }
  );

  it('does not add a leading separator for a global collection', () => {
    render(ViewHeader, { itemCount: 300, shownCount: 50 });
    expect(screen.getByTestId('page-header-subtitle').textContent).toBe('300 items · 50 shown');
  });
});
