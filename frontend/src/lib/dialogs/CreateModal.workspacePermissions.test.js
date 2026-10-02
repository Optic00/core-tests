import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { afterEach, describe, expect, test, vi } from 'vitest';

const reload = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const createWorkspace = vi.hoisted(() => vi.fn());

vi.mock('../api.js', () => ({
  api: {
    workspaces: {
      create: createWorkspace,
      getTemplates: vi.fn().mockResolvedValue([]),
    },
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
  }),
  shouldNavigateAfterCreate: vi.fn(() => false),
  workItemFormStore: {
    formData: { name: '', workspace_id: null },
    init: vi.fn(),
    resetForm: vi.fn(),
    validate: vi.fn(() => false),
  },
  permissionStore: writable({ userPermissionKeys: new Set(['workspace.create']) }),
  isSystemAdmin: writable(false),
  workspacePermissions: { reload },
}));

vi.mock('../stores/i18n.svelte.js', () => ({
  t: (key) => key,
}));

vi.mock('../stores/toasts.svelte.js', () => ({
  errorToast: vi.fn(),
}));

vi.mock('../utils/createdItemToast.js', () => ({
  showCreatedItemToast: vi.fn(),
}));

import CreateModal from './CreateModal.svelte';

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('CreateModal workspace creation', () => {
  test('refreshes workspace permissions after creating a workspace', async () => {
    createWorkspace.mockResolvedValue({ id: 3, name: 'Platform', key: 'PLAT' });

    render(CreateModal, {
      props: { isOpen: true, initialType: 'workspace', skipNavigate: true },
    });

    fireEvent.input(document.querySelector('#workspace-name'), {
      target: { value: 'Platform' },
    });
    fireEvent.input(document.querySelector('#workspace-key'), {
      target: { value: 'PLAT' },
    });

    fireEvent.click(document.querySelector('#create-modal-submit'));

    await waitFor(() => {
      expect(createWorkspace).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
