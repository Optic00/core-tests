import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getByKey, mergeInto, split, getComments } = vi.hoisted(() => ({
  getByKey: vi.fn(),
  mergeInto: vi.fn(),
  split: vi.fn(),
  getComments: vi.fn(),
}));

vi.mock('../../api.js', () => ({
  api: {
    items: { getByKey, mergeInto, split },
    getComments,
  },
}));

vi.mock('../../stores/i18n.svelte.js', () => ({
  t: (key, params) =>
    [key, ...(params && typeof params === 'object' ? Object.values(params) : [])].join(' '),
}));

import ItemMergeDialog from './ItemMergeDialog.svelte';
import ItemSplitDialog from './ItemSplitDialog.svelte';

const item = { id: 7, workspace_key: 'SUP', workspace_item_number: 42, title: 'Canonical' };

afterEach(() => {
  cleanup();
  getByKey.mockReset();
  mergeInto.mockReset();
  split.mockReset();
  getComments.mockReset();
});

describe('ItemMergeDialog', () => {
  it('resolves a KEY-123 reference and merges it into the open ticket', async () => {
    getByKey.mockResolvedValue({ id: 99 });
    mergeInto.mockResolvedValue({
      sources: [{ source_item_id: 99, target_item_id: 7, merged: true, moved_comments: 1 }],
    });

    let merged = null;
    const onMerged = (result) => { merged = result; };

    render(ItemMergeDialog, { props: { isOpen: true, item, onMerged } });

    const input = screen.getByTestId('item-merge-duplicate-input');
    await fireEvent.input(input, { target: { value: 'SUP-99' } });
    await fireEvent.click(screen.getByTestId('item-merge-confirm'));

    await waitFor(() => expect(getByKey).toHaveBeenCalledWith('SUP', 99));
    await waitFor(() => expect(mergeInto).toHaveBeenCalledWith(7, [99]));
    await waitFor(() => expect(merged).not.toBeNull());
    expect(merged.sources[0].moved_comments).toBe(1);
  });

  it('surfaces failures instead of closing', async () => {
    mergeInto.mockRejectedValue(new Error('merge conflict'));

    render(ItemMergeDialog, { props: { isOpen: true, item, onMerged: () => {} } });

    const input = screen.getByTestId('item-merge-duplicate-input');
    await fireEvent.input(input, { target: { value: '88' } });
    await fireEvent.click(screen.getByTestId('item-merge-confirm'));

    await waitFor(() => expect(screen.getByTestId('item-merge-error')).toBeInTheDocument());
    expect(screen.getByTestId('item-merge-error')).toHaveTextContent('merge conflict');
  });
});

describe('ItemSplitDialog', () => {
  it('creates the subticket with exactly the selected comments', async () => {
    getComments.mockResolvedValue({
      comments: [
        { id: 1, content: 'first comment' },
        { id: 2, content: 'second comment' },
      ],
    });
    split.mockResolvedValue({ split_item_id: 55, moved_comments: 1 });

    let splitResult = null;
    const onSplit = (result) => { splitResult = result; };

    render(ItemSplitDialog, { props: { isOpen: true, item, onSplit } });

    await waitFor(() => expect(getComments).toHaveBeenCalledWith(7));

    await fireEvent.input(screen.getByTestId('item-split-title-input'), {
      target: { value: 'Follow-up' },
    });
    await fireEvent.click(screen.getByTestId('item-split-comment-2'));
    await fireEvent.click(screen.getByTestId('item-split-confirm'));

    await waitFor(() => expect(split).toHaveBeenCalledWith(7, {
      title: 'Follow-up',
      comment_ids: [2],
    }));
    await waitFor(() => expect(splitResult?.split_item_id).toBe(55));
  });

  it('requires a selection before confirming', async () => {
    getComments.mockResolvedValue({ comments: [{ id: 1, content: 'only' }] });

    render(ItemSplitDialog, { props: { isOpen: true, item, onSplit: () => {} } });

    await waitFor(() => expect(screen.getByTestId('item-split-comment-1')).toBeInTheDocument());
    await fireEvent.input(screen.getByTestId('item-split-title-input'), { target: { value: 'X' } });

    const confirm = screen.getByTestId('item-split-confirm');
    expect(confirm).toBeDisabled();
    expect(split).not.toHaveBeenCalled();
  });
});
