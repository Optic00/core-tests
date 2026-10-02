import { act, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api.js', () => ({
  api: {
    items: {
      get: vi.fn(),
      update: vi.fn(),
    },
    attachments: {
      getByItem: vi.fn(),
    },
    hierarchyLevels: {
      getAll: vi.fn(),
    },
  },
}));

vi.mock('../../stores', async () => {
  const { writable } = await import('svelte/store');
  return {
    aiStore: { available: false },
    attachmentStatus: { enabled: false },
    workspacesStore: writable({ personalWorkspace: { id: 7 } }),
  };
});

vi.mock('../../stores/workspaceDataStore.svelte.js', () => ({
  workspaceDataStore: {
    initialize: vi.fn().mockResolvedValue(undefined),
    workspace: { id: 7, key: 'ME' },
    statuses: [],
    itemTypes: [],
  },
}));

vi.mock('../../stores/i18n.svelte.js', () => ({
  t: vi.fn((key) => key),
}));

vi.mock('../items/Comments.svelte', async () => ({
  default: (await import('./CommentsStub.svelte')).default,
}));

vi.mock('../items/ItemDetailBreadcrumbs.svelte', () => ({
  default: function MockItemDetailBreadcrumbs() {},
}));

vi.mock('../../editors/LazyMilkdownEditor.svelte', async () => ({
  default: (await import('./PersonalTaskEditorStub.svelte')).default,
}));

vi.mock('../assets/AttachmentDiagramList.svelte', async () => ({
  default: (await import('./AttachmentListStub.svelte')).default,
}));

vi.mock('runed', () => ({
  onClickOutside: vi.fn(),
  useEventListener: vi.fn(),
}));

import { api } from '../../api.js';
import PersonalTaskDetail from './PersonalTaskDetail.svelte';

describe('PersonalTaskDetail description editing', () => {
  beforeEach(() => {
    api.items.get.mockResolvedValue({
      id: 42,
      title: 'Pack rucksack for England',
      description: '',
      status_id: 1,
      workspace_item_number: 12,
    });
    api.hierarchyLevels.getAll.mockResolvedValue([]);
  });

  it('opens the description editor when the empty description is clicked', async () => {
    render(PersonalTaskDetail, {
      props: {
        itemId: 42,
        workspaceId: 7,
        statuses: [{ id: 1, name: 'Open', category_name: 'To Do' }],
        isModal: false,
      },
    });

    const emptyDescription = await screen.findByTestId('item-description-empty');
    await fireEvent.click(emptyDescription);

    await waitFor(() => {
      expect(screen.getByTestId('item-description-editor')).toBeInTheDocument();
    });
  });
});

describe('PersonalTaskDetail item navigation (WI-1378/WI-1389)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { workspaceDataStore } = await import('../../stores/workspaceDataStore.svelte.js');
    workspaceDataStore.initialize.mockClear();
    api.items.get.mockImplementation(async (id) => ({
      id,
      title: `Task ${id}`,
      description: '',
      status_id: 1,
      workspace_item_number: id,
    }));
    api.hierarchyLevels.getAll.mockResolvedValue([]);
  });

  it('reloads when the route navigates to a different personal task', async () => {
    const { rerender } = render(PersonalTaskDetail, {
      props: {
        itemId: 42,
        workspaceId: 7,
        isModal: false,
      },
    });

    expect(await screen.findByText('Task 42')).toBeInTheDocument();
    expect(api.items.get).toHaveBeenLastCalledWith(42);

    // Navigate /personal/items/42 -> /personal/items/43: the component is
    // reused, so it must reload rather than keep the previous task.
    await rerender({ props: { itemId: 43, workspaceId: 7, isModal: false } });

    expect(await screen.findByText('Task 43')).toBeInTheDocument();
    expect(api.items.get).toHaveBeenLastCalledWith(43);
    expect(screen.queryByText('Task 42')).not.toBeInTheDocument();
  });

  it('saves against the currently displayed task after navigation', async () => {
    api.items.update.mockResolvedValue({});
    const { rerender } = render(PersonalTaskDetail, {
      props: {
        itemId: 42,
        workspaceId: 7,
        isModal: false,
      },
    });
    await screen.findByText('Task 42');

    await rerender({ props: { itemId: 43, workspaceId: 7, isModal: false } });
    await screen.findByText('Task 43');

    await fireEvent.click(screen.getByText('Task 43'));
    const input = screen.getByRole('textbox');
    await fireEvent.input(input, { target: { value: 'Renamed after nav' } });
    await fireEvent.blur(input);

    await waitFor(() => {
      expect(api.items.update).toHaveBeenCalledWith(43, {
        title: 'Renamed after nav',
      });
    });
  });

  it('resolves the workspace store once the personal workspace id arrives (WI-1389)', async () => {
    const { workspaceDataStore } = await import('../../stores/workspaceDataStore.svelte.js');
    const { initialize } = workspaceDataStore;
    const { rerender } = render(PersonalTaskDetail, {
      props: {
        itemId: 42,
        workspaceId: null,
        isModal: false,
      },
    });
    await screen.findByText('Task 42');

    // initialize must not be called with the null deep-link value.
    expect(initialize).not.toHaveBeenCalled();

    // The workspaces store resolves after the deep link renders.
    await rerender({ props: { itemId: 42, workspaceId: 7, isModal: false } });

    await waitFor(() => {
      expect(initialize).toHaveBeenCalledWith(7);
    });
  });
});

describe('PersonalTaskDetail attachments across navigation (WI-1418)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { attachmentStatus } = await import('../../stores');
    attachmentStatus.enabled = true;
    api.items.get.mockImplementation(async (id) => ({
      id,
      title: `Task ${id}`,
      description: '',
      status_id: 1,
      workspace_item_number: id,
    }));
    api.hierarchyLevels.getAll.mockResolvedValue([]);
    api.attachments.getByItem.mockImplementation(async (id) => ({
      data: [{ id: 1000 + id, original_filename: `file-${id}.pdf`, file_size: 3 }],
    }));
  });

  afterEach(async () => {
    const { attachmentStatus } = await import('../../stores');
    attachmentStatus.enabled = false;
  });

  it('reloads attachments when the route navigates to a different task', async () => {
    const { rerender } = render(PersonalTaskDetail, {
      props: { itemId: 42, workspaceId: 7, isModal: false },
    });
    expect(await screen.findByTestId('stub-attachment')).toHaveTextContent('file-42.pdf');

    await rerender({ props: { itemId: 43, workspaceId: 7, isModal: false } });

    expect(await screen.findByTestId('stub-attachment')).toHaveTextContent('file-43.pdf');
    expect(api.attachments.getByItem).toHaveBeenCalledWith(43);
    expect(screen.queryByText('file-42.pdf')).not.toBeInTheDocument();
  });

  it('discards a stale attachment response that resolves after navigation', async () => {
    let resolveStale;
    api.attachments.getByItem.mockImplementation((id) => {
      if (id === 42) {
        return new Promise((resolve) => {
          resolveStale = resolve;
        });
      }
      return Promise.resolve({
        data: [{ id: 1000 + id, original_filename: `file-${id}.pdf`, file_size: 3 }],
      });
    });

    const { rerender } = render(PersonalTaskDetail, {
      props: { itemId: 42, workspaceId: 7, isModal: false },
    });
    await rerender({ props: { itemId: 43, workspaceId: 7, isModal: false } });
    expect(await screen.findByTestId('stub-attachment')).toHaveTextContent('file-43.pdf');

    // Task 42's slow response lands after the user moved on to task 43;
    // it must not replace task 43's attachment list.
    await act(async () => {
      resolveStale({ data: [{ id: 1042, original_filename: 'file-42.pdf', file_size: 3 }] });
    });

    expect(screen.getByTestId('stub-attachment')).toHaveTextContent('file-43.pdf');
    expect(screen.queryByText('file-42.pdf')).not.toBeInTheDocument();
  });

  // The comment section remounts with the loading flip on every navigation;
  // this pins the visible contract that it always describes the displayed
  // task, including the count emitted on load.
  it('reloads the comment section and badge for the newly displayed task', async () => {
    const { rerender } = render(PersonalTaskDetail, {
      props: { itemId: 42, workspaceId: 7, isModal: false },
    });
    expect(await screen.findByTestId('stub-comments')).toHaveTextContent('comments-42');

    await rerender({ props: { itemId: 43, workspaceId: 7, isModal: false } });

    expect(await screen.findByTestId('stub-comments')).toHaveTextContent('comments-43');
    expect(screen.queryByText('comments-42')).not.toBeInTheDocument();
  });
});
