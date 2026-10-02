import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api.js';
import DeleteItemDialog from './DeleteItemDialog.svelte';

vi.mock('svelte/transition', async (importOriginal) => ({
  ...(await importOriginal()),
  fade: () => ({ duration: 0 }),
}));

vi.mock('../api.js', () => ({
  api: { items: { getDeleteInfo: vi.fn(), getAll: vi.fn(), deleteCascade: vi.fn() } },
}));
vi.mock('../stores/i18n.svelte.js', () => ({ t: (key) => key }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

it('loads reparent candidates from canonical snake-case delete metadata', async () => {
  api.items.getDeleteInfo.mockResolvedValue({
    has_children: true,
    descendant_count: 1,
    parent_id: null,
    workspace_id: 7,
    hierarchy_level: 0,
  });
  api.items.getAll.mockResolvedValue({
    data: [{ id: 2, title: 'Sibling parent', workspace_id: 7 }],
  });
  render(DeleteItemDialog, { show: true, item: { id: 1, title: 'Parent' } });
  await fireEvent.click(await screen.findByTestId('item-delete-reparent'));
  expect(await screen.findByText('items.reparentLevelHint')).toBeVisible();
  expect(api.items.getAll).toHaveBeenCalledWith({ workspace_id: 7, level: 0, limit: 100 });
});

it('completes cascade deletion when the API returns no response body', async () => {
  api.items.getDeleteInfo.mockResolvedValue({ has_children: false, descendant_count: 0 });
  api.items.deleteCascade.mockResolvedValue(undefined);
  const ondeleted = vi.fn();
  render(DeleteItemDialog, { show: true, item: { id: 1, title: 'Parent' }, ondeleted });
  const confirm = await screen.findByTestId('delete-item-confirm');
  await waitFor(() => expect(confirm).toBeEnabled());
  await fireEvent.click(confirm);
  await waitFor(() => expect(ondeleted).toHaveBeenCalledWith({ mode: 'deleteAll' }));
  expect(api.items.deleteCascade).toHaveBeenCalledWith(1);
  await waitFor(() => expect(screen.queryByTestId('delete-item-dialog')).not.toBeInTheDocument());
});

it('keeps the dialog open and explains when only cascade deletion is forbidden', async () => {
  api.items.getDeleteInfo.mockResolvedValue({ has_children: false, descendant_count: 0 });
  const message = 'This item can be deleted on its own, but cascade deletion is not permitted.';
  api.items.deleteCascade.mockRejectedValue(new Error(message));
  const ondeleted = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(DeleteItemDialog, { show: true, item: { id: 1, title: 'Parent' }, ondeleted });
  const confirm = await screen.findByTestId('delete-item-confirm');
  await waitFor(() => expect(confirm).toBeEnabled());
  await fireEvent.click(confirm);
  expect(await screen.findByText(message)).toBeVisible();
  expect(screen.getByTestId('delete-item-dialog')).toBeVisible();
  expect(ondeleted).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
