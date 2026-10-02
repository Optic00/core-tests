import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUsers: vi.fn().mockRejectedValue({ status: 403 }),
  getAssignableUsers: vi.fn().mockResolvedValue([]),
  errorToast: vi.fn(),
}));

vi.mock('../../api.js', () => ({
  api: {
    getUsers: mocks.getUsers,
    getAssignableUsers: mocks.getAssignableUsers,
    milestones: { getAll: vi.fn().mockResolvedValue([]) },
    tests: {
      testPlans: { getAll: vi.fn().mockResolvedValue([]) },
      testRuns: { getAll: vi.fn().mockResolvedValue([{ id: 8, name: 'Visible workspace run' }]) },
    },
  },
}));
vi.mock('../../stores/toasts.svelte.js', () => ({
  errorToast: mocks.errorToast,
  warningToast: vi.fn(),
}));
vi.mock('../../stores/i18n.svelte.js', () => ({ t: (key) => key }));

import TestRuns from './TestRuns.svelte';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test('loads runs using workspace users when the global directory is forbidden', async () => {
  render(TestRuns, { workspaceId: 7 });
  expect(await screen.findByText('Visible workspace run')).toBeInTheDocument();
  expect(mocks.getAssignableUsers).toHaveBeenCalledWith(7);
  expect(mocks.getUsers).not.toHaveBeenCalled();
  expect(mocks.errorToast).not.toHaveBeenCalled();
});
