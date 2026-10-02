import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../stores/i18n.svelte.js', () => ({
  t: (key) => ({ 'common.loading': 'Loading...' })[key] ?? key,
}));

import LazyRootDialog from './LazyRootDialog.svelte';
import Spinner from './Spinner.svelte';
import DialogContent from './test-fixtures/LazyRootDialogContent.svelte';

describe('LazyRootDialog', () => {
  it('uses the shared themed modal loading state while its chunk is pending', () => {
    const loader = vi.fn(() => new Promise(() => {}));

    render(LazyRootDialog, { loader, label: 'sign in' });

    const loadingState = screen.getByTestId('root-dialog-loading');
    expect(loadingState).toHaveTextContent('Loading...');
    expect(loadingState).toHaveAttribute('data-root-label', 'sign in');
    expect(loadingState.getAttribute('style')).toContain(
      'background-color: var(--ds-surface-raised)'
    );
    expect(loadingState.getAttribute('style')).toContain('color: var(--ds-text)');
    expect(loadingState.querySelector('[aria-label="Loading..."]').getAttribute('style')).toContain(
      'border-color: var(--ds-interactive)'
    );
    expect(screen.getByRole('dialog')).toHaveAttribute(
      'aria-labelledby',
      'root-dialog-loading-label'
    );
  });

  it('forwards callback props and the bindable open state', async () => {
    const onaction = vi.fn();
    const loader = vi.fn().mockResolvedValue({ default: DialogContent });

    render(LazyRootDialog, {
      loader,
      label: 'sign in',
      isOpen: true,
      componentProps: { onaction },
    });

    const content = await screen.findByTestId('lazy-dialog-content');
    expect(content).toHaveTextContent('Open');
    await fireEvent.click(content);

    expect(content).toHaveTextContent('Closed');
    expect(onaction).toHaveBeenCalledTimes(1);
  });

  it('uses the shared themed recovery action and retries a failed chunk', async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValueOnce({ default: Spinner });

    render(LazyRootDialog, { loader, label: 'sign in' });

    const errorState = await screen.findByTestId('root-dialog-error');
    expect(errorState.getAttribute('style')).toContain(
      'background-color: var(--ds-surface-raised)'
    );
    expect(errorState.getAttribute('style')).toContain('color: var(--ds-text)');

    await fireEvent.click(screen.getByTestId('root-dialog-retry'));

    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('root-dialog-error')).not.toBeInTheDocument());
  });
});
