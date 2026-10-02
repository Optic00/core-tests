import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticated: true,
  addRequestAttachment: vi.fn(),
  addRequestComment: vi.fn(),
  closeProfileMenu: vi.fn(),
  getMyApprovals: vi.fn(),
  getMyRequests: vi.fn(),
  getRequestAttachments: vi.fn(),
  getRequestComments: vi.fn(),
  listDrafts: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('../api.js', () => ({
  api: {
    portal: {
      addRequestAttachment: mocks.addRequestAttachment,
      addRequestComment: mocks.addRequestComment,
      getMyApprovals: mocks.getMyApprovals,
      getMyRequests: mocks.getMyRequests,
      getRequestAttachments: mocks.getRequestAttachments,
      getRequestComments: mocks.getRequestComments,
      requestAttachmentUrl: (slug, itemId, attachmentId) =>
        `/api/portal/${slug}/requests/${itemId}/attachments/${attachmentId}/download`,
      drafts: { list: mocks.listDrafts },
    },
  },
}));

vi.mock('../router.js', () => ({ navigate: mocks.navigate }));

vi.mock('../stores', () => ({
  authStore: {
    get isAuthenticated() {
      return mocks.authenticated;
    },
  },
}));

vi.mock('./portalAuth.svelte.js', () => ({
  portalAuthStore: { isAuthenticated: false },
}));

vi.mock('./toasts.svelte.js', () => ({ errorToast: vi.fn() }));

import {
  configurePortalActivityStore,
  portalActivityStore,
  portalApprovalsStore,
  portalDraftsStore,
  portalRequestsStore,
} from './portalActivity.svelte.js';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticated = true;
  portalActivityStore.reset();
  configurePortalActivityStore({
    closeProfileMenu: mocks.closeProfileMenu,
    getSlug: () => 'support',
  });
});

describe('portal activity stores', () => {
  it('keeps request, draft, and approval views mutually exclusive', () => {
    portalRequestsStore.setVisible(true);
    expect(portalRequestsStore.visible).toBe(true);

    portalDraftsStore.setVisible(true);
    expect(portalRequestsStore.visible).toBe(false);
    expect(portalDraftsStore.visible).toBe(true);

    portalApprovalsStore.setVisible(true);
    expect(portalDraftsStore.visible).toBe(false);
    expect(portalApprovalsStore.visible).toBe(true);
  });

  it('hydrates activity counts from bootstrap data', () => {
    portalActivityStore.hydrate({
      authenticated: true,
      my_requests: [{ id: 1, status_is_completed: false }, { id: 2, status_is_completed: true }],
      my_approvals: [{ id: 3, status: 'pending' }, { id: 4, status: 'approved' }],
    });

    expect(portalRequestsStore.openCount).toBe(1);
    expect(portalApprovalsStore.pendingCount).toBe(1);
  });

  it('discards a delayed request response after reset', async () => {
    const requestLoad = deferred();
    mocks.getMyRequests.mockReturnValue(requestLoad.promise);
    const pendingLoad = portalRequestsStore.load();

    portalActivityStore.reset();
    requestLoad.resolve([{ id: 1, status_is_completed: false }]);
    await pendingLoad;

    expect(portalRequestsStore.requests).toEqual([]);
    expect(portalRequestsStore.loading).toBe(false);
  });

  it('loads each activity domain through its focused store', async () => {
    mocks.getMyRequests.mockResolvedValue([{ id: 1 }]);
    mocks.listDrafts.mockResolvedValue([{ id: 2 }]);
    mocks.getMyApprovals.mockResolvedValue([{ id: 3, status: 'pending' }]);

    await Promise.all([
      portalRequestsStore.load(),
      portalDraftsStore.load(),
      portalApprovalsStore.load(),
    ]);

    expect(mocks.getMyRequests).toHaveBeenCalledWith('support');
    expect(mocks.listDrafts).toHaveBeenCalledWith('support');
    expect(mocks.getMyApprovals).toHaveBeenCalledWith('support');
    expect(portalRequestsStore.requests).toEqual([{ id: 1 }]);
    expect(portalDraftsStore.drafts).toEqual([{ id: 2 }]);
    expect(portalApprovalsStore.approvals).toEqual([{ id: 3, status: 'pending' }]);
  });

  it('loads attachments alongside comments when viewing a request', async () => {
    mocks.getRequestComments.mockResolvedValue([]);
    mocks.getRequestAttachments.mockResolvedValue([
      { id: 7, original_filename: 'log.txt', file_size: 12 },
    ]);

    await portalRequestsStore.view({ id: 41 });

    expect(mocks.getRequestAttachments).toHaveBeenCalledWith('support', 41);
    expect(portalRequestsStore.attachments).toEqual([
      { id: 7, original_filename: 'log.txt', file_size: 12 },
    ]);
    expect(portalRequestsStore.attachmentUrl(7)).toBe(
      '/api/portal/support/requests/41/attachments/7/download'
    );
  });

  it('keeps the timeline usable when loading attachments fails', async () => {
    mocks.getRequestComments.mockResolvedValue([]);
    mocks.getRequestAttachments.mockRejectedValue(new Error('offline'));

    await portalRequestsStore.view({ id: 42 });

    expect(portalRequestsStore.attachments).toEqual([]);
  });

  it('uploads an attachment onto the selected request and appends it', async () => {
    mocks.getRequestComments.mockResolvedValue([]);
    mocks.getRequestAttachments.mockResolvedValue([]);
    // The upload endpoint answers with an AttachmentUploadResponse wrapper.
    mocks.addRequestAttachment.mockResolvedValue({
      success: true,
      message: 'File uploaded successfully',
      attachment: { id: 9, original_filename: 'proof.png' },
    });
    await portalRequestsStore.view({ id: 43 });

    const file = new File(['data'], 'proof.png');
    await portalRequestsStore.addAttachment(file);

    expect(mocks.addRequestAttachment).toHaveBeenCalledWith('support', 43, file);
    expect(portalRequestsStore.attachments).toEqual([{ id: 9, original_filename: 'proof.png' }]);
    expect(portalRequestsStore.attachmentUrl(9)).toBe(
      '/api/portal/support/requests/43/attachments/9/download'
    );
    expect(portalRequestsStore.uploadingAttachment).toBe(false);
  });

  it('reports a failed attachment upload without appending it', async () => {
    const { errorToast } = await import('./toasts.svelte.js');
    mocks.getRequestComments.mockResolvedValue([]);
    mocks.getRequestAttachments.mockResolvedValue([]);
    mocks.addRequestAttachment.mockRejectedValue(Object.assign(new Error('too large'), { status: 413 }));
    await portalRequestsStore.view({ id: 44 });

    await portalRequestsStore.addAttachment(new File(['x'], 'big.png'));

    expect(errorToast).toHaveBeenCalledWith('too large');
    expect(portalRequestsStore.attachments).toEqual([]);
    expect(portalRequestsStore.uploadingAttachment).toBe(false);
  });

  it('clears attachments when the detail closes', async () => {
    mocks.getRequestComments.mockResolvedValue([]);
    mocks.getRequestAttachments.mockResolvedValue([{ id: 7 }]);
    await portalRequestsStore.view({ id: 45 });
    expect(portalRequestsStore.attachments).toEqual([{ id: 7 }]);

    portalRequestsStore.closeDetail();

    expect(portalRequestsStore.attachments).toEqual([]);
  });
});
