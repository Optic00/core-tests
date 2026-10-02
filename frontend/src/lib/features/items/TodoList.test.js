import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api.js', () => ({
  api: {
    items: {
      create: vi.fn(),
      getAll: vi.fn(),
      transition: vi.fn(),
    },
    statusCategories: { getAll: vi.fn() },
    workspaces: { getStatuses: vi.fn() },
  },
}));

vi.mock('../../stores', () => ({
  authStore: { currentUser: { id: 7 } },
}));

vi.mock('../../stores/toasts.svelte.js', () => ({ errorToast: vi.fn() }));

vi.mock('@lucide/svelte', () => ({
  Check: vi.fn(() => null),
  ChevronDown: vi.fn(() => null),
  ChevronRight: vi.fn(() => null),
  Plus: vi.fn(() => null),
  Trash2: vi.fn(() => null),
  X: vi.fn(() => null),
}));

vi.mock('./WorkItemRow.svelte', () => ({ default: function MockComponent() {} }));
vi.mock('../../dialogs/DeleteItemDialog.svelte', () => ({ default: function MockComponent() {} }));
vi.mock('./ItemDetail.svelte', () => ({ default: function MockComponent() {} }));
vi.mock('../personal/PersonalTaskDetail.svelte', () => ({ default: function MockComponent() {} }));
vi.mock('../../components/Checkbox.svelte', () => ({ default: function MockComponent() {} }));
vi.mock('../../components/EmptyState.svelte', () => ({ default: function MockComponent() {} }));

const { api } = await import('../../api.js');
const { i18n } = await import('../../stores/i18n.svelte.js');
const { default: TodoList } = await import('./TodoList.svelte');

describe('TodoList completed-task history filter', () => {
  beforeAll(async () => {
    await i18n.setLocale('en');
  });

  afterAll(() => cleanup());

  beforeEach(() => {
    localStorage.clear();
    api.items.getAll.mockResolvedValue({ items: [] });
    api.statusCategories.getAll.mockResolvedValue([]);
    api.workspaces.getStatuses.mockResolvedValue([]);
  });

  it('explains that the range only limits completed task history', async () => {
    render(TodoList, { props: { workspaceId: 42 } });

    // The header label also appears on the phone's collapsed toggle; scope
    // the bar's copy to the filter container.
    const filter = await screen.findByTestId('todo-done-filter');
    expect(within(filter).getByText('Completed task history')).toBeInTheDocument();
    expect(within(filter).getByText('Open tasks are always shown.')).toBeInTheDocument();
    expect(within(filter).getByText('Last 7 days')).toBeInTheDocument();
    expect(within(filter).getByText('Last 30 days')).toBeInTheDocument();
    expect(within(filter).getByText('Last 90 days')).toBeInTheDocument();
    expect(within(filter).getByLabelText('Show tasks completed since date')).toBeInTheDocument();
    expect(within(filter).getByTestId('done-range-none')).toBeInTheDocument();
    // The phone surface reaches the same controls through the toggle.
    expect(screen.getByTestId('todo-filter-toggle')).toBeInTheDocument();
  });

  it('hides completed history immediately when None is selected and persists the choice', async () => {
    render(TodoList, { props: { workspaceId: 42 } });
    await screen.findByTestId('todo-done-filter');

    api.items.getAll.mockClear();
    await fireEvent.click(screen.getByTestId('done-range-none'));

    // completed_since must exclude every completed item while leaving the
    // open-task side of the query untouched, so it has to be in the future.
    const requestedAt = Date.now();
    expect(api.items.getAll).toHaveBeenCalled();
    for (const call of api.items.getAll.mock.calls) {
      expect(call[0].completed_since).toBeTruthy();
      expect(new Date(call[0].completed_since).getTime()).toBeGreaterThan(requestedAt);
    }

    expect(JSON.parse(localStorage.getItem('todo-done-range-42'))).toEqual({
      range: 'none',
      customDate: '',
    });
  });

  it('restores the None selection from localStorage on remount', async () => {
    localStorage.setItem('todo-done-range-42', JSON.stringify({ range: 'none', customDate: '' }));

    render(TodoList, { props: { workspaceId: 42 } });
    await screen.findByTestId('todo-done-filter');

    expect(api.items.getAll).toHaveBeenCalledTimes(2); // personal + assigned loads
    for (const call of api.items.getAll.mock.calls) {
      expect(new Date(call[0].completed_since).getTime()).toBeGreaterThan(Date.now());
    }
  });
});
