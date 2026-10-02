import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const customFieldsGetAll = vi.fn(async () => []);
const getCatalog = vi.fn(async () => ({
  fields: [
    {
      name: 'label',
      label: 'label',
      aliases: ['labels'],
      value_type: 'string',
      operators: ['=', '!=', 'IN', 'NOT IN'],
      value_help: { source: 'labels', value_field: 'name' },
    },
    {
      name: 'cfid_44',
      label: 'Approver groups',
      aliases: ['cf_Approver groups', 'custom.Approver groups'],
      field_type: 'multiselect',
      value_type: 'string',
      operators: ['=', '!=', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL'],
      values: [
        { value: 1, label: 'Developers' },
        { value: 2, label: 'Operations approvers' },
      ],
    },
    {
      name: 'cfid_45',
      label: 'Risk level',
      aliases: ['cf_Risk level', 'custom.Risk level'],
      field_type: 'select',
      value_type: 'string',
      operators: ['=', '!=', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL'],
      values: [
        { value: 1, label: 'Low' },
        { value: 2, label: 'High' },
      ],
    },
  ],
}));
const getValues = vi.fn(async (_valueHelp, query) =>
  query === 'front' ? [{ value: 'Frontend', label: 'Frontend' }] : []
);

vi.mock('../../api.js', () => ({
  api: {
    customFields: { getAll: customFieldsGetAll },
    queryLanguage: { getCatalog, getValues },
  },
}));

vi.mock('../../stores/i18n.svelte.js', () => ({
  t: (key) => key,
}));

const { default: DynamicFieldFilter } = await import('./DynamicFieldFilter.svelte');

afterEach(() => {
  cleanup();
  customFieldsGetAll.mockClear();
  getCatalog.mockClear();
  getValues.mockClear();
});

describe('DynamicFieldFilter value help', () => {
  test('searches centralized value help for a standard builder field', async () => {
    const onchange = vi.fn();
    render(DynamicFieldFilter, {
      props: {
        filter: {
          field: { id: 'labels', name: 'Labels', type: 'enum' },
          operator: '=',
          value: '',
          values: [],
        },
        testIdPrefix: 'labels-filter',
        onchange,
      },
    });

    const search = await screen.findByTestId('labels-filter-value-search');
    await fireEvent.click(search);
    await fireEvent.input(search, { target: { value: 'front' } });

    await waitFor(() =>
      expect(getValues).toHaveBeenCalledWith({ source: 'labels', value_field: 'name' }, 'front')
    );
    await fireEvent.click(await screen.findByTestId('labels-filter-value-option-Frontend'));
    expect(onchange).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'Frontend' }));
  });

  test('searches and selects a custom multiselect option for equality', async () => {
    const onchange = vi.fn();
    render(DynamicFieldFilter, {
      props: {
        filter: {
          field: {
            id: 'cf_Approver groups',
            customFieldId: 44,
            name: 'Approver groups',
            type: 'multiselect',
            isCustom: true,
          },
          operator: '=',
          value: '',
          values: [],
        },
        testIdPrefix: 'approver-groups-filter',
        onchange,
      },
    });

    const search = await screen.findByTestId('approver-groups-filter-value-search');
    await fireEvent.click(search);
    await fireEvent.input(search, { target: { value: 'operations' } });
    await fireEvent.click(await screen.findByTestId('approver-groups-filter-value-option-2'));

    expect(onchange).toHaveBeenLastCalledWith(expect.objectContaining({ value: 2, values: [] }));
    expect(search).toHaveValue('Operations approvers');
    expect(getCatalog).toHaveBeenCalled();
    expect(customFieldsGetAll).not.toHaveBeenCalled();
  });

  test('keeps custom multiselect options searchable for IN', async () => {
    const onchange = vi.fn();
    render(DynamicFieldFilter, {
      props: {
        filter: {
          field: {
            id: 'cf_Approver groups',
            customFieldId: 44,
            name: 'Approver groups',
            type: 'multiselect',
            isCustom: true,
          },
          operator: 'IN',
          value: '',
          values: [],
        },
        testIdPrefix: 'approver-groups-multi-filter',
        onchange,
      },
    });

    const search = await screen.findByTestId('approver-groups-multi-filter-value-search');
    await fireEvent.click(search);
    await fireEvent.input(search, { target: { value: 'developers' } });
    await fireEvent.click(await screen.findByTestId('approver-groups-multi-filter-value-option-1'));

    await waitFor(() =>
      expect(onchange).toHaveBeenLastCalledWith(expect.objectContaining({ value: '', values: [1] }))
    );
  });

  test('searches and selects a custom single-select option', async () => {
    const onchange = vi.fn();
    render(DynamicFieldFilter, {
      props: {
        filter: {
          field: {
            id: 'cf_Risk level',
            customFieldId: 45,
            name: 'Risk level',
            type: 'select',
            isCustom: true,
          },
          operator: '=',
          value: '',
          values: [],
        },
        testIdPrefix: 'risk-level-filter',
        onchange,
      },
    });

    const search = await screen.findByTestId('risk-level-filter-value-search');
    await fireEvent.click(search);
    await fireEvent.input(search, { target: { value: 'high' } });
    await fireEvent.click(await screen.findByTestId('risk-level-filter-value-option-2'));

    expect(onchange).toHaveBeenLastCalledWith(expect.objectContaining({ value: 2, values: [] }));
  });
});
