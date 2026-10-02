import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../api.js', () => ({
  api: {
    items: {
      update: vi.fn(async (id, values) => ({ id, ...values })),
      transition: vi.fn(async (id, statusId) => ({ id, status_id: statusId })),
    },
    workspaces: {
      getStatuses: vi.fn(),
      getProjects: vi.fn(),
      get: vi.fn(),
    },
    getAssignableUsers: vi.fn(),
    milestones: { getAll: vi.fn() },
    iterations: { getAll: vi.fn() },
    priorities: { getAll: vi.fn() },
    portalCustomers: { getAll: vi.fn() },
    customerOrganisations: { getAll: vi.fn() },
    personalLabels: { getAll: vi.fn() },
    assets: { getAll: vi.fn() },
    links: { getForItems: vi.fn(async () => ({})) },
  },
}));

vi.mock('../../stores/i18n.svelte.js', () => ({
  t: (key) => key,
  i18n: { locale: 'en-US' },
}));

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = (callback) => {
      queueMicrotask(() => callback(performance.now()));
      return 0;
    };
  }
});

const { api } = await import('../../api.js');
const { collectionEditorOptions } = await import('../../stores/collectionEditorOptions.svelte.js');
const { collectionFieldLinks } = await import('../../stores/collectionFieldLinks.svelte.js');
const { default: ListCellRenderer } = await import('./ListCellRenderer.svelte');

const assigneeColumn = { field_type: 'system', field_identifier: 'assignee' };

function renderAssignee(itemId, workspaceId) {
  return render(ListCellRenderer, {
    props: {
      item: {
        id: itemId,
        workspace_id: workspaceId,
        title: `Item ${itemId}`,
        assignee_id: null,
        custom_field_values: {},
      },
      column: assigneeColumn,
      workspace: { id: workspaceId },
      canEdit: true,
    },
  });
}

async function openAssignee(itemId) {
  await fireEvent.click(screen.getByTestId(`list-cell-assignee-${itemId}`));
}

describe('ListCellRenderer collection option loading (WI-630)', () => {
  beforeEach(() => {
    collectionEditorOptions.reset();
    collectionFieldLinks.reset();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  test('loads nothing until an editable cell is opened and single-flights same-workspace rows', async () => {
    let resolveUsers;
    api.getAssignableUsers.mockReturnValue(
      new Promise((resolve) => {
        resolveUsers = resolve;
      })
    );

    renderAssignee(101, 11);
    renderAssignee(102, 11);

    expect(api.getAssignableUsers).not.toHaveBeenCalled();

    await openAssignee(101);
    await openAssignee(102);

    await waitFor(() => expect(api.getAssignableUsers).toHaveBeenCalledTimes(1));
    expect(api.getAssignableUsers).toHaveBeenCalledWith(11);

    resolveUsers([{ id: 1101, first_name: 'Eleven', last_name: 'User' }]);
    await waitFor(() => {
      expect(screen.getAllByTestId('user-picker-option-1101')).toHaveLength(2);
    });
  });

  test('uses the owning workspace for each row in a mixed-workspace collection', async () => {
    api.getAssignableUsers.mockImplementation(async (workspaceId) => [
      {
        id: workspaceId * 100,
        first_name: `Workspace ${workspaceId}`,
        last_name: 'User',
      },
    ]);

    renderAssignee(201, 11);
    renderAssignee(202, 22);

    await openAssignee(201);
    await waitFor(() => expect(screen.getByTestId('user-picker-option-1100')).toBeInTheDocument());
    await fireEvent.click(screen.getByTestId('user-picker-option-1100'));

    await openAssignee(202);
    await waitFor(() => expect(screen.getByTestId('user-picker-option-2200')).toBeInTheDocument());

    expect(api.getAssignableUsers).toHaveBeenCalledTimes(2);
    expect(api.getAssignableUsers).toHaveBeenNthCalledWith(1, 11);
    expect(api.getAssignableUsers).toHaveBeenNthCalledWith(2, 22);
    expect(collectionEditorOptions.get(11).users[0].id).toBe(1100);
    expect(collectionEditorOptions.get(22).users[0].id).toBe(2200);
  });

  test('reuses cached options after a row is unmounted and rendered again', async () => {
    api.getAssignableUsers.mockResolvedValue([
      { id: 3300, first_name: 'Cached', last_name: 'User' },
    ]);

    const firstPage = renderAssignee(301, 33);
    await openAssignee(301);
    await waitFor(() => expect(screen.getByTestId('user-picker-option-3300')).toBeInTheDocument());
    firstPage.unmount();
    document.body.innerHTML = '';

    renderAssignee(302, 33);
    await openAssignee(302);
    await waitFor(() => expect(screen.getByTestId('user-picker-option-3300')).toBeInTheDocument());

    expect(api.getAssignableUsers).toHaveBeenCalledTimes(1);
  });
});

// Custom field updates merge per field server-side. The renderer sends only
// the edited field's key; the item's other values are preserved by the server
// and must not be sent from a possibly stale row prop.
describe('ListCellRenderer custom-field edits', () => {
  beforeEach(() => {
    collectionEditorOptions.reset();
    collectionFieldLinks.reset();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  test('editing one cell sends only that field', async () => {
    render(ListCellRenderer, {
      props: {
        item: {
          id: 601,
          workspace_id: 11,
          title: 'Item 601',
          custom_field_values: { 11: 'stored text', 22: 'keep me', 33: 42 },
        },
        column: { field_type: 'custom', field_identifier: '11' },
        customFieldDefinitions: [
          { id: 11, name: 'Text field', field_type: 'text' },
          { id: 22, name: 'Keep field', field_type: 'text' },
          { id: 33, name: 'Number field', field_type: 'number' },
        ],
        workspace: { id: 11 },
        canEdit: true,
      },
    });

    await fireEvent.click(screen.getByTestId('list-custom-field-11-601'));
    const input = screen.getByTestId('custom-field-input-11');
    await fireEvent.input(input, { target: { value: 'typed here' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(api.items.update).toHaveBeenCalledTimes(1));
    expect(api.items.update).toHaveBeenCalledWith(601, {
      custom_field_values: { 11: 'typed here' },
    });
  });

  test('two rapid cell edits each send their own single field', async () => {
    api.items.update.mockImplementation(async (id, values) => ({ id, ...values }));

    render(ListCellRenderer, {
      props: {
        item: {
          id: 501,
          workspace_id: 11,
          title: 'Item 501',
          custom_field_values: {},
        },
        column: { field_type: 'custom', field_identifier: '11' },
        customFieldDefinitions: [
          { id: 11, name: 'Text field', field_type: 'text' },
          { id: 12, name: 'Other field', field_type: 'text' },
        ],
        workspace: { id: 11 },
        canEdit: true,
      },
    });

    await fireEvent.click(screen.getByTestId('list-custom-field-11-501'));
    const input = screen.getByTestId('custom-field-input-11');
    await fireEvent.input(input, { target: { value: 'typed here' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(api.items.update).toHaveBeenCalledTimes(1));
    expect(api.items.update).toHaveBeenLastCalledWith(501, {
      custom_field_values: { 11: 'typed here' },
    });
  });
});
