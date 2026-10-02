import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => ({
  api: {
    milestones: {
      getAll: vi.fn().mockResolvedValue([]),
    },
    assets: {
      getAll: vi.fn().mockResolvedValue({ assets: [], total: 0 }),
    },
  },
}));

vi.mock('../stores/i18n.svelte.js', () => ({
  t: (key, params = {}) => {
    if (key === 'pickers.milestonesSelected') {
      return `${params.count} milestones selected`;
    }
    return key;
  },
  i18n: { locale: 'en-US' },
}));

vi.mock('../utils/serverClock.js', () => ({
  serverNow: () => new Date('2026-09-10T12:00:00.000Z'),
}));

import WorkItemForm from './WorkItemForm.svelte';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function createStore(overrides = {}) {
  const formData = {
    name: '',
    description: '',
    workspace_id: null,
    item_type_id: null,
    priority_id: null,
    assignee_id: null,
    due_date: null,
    start_date: null,
    end_date: null,
    iteration_id: null,
    project_id: null,
    story_points: null,
    estimate: '',
    milestone_ids: [],
    label_names: [],
    ...overrides.formData,
  };

  return {
    selectedWorkspace: null,
    availableItemTypes: [],
    milestones: [],
    milestonesLoading: false,
    iterations: [],
    timeProjects: [],
    customFieldValues: {},
    validationErrors: [],
    parentItem: null,
    templateApplyNonce: 0,
    templateLocked: false,
    templateOptions: [],
    mandatoryTemplate: null,
    selectedTemplateId: null,
    configSetLoadedForWorkspace: null,
    screenFieldsLoadedForKey: null,
    customFieldsLoaded: false,
    storedWorkspaceId: null,
    lastPersistedItemTypeId: null,
    nonRequiredFullSystemFields: [],
    nonRequiredCustomFields: [],
    requiredSystemFields: [],
    requiredCustomFields: [],
    selectedMilestones: [],
    selectedAssignee: null,
    selectedItemType: null,
    configSetPriorities: [],
    isFieldConfigured: () => false,
    isFieldRequired: () => false,
    loadWorkspaceDetails: vi.fn(),
    loadConfigSetForWorkspace: vi.fn(),
    loadScreenFieldsForItemType: vi.fn(),
    applyStoredWorkspace: vi.fn(),
    applyStoredItemType: vi.fn(),
    applyConfigSetDefault: vi.fn(),
    setWorkspace: vi.fn(),
    setItemType: vi.fn(),
    addPendingDescriptionImage: vi.fn(),
    applyTemplate: vi.fn(),
    ...overrides,
    formData,
  };
}

describe('milestone chip', () => {
  it('shows the selected milestone label when exactly one is selected', () => {
    const milestone = { id: 4, name: '0.8.4', category_color: '#579dff' };
    const store = createStore({
      formData: { milestone_ids: [milestone.id] },
      milestones: [milestone],
      selectedMilestones: [milestone],
      isFieldConfigured: (identifier) => identifier === 'milestone',
    });

    render(WorkItemForm, { props: { formStore: store } });

    expect(screen.getByTestId('create-milestone-chip')).toHaveTextContent('0.8.4');
  });

  it('shows the selected count even while milestone objects are unresolved', () => {
    const store = createStore({
      formData: { milestone_ids: [4, 5] },
      selectedMilestones: [],
      isFieldConfigured: (identifier) => identifier === 'milestone',
    });

    render(WorkItemForm, { props: { formStore: store } });

    expect(screen.getByTestId('create-milestone-chip')).toHaveTextContent('2 milestones selected');
  });
});

describe('item type chip', () => {
  it('uses the canonical item type icon treatment for the selected type', () => {
    const itemType = {
      id: 7,
      name: 'Story',
      icon: 'BookOpen',
      color: '#8b5cf6',
    };
    const store = createStore({
      formData: { item_type_id: itemType.id },
      availableItemTypes: [itemType],
      selectedItemType: itemType,
    });

    render(WorkItemForm, { props: { formStore: store } });

    const trigger = screen.getByTestId('create-item-type-chip');
    const typeIcon = trigger.querySelector('[title="Story"]');

    expect(typeIcon).toHaveStyle({ color: 'rgb(139, 92, 246)' });
    expect(typeIcon.querySelector('svg')).toHaveAttribute('width', '16');
    expect(typeIcon.style.backgroundColor).toBe('');
  });
});

describe('date chips', () => {
  it('uses deadline wording only for the due date chip', () => {
    const store = createStore({
      formData: {
        due_date: '2026-09-11T00:00:00.000Z',
        start_date: '2026-09-11T00:00:00.000Z',
        end_date: '2026-09-11T00:00:00.000Z',
      },
      isFieldConfigured: (identifier) => ['due_date', 'start_date', 'end_date'].includes(identifier),
    });

    render(WorkItemForm, { props: { formStore: store } });

    expect(screen.getByTestId('create-due-date-chip')).toHaveTextContent('dueDate.dueTomorrow');
    expect(screen.getByTestId('create-start-date-chip')).toHaveTextContent('Sep 11, 2026');
    expect(screen.getByTestId('create-end-date-chip')).toHaveTextContent('Sep 11, 2026');
    expect(screen.getByTestId('create-start-date-chip')).not.toHaveTextContent('Due');
    expect(screen.getByTestId('create-end-date-chip')).not.toHaveTextContent('Due');
  });

  it.each([
    ['due date', 'create-due-date-chip', 'create-due-date-input'],
    ['start date', 'create-start-date-chip', 'create-start-date-input'],
    ['end date', 'create-end-date-chip', 'create-end-date-input'],
  ])('keeps the %s popover open while the native input changes', async (_label, triggerTestId, inputTestId) => {
    const store = createStore({
      isFieldConfigured: (identifier) => ['due_date', 'start_date', 'end_date'].includes(identifier),
    });

    render(WorkItemForm, { props: { formStore: store } });

    await fireEvent.click(screen.getByTestId(triggerTestId));
    const input = screen.getByTestId(inputTestId);
    await fireEvent.change(input, { target: { value: '2026-09-15' } });

    expect(input).toBeVisible();
  });
});

describe('muted inputs', () => {
  it('keeps the title control transparent within the create modal', () => {
    const store = createStore();

    render(WorkItemForm, { props: { formStore: store } });

    const title = document.querySelector('#work-item-title');
    expect(title.style.backgroundColor).toBe('transparent');
    expect(title.style.borderColor).toBe('transparent');
  });
});

describe('additional fields', () => {
  it('keeps the custom field name visible above its control', async () => {
    const field = {
      id: 12,
      name: 'Affected department',
      field_type: 'asset',
      options: '{}',
    };
    const store = createStore({
      nonRequiredCustomFields: [field],
      customFieldValues: { [field.id]: null },
    });

    render(WorkItemForm, { props: { formStore: store } });
    await fireEvent.click(screen.getByTestId('create-additional-fields-toggle'));

    expect(screen.getByText('Affected department')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('pickers.selectAsset')).toBeInTheDocument();
  });
});
