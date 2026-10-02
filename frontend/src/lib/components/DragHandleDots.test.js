import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import DragHandleDots from './DragHandleDots.svelte';

afterEach(cleanup);

describe('DragHandleDots', () => {
  it('renders the shared six-dot drag affordance as decorative', () => {
    const { container } = render(DragHandleDots);

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('circle')).toHaveLength(6);
  });
});
