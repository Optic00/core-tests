import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../../stores/collectionContext.svelte.js', () => ({
  collectionStore: { subFilterRows: [], subFilterQL: '', showCompleted: false },
}));
vi.mock('../../stores/i18n.svelte.js', () => ({ t: (key) => key }));

const { default: SubFilterBar } = await import('./SubFilterBar.svelte');
afterEach(cleanup);

it('omits the completion toggle when the board owns completion visibility', () => {
  render(SubFilterBar, { props: { showCompletionToggle: false } });
  expect(screen.queryByTestId('collection-hide-completed')).toBeNull();
});

it('shows a compact, context-aware completion toggle for other collection views', () => {
  render(SubFilterBar);
  const toggle = screen.getByTestId('collection-hide-completed');

  expect(toggle).toHaveClass('h-5', 'w-9');
  expect(screen.getByText('milestones.hideCompleted')).toHaveStyle(
    'color: var(--ctx-text, var(--ds-text));'
  );
});
