import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';

// Mock the api module — the renderer calls api.getUsers() for the user
// field type when the stored value is a bare id (not an object). Stub it
// to a controllable spy so we can drive the user-lookup branch.
vi.mock('../../api.js', () => ({
  api: {
    getUsers: vi.fn(),
    assets: {
      getSummaries: vi.fn(),
      getAll: vi.fn(async () => ({ data: [], pagination: { total_items: 0 } })),
    },
    portalCustomers: {
      getAll: vi.fn(async () => []),
    },
    customerOrganisations: {
      getAll: vi.fn(async () => []),
    },
  },
}));

// i18n — both the t function (used by the renderer) and the i18n object
// (read transitively by formatCustomFieldDate for the locale). Both must
// be exported, otherwise the date formatter throws and returns '' which
// the renderer then falls back to the raw YYYY-MM-DD string.
vi.mock('../../stores/i18n.svelte.js', () => ({
  t: (key, params) => {
    if (params?.field) return `setField:${params.field}`;
    return key;
  },
  i18n: { locale: 'en-US' },
}));

// which jsdom doesn't implement. The renderer itself doesn't use
// transitions, but a child picker might pull one in transitively. Defensive
// stub.
import { api } from '../../api.js';
import { referenceDisplayCache } from '../../stores/referenceDisplayCache.svelte.js';
import CustomFieldRenderer from './CustomFieldRenderer.svelte';

afterEach(() => {
  cleanup();
  referenceDisplayCache.reset();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

// Helper — render in readonly mode with onStartEdit so we exercise the
// clickable-button branch (the most common path in item detail views).
function renderReadonly(props) {
  return render(CustomFieldRenderer, {
    props: {
      readonly: true,
      onStartEdit: () => {},
      ...props,
    },
  });
}

// Helper — readonly without onStartEdit so we exercise the static-display
// wrapper used in card layouts, where email/url can be links.
function renderStatic(props) {
  return render(CustomFieldRenderer, {
    props: {
      readonly: true,
      onStartEdit: null,
      ...props,
    },
  });
}

function renderEdit(props) {
  return render(CustomFieldRenderer, {
    props: {
      readonly: false,
      onChange: vi.fn(),
      onCancel: vi.fn(),
      field: { field_type: 'text', name: 'Label' },
      ...props,
    },
  });
}

// Standard option set used by select/multiselect tests.
const SELECT_OPTIONS = JSON.stringify({
  next_id: 4,
  items: [
    { id: 1, label: 'Low' },
    { id: 2, label: 'Medium' },
    { id: 3, label: 'High' },
  ],
});

describe('text field', () => {
  test('renders the raw value', () => {
    renderReadonly({
      field: { field_type: 'text', name: 'Notes' },
      value: 'Hello world',
    });
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  test('empty value shows setField placeholder', () => {
    renderReadonly({
      field: { field_type: 'text', name: 'Notes' },
      value: '',
    });
    expect(screen.getByText('setField:notes')).toBeInTheDocument();
  });
});

describe('number field', () => {
  test('renders parsed number', () => {
    renderReadonly({
      field: { field_type: 'number', name: 'Estimate' },
      value: '42',
    });
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  test('non-numeric value falls through unchanged', () => {
    renderReadonly({
      field: { field_type: 'number', name: 'Estimate' },
      value: 'NaN-like',
    });
    expect(screen.getByText('NaN-like')).toBeInTheDocument();
  });

  test('floating point is preserved', () => {
    renderReadonly({
      field: { field_type: 'number', name: 'Estimate' },
      value: '3.14',
    });
    expect(screen.getByText('3.14')).toBeInTheDocument();
  });
});

describe('date field', () => {
  test('YYYY-MM-DD value is rendered without timezone drift', () => {
    // formatCustomFieldDate forces UTC parsing — Jan 15 stays Jan 15 even
    // when the host runs in a non-UTC zone.
    renderReadonly({
      field: { field_type: 'date', name: 'Due' },
      value: '2026-01-15',
    });
    // Locale rendering is host-dependent (e.g. en-US "Jan 15, 2026");
    // assert the day-month-year tokens individually.
    const node = screen.getByText(/2026/);
    expect(node.textContent).toMatch(/15/);
    expect(node.textContent).toMatch(/Jan/i);
  });

  test('empty value shows setField placeholder', () => {
    renderReadonly({
      field: { field_type: 'date', name: 'Due' },
      value: null,
    });
    expect(screen.getByText('setField:due')).toBeInTheDocument();
  });
});

describe('email field', () => {
  test('interactive wrapper shows the address as text without nesting a link', () => {
    const { container } = renderReadonly({
      field: { field_type: 'email', name: 'Contact' },
      value: 'alice@example.com',
    });
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
  });

  test('static variant renders a mailto: link', () => {
    renderStatic({
      field: { field_type: 'email', name: 'Contact' },
      value: 'alice@example.com',
    });
    const link = screen.getByRole('link', { name: 'alice@example.com' });
    expect(link).toHaveAttribute('href', 'mailto:alice@example.com');
  });
});

describe('url field', () => {
  test('interactive wrapper shows the URL as text without nesting a link', () => {
    const { container } = renderReadonly({
      field: { field_type: 'url', name: 'Link' },
      value: 'https://example.com/docs',
    });
    expect(screen.getByText('https://example.com/docs')).toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
  });

  test('static variant renders an external link with rel safety', () => {
    renderStatic({
      field: { field_type: 'url', name: 'Link' },
      value: 'https://example.com/docs',
    });
    const link = screen.getByRole('link', { name: 'https://example.com/docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });
});

describe('boolean checkbox field', () => {
  test('canonical boolean value renders common.yes', () => {
    renderReadonly({
      field: { field_type: 'boolean', name: 'Done' },
      value: true,
    });
    expect(screen.getByText('common.yes')).toBeInTheDocument();
  });

  test('falsy-but-present value renders common.no', () => {
    // value=false is meaningful for a checkbox; it must render "no", not
    // fall into the empty-state placeholder branch. The renderer treats
    // boolean false as "present" (only null/undefined/'' trigger empty).
    renderStatic({
      field: { field_type: 'checkbox', name: 'Done' },
      value: false,
    });
    expect(screen.getByText('common.no')).toBeInTheDocument();
  });
});

describe('select field', () => {
  test('resolves option id to label', () => {
    renderReadonly({
      field: { field_type: 'select', name: 'Priority', options: SELECT_OPTIONS },
      value: 2,
    });
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  test('orphan option id renders as raw string (deleted-option safety net)', () => {
    // Regression guard for the Q3 scenario: an option that was selected
    // and then removed. Until backend cleanup catches up, the renderer
    // displays the bare id rather than crashing or showing "[object Object]".
    renderReadonly({
      field: { field_type: 'select', name: 'Priority', options: SELECT_OPTIONS },
      value: 99,
    });
    expect(screen.getByText('99')).toBeInTheDocument();
  });

  test('numeric-string id also resolves', () => {
    renderReadonly({
      field: { field_type: 'select', name: 'Priority', options: SELECT_OPTIONS },
      value: '3',
    });
    expect(screen.getByText('High')).toBeInTheDocument();
  });
});

describe('multiselect field', () => {
  test('joins resolved labels with commas', () => {
    renderReadonly({
      field: { field_type: 'multiselect', name: 'Tags', options: SELECT_OPTIONS },
      value: [1, 3],
    });
    expect(screen.getByText('Low, High')).toBeInTheDocument();
  });

  test('mixed valid + orphan ids — orphans render as raw strings inline', () => {
    // Multiselect orphan scenario: one option deleted, the array still
    // contains its id. The deleted slot renders as "<id>" between the
    // surviving labels.
    renderReadonly({
      field: { field_type: 'multiselect', name: 'Tags', options: SELECT_OPTIONS },
      value: [1, 99, 2],
    });
    expect(screen.getByText('Low, 99, Medium')).toBeInTheDocument();
  });

  test.each([
	['1,2', 'Low, Medium'],
	[3, 'High'],
  ])('resolves legacy scalar value %j', (value, expected) => {
	renderReadonly({
	  field: { field_type: 'multiselect', name: 'Tags', options: SELECT_OPTIONS },
	  value,
	});
	expect(screen.getByText(expected)).toBeInTheDocument();
  });

  test('empty array shows setField placeholder', () => {
    renderReadonly({
      field: { field_type: 'multiselect', name: 'Tags', options: SELECT_OPTIONS },
      value: [],
    });
	expect(screen.getByText('setField:tags')).toBeInTheDocument();
  });

  test('empty array shows items.notSet in static mode', () => {
	renderStatic({
	  field: { field_type: 'multiselect', name: 'Tags', options: SELECT_OPTIONS },
	  value: [],
	});
	expect(screen.getByText('items.notSet')).toBeInTheDocument();
  });
});

describe('user field', () => {
  test('object value shows the user name', () => {
    renderReadonly({
      field: { field_type: 'user', name: 'Owner' },
      value: { id: 1, name: 'Alice Smith' },
    });
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });

  test('bare-id value triggers api.getUsers() and resolves to first_name + last_name', async () => {
    api.getUsers.mockResolvedValueOnce([
      { id: 7, first_name: 'Bob', last_name: 'Lee', username: 'blee' },
    ]);
    renderReadonly({
      field: { field_type: 'user', name: 'Owner' },
      value: 7,
    });
    await waitFor(() => {
      expect(screen.getByText('Bob Lee')).toBeInTheDocument();
    });
    expect(api.getUsers).toHaveBeenCalledTimes(1);
  });

  test('unknown user id shows common.unknownUser', async () => {
    api.getUsers.mockResolvedValueOnce([
      { id: 7, first_name: 'Bob', last_name: 'Lee', username: 'blee' },
    ]);
    renderReadonly({
      field: { field_type: 'user', name: 'Owner' },
      value: 999, // not in the users list
    });
    await waitFor(() => {
      expect(screen.getByText('common.unknownUser')).toBeInTheDocument();
    });
  });
});

describe('milestone field', () => {
  test('resolves id against milestones prop and shows name', () => {
    renderReadonly({
      field: { field_type: 'milestone', name: 'Milestone' },
      value: 11,
      milestones: [
        { id: 10, name: 'M1', category_color: '#ff0000' },
        { id: 11, name: 'M2', category_color: '#00ff00' },
      ],
    });
    expect(screen.getByText('M2')).toBeInTheDocument();
  });

  test('unknown milestone id shows setField placeholder', () => {
    // The renderer's milestone branch only shows the name when found —
    // otherwise it falls into the empty-state Target-icon placeholder.
    renderReadonly({
      field: { field_type: 'milestone', name: 'Milestone' },
      value: 99,
      milestones: [{ id: 10, name: 'M1' }],
    });
    expect(screen.getByText('setField:milestone')).toBeInTheDocument();
  });
});

describe('iteration field', () => {
  test('resolves id against iterations prop and shows name', () => {
    renderReadonly({
      field: { field_type: 'iteration', name: 'Sprint' },
      value: 5,
      iterations: [
        { id: 4, name: 'Sprint 1', is_global: false },
        { id: 5, name: 'Sprint 2', is_global: true },
      ],
    });
    expect(screen.getByText('Sprint 2')).toBeInTheDocument();
  });

  test('unknown iteration id falls through to raw value (no helpful placeholder)', () => {
    // The renderer returns the bare value when iterations.find() misses.
    // This documents current behaviour; differs from milestone which has
    // an explicit empty branch.
    renderReadonly({
      field: { field_type: 'iteration', name: 'Sprint' },
      value: 99,
      iterations: [{ id: 1, name: 'Sprint 1' }],
    });
    expect(screen.getByText('99')).toBeInTheDocument();
  });
});

describe('asset field', () => {
  test('object value with tag + title is formatted as "TAG - Title"', () => {
    renderReadonly({
      field: { field_type: 'asset', name: 'Machine' },
      value: { id: 1, asset_tag: 'A-001', title: 'Forklift' },
    });
    expect(screen.getByText('A-001 - Forklift')).toBeInTheDocument();
  });

  test('object value with title only', () => {
    renderReadonly({
      field: { field_type: 'asset', name: 'Machine' },
      value: { id: 1, title: 'Forklift' },
    });
    expect(screen.getByText('Forklift')).toBeInTheDocument();
  });

  test('bare-id value resolves to asset title', async () => {
    api.assets.getSummaries.mockResolvedValueOnce([
      { id: 42, asset_tag: 'A-042', title: 'Loader' },
    ]);
    renderReadonly({
      field: { field_type: 'asset', name: 'Machine' },
      value: 42,
    });
    expect(screen.getByText('Asset #42')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('A-042 - Loader')).toBeInTheDocument());
  });

  test('bare-id value falls back to "Asset #N" when lookup fails', async () => {
    api.assets.getSummaries.mockRejectedValueOnce(new Error('not found'));
    renderReadonly({
      field: { field_type: 'asset', name: 'Machine' },
      value: 42,
    });
    await waitFor(() =>
      expect(api.assets.getSummaries).toHaveBeenCalledWith([42], expect.anything())
    );
    expect(screen.getByText('Asset #42')).toBeInTheDocument();
  });

  test('multi-asset values are formatted as a comma-separated list', () => {
    renderReadonly({
      field: { field_type: 'asset', name: 'Machines', options: JSON.stringify({ multi: true }) },
      value: [
        { id: 1, asset_tag: 'A-001', title: 'Forklift' },
        { id: 2, title: 'Conveyor' },
      ],
    });
    expect(screen.getByText('A-001 - Forklift, Conveyor')).toBeInTheDocument();
  });
});

describe('portalcustomer field', () => {
  test('object value shows name', () => {
    renderReadonly({
      field: { field_type: 'portalcustomer', name: 'Customer' },
      value: { id: 3, name: 'Acme Inc.' },
    });
    expect(screen.getByText('Acme Inc.')).toBeInTheDocument();
  });

  test('bare-id falls back to "Customer #N"', () => {
    renderReadonly({
      field: { field_type: 'portalcustomer', name: 'Customer' },
      value: 8,
    });
    expect(screen.getByText('Customer #8')).toBeInTheDocument();
  });

  test('object without a name falls back to its id', () => {
	renderReadonly({
	  field: { field_type: 'portalcustomer', name: 'Customer' },
	  value: { id: 5 },
	});
	expect(screen.getByText('Customer #5')).toBeInTheDocument();
  });
});

describe('customerorganisation field', () => {
  test('object value shows name', () => {
    renderReadonly({
      field: { field_type: 'customerorganisation', name: 'Org' },
      value: { id: 3, name: 'Acme Group' },
    });
    expect(screen.getByText('Acme Group')).toBeInTheDocument();
  });

  test('bare-id falls back to "Organisation #N"', () => {
    renderReadonly({
      field: { field_type: 'customerorganisation', name: 'Org' },
      value: 8,
    });
    expect(screen.getByText('Organisation #8')).toBeInTheDocument();
  });

  test('object without a name falls back to its id', () => {
	renderReadonly({
	  field: { field_type: 'customerorganisation', name: 'Org' },
	  value: { id: 6 },
	});
	expect(screen.getByText('Organisation #6')).toBeInTheDocument();
  });
});

describe('combobox field', () => {
  test('comma-separated value renders as chips', () => {
    renderReadonly({
      field: { field_type: 'combobox', name: 'Labels' },
      value: 'urgent, bug, ui',
    });
    expect(screen.getByText('urgent')).toBeInTheDocument();
    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('ui')).toBeInTheDocument();
  });

  test('empty value shows nothing for the chip area', () => {
    renderReadonly({
      field: { field_type: 'combobox', name: 'Labels' },
      value: '',
    });
    // Falls into the unset state; specifically the setField placeholder.
    expect(screen.getByText('setField:labels')).toBeInTheDocument();
  });
});

describe('linking field', () => {
  test('interactive variant uses the shared linked-item count', () => {
    renderReadonly({
      field: { field_type: 'linking', name: 'Blocked by' },
      value: [{ id: 1 }, { id: 2 }],
    });
    expect(screen.getByText('2 linked')).toBeInTheDocument();
  });

  test('static variant shows count of linked items (array)', () => {
    renderStatic({
      field: { field_type: 'linking', name: 'Blocked by' },
      value: [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
    expect(screen.getByText('3 linked')).toBeInTheDocument();
  });

  test('static variant shows "1 linked" for a single object value', () => {
    renderStatic({
      field: { field_type: 'linking', name: 'Blocked by' },
      value: { id: 1 },
    });
    expect(screen.getByText('1 linked')).toBeInTheDocument();
  });

  test('null value short-circuits to the outer items.notSet placeholder', () => {
    // The static-display branch tests `value !== null && value !== undefined`
    // BEFORE entering the per-type linking case. So a null linking value
    // never reaches the linking-specific em-dash branch — it lands on the
    // generic "not set" placeholder instead. The em-dash branch inside
    // the linking case is in practice unreachable from real call sites
    // (which always pass either an array or null).
    renderStatic({
      field: { field_type: 'linking', name: 'Blocked by' },
      value: null,
    });
    expect(screen.getByText('items.notSet')).toBeInTheDocument();
  });

  test('empty array renders the em-dash (no links)', () => {
    // Arrays must not fall through to the single-object branch.
    renderStatic({
      field: { field_type: 'linking', name: 'Blocked by' },
      value: [],
    });
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('read-only wrapper selection', () => {
  test('disabled editable display uses the static wrapper and keeps its test id', () => {
    const { container } = renderReadonly({
      field: { field_type: 'text', name: 'Notes' },
      value: 'Locked',
      disabled: true,
      displayTestId: 'custom-field-display',
    });

    const wrapper = container.querySelector('[data-testid="custom-field-display"]');
    expect(wrapper?.tagName).toBe('DIV');
    expect(wrapper).toHaveClass('opacity-50');
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });
});

describe('edit mode — scalar inputs', () => {
  test.each([
    ['text', 'input[type="text"]', 'Changed text'],
    ['textarea', 'textarea', 'Changed\ntext'],
    ['number', 'input[type="number"]', '42.5'],
    ['date', 'input[type="date"]', '2026-05-15'],
    ['email', 'input[type="email"]', 'new@example.com'],
    ['url', 'input[type="url"]', 'https://example.com/new'],
  ])('%s calls onChange with edited value', async (fieldType, selector, editedValue) => {
    const onChange = vi.fn();
    const { container } = renderEdit({
      field: { field_type: fieldType, name: 'Label' },
      value: '',
      onChange,
    });

    const input = container.querySelector(selector);
    expect(input).not.toBeNull();
    await fireEvent.input(input, { target: { value: editedValue } });

    expect(onChange).toHaveBeenCalledWith(editedValue);
  });

  test('text input commits on Enter instead of committing each character', async () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { container } = renderEdit({
      field: { id: 17, field_type: 'text', name: 'Label' },
      value: '',
      onChange,
      onCommit,
    });

    const input = container.querySelector('[data-testid="custom-field-input-17"]');
    input.focus();
    await fireEvent.input(input, { target: { value: 'A' } });
    await fireEvent.input(input, { target: { value: 'AB' } });

    expect(input).toHaveFocus();
    expect(onChange).toHaveBeenNthCalledWith(1, 'A');
    expect(onChange).toHaveBeenNthCalledWith(2, 'AB');
    expect(onCommit).not.toHaveBeenCalled();

    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith('AB');
  });

  test('number input keeps focus while typing digits and commits on blur', async () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const { container } = renderEdit({
      field: { id: 23, field_type: 'number', name: 'Points' },
      value: '',
      onChange,
      onCommit,
    });

    const input = container.querySelector('[data-testid="custom-field-input-23"]');
    input.focus();
    await fireEvent.input(input, { target: { value: '2' } });
    await fireEvent.input(input, { target: { value: '23' } });

    expect(input).toHaveFocus();
    expect(input.value).toBe('23');
    expect(onCommit).not.toHaveBeenCalled();

    await fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith('23');
  });

  test('date input strips time-like persisted values to YYYY-MM-DD', () => {
    const { container } = renderEdit({
      field: { field_type: 'date', name: 'Due' },
      value: '2026-05-15T12:34:56Z',
    });

    const input = container.querySelector('input[type="date"]');
    expect(input).not.toBeNull();
    expect(input.value).toBe('2026-05-15');
  });

  test('checkbox edit mode coerces string "false" to unchecked', () => {
    const { container } = renderEdit({
      field: { field_type: 'checkbox', name: 'Done' },
      value: 'false',
    });

    const input = container.querySelector('input[type="checkbox"]');
    expect(input).not.toBeNull();
    expect(input.checked).toBe(false);
  });

  test('canonical boolean field calls onChange with boolean when toggled', async () => {
    const onChange = vi.fn();
    const { container } = renderEdit({
      field: { field_type: 'boolean', name: 'Done' },
      value: false,
      onChange,
    });

    const input = container.querySelector('input[type="checkbox"]');
    expect(input).not.toBeNull();
    await fireEvent.click(input);

    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('unset / placeholder behavior', () => {
  test.each([
    ['text', null],
    ['number', null],
    ['date', null],
    ['email', null],
    ['url', null],
    ['select', null],
    ['multiselect', null],
    ['user', null],
    ['milestone', null], // milestone has its own setField branch
    ['asset', null],
    ['portalcustomer', null],
    ['customerorganisation', null],
    ['combobox', null],
  ])('%s renders setField placeholder when value is null', (fieldType) => {
    renderReadonly({
      field: { field_type: fieldType, name: 'Label', options: SELECT_OPTIONS },
      value: null,
      milestones: [],
      iterations: [],
    });
    // The placeholder uses the field name lowercased; we asserted that
    // pattern in the per-type tests above. Here we just confirm the
    // placeholder branch fires (vs rendering an empty span).
    expect(screen.getByText('setField:label')).toBeInTheDocument();
  });
});

describe('self-editing mode (list cells)', () => {
  const assetField = {
    id: 9,
    field_type: 'asset',
    name: 'Machine',
    options: JSON.stringify({ asset_set_id: 3 }),
  };

  function renderSelfEditing(props) {
    return render(CustomFieldRenderer, {
      props: {
        readonly: true,
        selfEditing: true,
        disabled: false,
        onChange: vi.fn(),
        ...props,
      },
    });
  }

  test('asset object value renders its display label as a clickable cell', () => {
    renderSelfEditing({
      field: assetField,
      value: { id: 5, asset_tag: 'A-005', title: 'Press' },
    });
    const label = screen.getByText('A-005 - Press');
    expect(label.closest('button')).not.toBeNull();
  });

  test('clicking the cell opens the picker labeled with the current value', async () => {
    const onChange = vi.fn();
    renderSelfEditing({
      field: assetField,
      value: { id: 5, asset_tag: 'A-005', title: 'Press' },
      onChange,
    });
    fireEvent.click(screen.getByText('A-005 - Press'));
    // The stored value object is the label source while options load lazily.
    await waitFor(() =>
      expect(screen.getByDisplayValue('A-005 - Press')).toBeInTheDocument()
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  test('picking an asset commits the object value and returns to display', async () => {
    const onChange = vi.fn();
    renderSelfEditing({
      field: assetField,
      value: null,
      onChange,
      loadAssetOptions: async () => ({
        assets: [{ id: 7, title: 'Lathe', asset_tag: 'A-007' }],
        total: 1,
      }),
    });
    fireEvent.click(screen.getByText('setField:machine'));
    const option = await screen.findByText('Lathe');
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith({ id: 7, title: 'Lathe', asset_tag: 'A-007' });
    // The editor closes; the display would show the committed value once the
    // parent applies the change.
    await waitFor(() =>
      expect(screen.getByText('setField:machine')).toBeInTheDocument()
    );
  });

  test('portalcustomer editor shows the stored name while options load', async () => {
    renderSelfEditing({
      field: { id: 3, field_type: 'portalcustomer', name: 'Contact' },
      value: { id: 12, name: 'Acme Corp', email: 'a@acme.io' },
    });
    fireEvent.click(screen.getByText('Acme Corp'));
    await waitFor(() => expect(screen.getByDisplayValue('Acme Corp')).toBeInTheDocument());
  });

  test('text commits once on Enter instead of per keystroke', async () => {
    const onChange = vi.fn();
    renderSelfEditing({
      field: { field_type: 'text', name: 'Notes' },
      value: 'Hello',
      onChange,
    });
    fireEvent.click(screen.getByText('Hello'));
    const input = await screen.findByDisplayValue('Hello');
    fireEvent.input(input, { target: { value: 'Hello world' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('Hello world');
  });

  test('blur commits the staged draft once focus leaves', () => {
    const onChange = vi.fn();
    renderSelfEditing({
      field: { field_type: 'text', name: 'Notes' },
      value: 'Hello',
      onChange,
    });
    fireEvent.click(screen.getByText('Hello'));
    const input = screen.getByDisplayValue('Hello');
    fireEvent.input(input, { target: { value: 'Hello world' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('Hello world');
  });

  test('blur without changes does not fire onChange', () => {
    const onChange = vi.fn();
    renderSelfEditing({
      field: { field_type: 'text', name: 'Notes' },
      value: 'Hello',
      onChange,
    });
    fireEvent.click(screen.getByText('Hello'));
    fireEvent.blur(screen.getByDisplayValue('Hello'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  test('boolean renders a live checkbox that commits on toggle', () => {
    const onChange = vi.fn();
    renderSelfEditing({
      field: { field_type: 'checkbox', name: 'Done' },
      value: true,
      onChange,
    });
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  test('empty cell prompts and opens the editor on click', () => {
    renderSelfEditing({
      field: { field_type: 'text', name: 'Notes' },
      value: null,
    });
    fireEvent.click(screen.getByText('setField:notes'));
    expect(screen.getByPlaceholderText('setField:notes')).toBeInTheDocument();
  });

  test('disabled self-editing renders static text without a button', () => {
    render(CustomFieldRenderer, {
      props: {
        field: { field_type: 'text', name: 'Notes' },
        value: 'Frozen',
        readonly: true,
        selfEditing: true,
        disabled: true,
      },
    });
    expect(screen.getByText('Frozen')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
