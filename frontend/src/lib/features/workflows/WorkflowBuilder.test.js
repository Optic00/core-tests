import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
afterEach(cleanup);
afterAll(() => {
  if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else delete Element.prototype.animate;
});

vi.mock('../../api.js', () => ({
  api: {
    objectTranslations: { list: vi.fn().mockResolvedValue([]) },
    statuses: { getAll: vi.fn() },
    workflows: {
      getAll: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('../../router.js', () => ({ navigate: vi.fn() }));
vi.mock('../../stores/permissions.svelte.js', () => ({
  isSystemAdmin: {
    subscribe: (run) => {
      run(true);
      return () => {};
    },
  },
}));
vi.mock('../../stores/i18n.svelte.js', () => ({
  t: vi.fn((key) => key),
  i18n: { locale: 'en', supportedLocales: [{ code: 'en', name: 'English' }] },
}));
vi.mock('../../stores/toasts.svelte.js', () => ({ errorToast: vi.fn() }));
vi.mock('../../composables/useConfirm.js', () => ({ confirm: vi.fn() }));

import { api } from '../../api.js';
import WorkflowBuilder from './WorkflowBuilder.svelte';

beforeAll(() => {
  if (!Element.prototype.animate) {
    Element.prototype.animate = () => ({
      finished: Promise.resolve(),
      cancel: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  api.statuses.getAll.mockResolvedValue([{ id: 1, name: 'Open' }]);
  api.workflows.getAll.mockResolvedValue([
    {
      id: 7,
      name: 'Company Workflow',
      description: 'Workflow for the company project',
      is_default: false,
    },
  ]);
  api.workflows.update.mockResolvedValue({
    id: 7,
    name: 'Updated Workflow',
    description: 'Workflow for the company project',
    is_default: false,
  });
});

describe('WorkflowBuilder modal shortcuts', () => {
  test('Cmd/Ctrl+Enter saves an edited workflow from the description textarea', async () => {
    render(WorkflowBuilder);

    await screen.findByText('Company Workflow');
    const actionTrigger = document.querySelector('.dropdown-trigger button');
    expect(actionTrigger).not.toBeNull();
    await fireEvent.click(actionTrigger);
    await fireEvent.click(await screen.findByText('common.edit'));

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    await fireEvent.click(await screen.findByTestId('localized-object-canonical-toggle'));
    const nameInput = screen.getByTestId('localized-object-canonical-name');
    const description = screen.getByTestId('localized-object-canonical-description');
    await fireEvent.input(nameInput, { target: { value: 'Updated Workflow' } });
    await fireEvent.keyDown(description, { key: 'Enter', metaKey: true });

    await waitFor(() => {
      expect(api.workflows.update).toHaveBeenCalledWith(7, {
        name: 'Updated Workflow',
        description: 'Workflow for the company project',
        is_default: false,
      });
    });
  });
});
