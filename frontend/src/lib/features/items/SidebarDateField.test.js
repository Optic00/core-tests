import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../stores/i18n.svelte.js', () => ({ t: (key) => key }));

import SidebarDateField from './SidebarDateField.svelte';

afterEach(cleanup);

describe('SidebarDateField', () => {
  it('displays a date and starts editing when enabled', async () => {
    const onStartEdit = vi.fn();
    render(SidebarDateField, {
      props: {
        fieldKey: 'due_date',
        label: 'Due date',
        value: '2026-09-12T00:00:00Z',
        editable: true,
        onStartEdit,
      },
    });

    const field = screen.getByTestId('sidebar-date-due-date');
    expect(field).toHaveTextContent('Due date');
    expect(field).not.toHaveTextContent('common.none');
    await fireEvent.click(field);
    expect(onStartEdit).toHaveBeenCalledOnce();
  });

  it('saves changed and cleared values', async () => {
    const onSave = vi.fn();
    render(SidebarDateField, {
      props: {
        fieldKey: 'start_date',
        label: 'Start date',
        value: '2026-09-12T00:00:00Z',
        editing: true,
        editable: true,
        onSave,
      },
    });

    const input = screen.getByTestId('sidebar-date-start-date-input');
    await fireEvent.change(input, { target: { value: '2026-09-15' } });
    await fireEvent.change(input, { target: { value: '' } });
    expect(onSave).toHaveBeenNthCalledWith(1, '2026-09-15');
    expect(onSave).toHaveBeenNthCalledWith(2, null);
  });

  it('cancels editing when clicking outside', async () => {
    const onCancel = vi.fn();
    render(SidebarDateField, {
      props: {
        fieldKey: 'end_date',
        label: 'End date',
        editing: true,
        editable: true,
        onCancel,
      },
    });

    await fireEvent.click(document.body);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not start editing when disabled', async () => {
    const onStartEdit = vi.fn();
    render(SidebarDateField, {
      props: {
        fieldKey: 'due_date',
        label: 'Due date',
        editable: false,
        onStartEdit,
      },
    });

    const field = screen.getByTestId('sidebar-date-due-date');
    expect(field).toBeDisabled();
    await fireEvent.click(field);
    expect(onStartEdit).not.toHaveBeenCalled();
  });
});
