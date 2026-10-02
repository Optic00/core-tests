import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

const createWorkspace = vi.hoisted(() => vi.fn());
const listPacks = vi.hoisted(() => vi.fn());

vi.mock('../api.js', () => ({
  api: {
    workspaces: {
      create: createWorkspace,
      getTemplates: vi.fn().mockResolvedValue([]),
    },
    packs: { list: listPacks },
    items: {},
    collections: {},
    milestones: {},
    attachments: {},
  },
}));

vi.mock('../router.js', () => ({
  navigate: vi.fn(),
  currentRoute: writable({ view: 'workspaces', params: {} }),
}));

vi.mock('../stores', () => ({
  milestonesStore: { add: vi.fn() },
  workspacesStore: Object.assign(writable({ loaded: true, regularWorkspaces: [] }), {
    add: vi.fn(),
    load: vi.fn(),
    reload: vi.fn(),
  }),
  shouldNavigateAfterCreate: vi.fn(() => false),
  workItemFormStore: {
    formData: { name: '', workspace_id: null },
    init: vi.fn(),
    resetForm: vi.fn(),
    validate: vi.fn(() => false),
  },
  permissionStore: writable({ userPermissionKeys: new Set(['workspace.create']) }),
  isSystemAdmin: writable(true),
  workspacePermissions: { reload: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../stores/i18n.svelte.js', () => ({
  t: (key) => key,
}));

vi.mock('../stores/toasts.svelte.js', () => ({
  errorToast: vi.fn(),
  successToast: vi.fn(),
}));

vi.mock('../utils/createdItemToast.js', () => ({
  showCreatedItemToast: vi.fn(),
}));

import CreateModal from './CreateModal.svelte';

// jsdom does not implement scrollIntoView, which ChipPicker's listbox calls
// when highlighting an option.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('CreateModal built-in pack template', () => {
  test('selecting a built-in pack submits template_pack', async () => {
    listPacks.mockResolvedValue([
      { name: 'helpdesk', version: '1.0.0', description: 'Support', has_content: true },
    ]);
    createWorkspace.mockResolvedValue({ id: 9, name: 'Helpdesk', key: 'HD' });

    render(CreateModal, {
      props: { isOpen: true, initialType: 'workspace', skipNavigate: true },
    });

    fireEvent.input(document.querySelector('#workspace-name'), {
      target: { value: 'Helpdesk' },
    });
    fireEvent.input(document.querySelector('#workspace-key'), {
      target: { value: 'HD' },
    });

    await fireEvent.click(await screen.findByTestId('workspace-template-picker'));
    const options = await screen.findAllByTestId('workspace-template-picker-option');
    const packOption = options.find((option) => option.textContent?.includes('helpdesk'));
    expect(packOption).toBeTruthy();
    await fireEvent.click(packOption);

    fireEvent.click(document.querySelector('#create-modal-submit'));

    await waitFor(() => {
      expect(createWorkspace).toHaveBeenCalledTimes(1);
    });
    expect(createWorkspace.mock.calls[0][0]).toMatchObject({ template_pack: 'helpdesk' });
    expect(createWorkspace.mock.calls[0][0].template_workspace_id).toBeUndefined();
  });
});
