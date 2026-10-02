import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import EntityFormModalHarness from './EntityFormModalHarness.svelte';

afterEach(cleanup);

describe('EntityFormModal', () => {
  it('renders supplied fields and keeps the shared submit and cancel contract', async () => {
    render(EntityFormModalHarness);

    expect(screen.getByTestId('entity-name')).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId('entity-form-confirm'));
    expect(screen.getByTestId('modal-state')).toHaveAttribute('data-submitted', '1');

    await fireEvent.click(screen.getByTestId('entity-form-cancel'));
    expect(screen.getByTestId('modal-state')).toHaveAttribute('data-closed', '1');
  });
});
