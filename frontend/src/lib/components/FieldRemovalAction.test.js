import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FieldRemovalAction from './FieldRemovalAction.svelte';

afterEach(cleanup);

describe('FieldRemovalAction', () => {
  it('renders a lock instead of a remove button for protected fields', () => {
    const { container } = render(FieldRemovalAction, { locked: true });

    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('invokes removal for editable fields', async () => {
    const onremove = vi.fn();
    const { getByTitle } = render(FieldRemovalAction, {
      removeTitle: 'Remove field',
      onremove,
    });

    await fireEvent.click(getByTitle('Remove field'));

    expect(onremove).toHaveBeenCalledOnce();
  });
});
