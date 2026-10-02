import { describe, expect, it, vi } from 'vitest';
import { AssetQLEvaluator, QLEvaluator } from './ql.js';

const items = [
  {
    id: 1,
    workspace_id: 10,
    title: 'Alpha release',
    description: 'Ready',
    status: 'Open',
    priority: 'High',
    created_at: '2025-01-01T00:00:00.000Z',
    assignee_id: null,
  },
  {
    id: 2,
    workspace_id: 20,
    title: 'Beta release',
    description: 'Blocked',
    status: 'Closed',
    priority: 'Low',
    created_at: '2025-02-01T00:00:00.000Z',
    assignee_id: 7,
  },
];

const assets = [
  {
    id: 11,
    set_id: 3,
    set_name: 'Hardware',
    title: 'API server',
    status_name: 'Active',
    asset_type_name: 'Server',
    created_at: '2025-01-01T00:00:00.000Z',
    custom_field_values: { owner: 'Ada' },
  },
  {
    id: 12,
    set_id: 3,
    set_name: 'Hardware',
    title: 'Spare laptop',
    status_name: 'Retired',
    asset_type_name: 'Laptop',
    created_at: '2025-02-01T00:00:00.000Z',
    custom_field_values: {},
  },
];

describe.each([
  {
    name: 'work-item evaluator',
    evaluator: new QLEvaluator([
      { id: 10, name: 'Windshift', key: 'WI' },
      { id: 20, name: 'Operations', key: 'OPS' },
    ]),
    records: items,
    cases: [
      ['comparisons and boolean operations', 'title ~ "Alpha" AND status != "Closed"', [1]],
      ['lists', 'workspace IN ("WI", "Unknown")', [1]],
      ['null checks', 'assignee IS NULL', [1]],
      ['functions', 'created < now()', [1, 2]],
    ],
    errorLabel: 'QL Error:',
  },
  {
    name: 'asset evaluator',
    evaluator: new AssetQLEvaluator([{ id: 3, name: 'Hardware' }]),
    records: assets,
    cases: [
      ['comparisons and boolean operations', 'status = "Active" AND title ~ "server"', [11]],
      ['lists', 'type IN ("Server", "Desktop")', [11]],
      ['null checks', 'cf_owner IS NOT NULL', [11]],
      ['functions', 'created < endOfDay()', [11, 12]],
    ],
    errorLabel: 'Asset QL Error:',
  },
])('$name', ({ evaluator, records, cases, errorLabel }) => {
  it.each(cases)('handles %s', (_scenario, query, expectedIds) => {
    expect(evaluator.filter(records, query).map((record) => record.id)).toEqual(expectedIds);
  });

  it('preserves parse failures and their error category', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => evaluator.filter(records, 'title =')).toThrow();
    expect(consoleError).toHaveBeenCalledWith(errorLabel, expect.any(String));
    consoleError.mockRestore();
  });
});
