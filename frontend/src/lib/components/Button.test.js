import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import Button from './Button.svelte';

describe('Button pending state', () => {
  it('blocks activation while loading', async () => {
    const onclick = vi.fn();
    render(Button, {
      props: {
        dataTestid: 'pending-button',
        loading: true,
        onclick,
      },
    });

    const button = screen.getByTestId('pending-button');
    expect(button).toBeDisabled();

    await fireEvent.click(button);
    expect(onclick).not.toHaveBeenCalled();
  });
});
