import { describe, expect, it } from 'vitest';

import {
  boardStatusIdForItem,
  buildDisplayColumns,
  PERSONAL_TASK_DONE_STATUS_ID,
  PERSONAL_TASK_OPEN_STATUS_ID,
  statusIdForBoardColumnMove,
} from './boardColumns.js';

const columns = [
  { id: 10, name: 'Ready', status_ids: [101] },
  { id: 20, name: 'Doing', status_ids: [202] },
  { id: 30, name: 'Shipped', status_ids: [303] },
];
const personalWorkspaceIds = new Set([9]);

describe('personal task board status mapping', () => {
  it('places Open and Done in the board endpoint columns', () => {
    expect(
      boardStatusIdForItem(
        { workspace_id: 9, status_id: PERSONAL_TASK_OPEN_STATUS_ID },
        columns,
        personalWorkspaceIds
      )
    ).toBe(101);
    expect(
      boardStatusIdForItem(
        { workspace_id: 9, status_id: PERSONAL_TASK_DONE_STATUS_ID },
        columns,
        personalWorkspaceIds
      )
    ).toBe(303);
  });

  it('keeps regular work items on their actual status', () => {
    expect(
      boardStatusIdForItem({ workspace_id: 8, status_id: 202 }, columns, personalWorkspaceIds)
    ).toBe(202);
  });

  it('translates endpoint-column moves and rejects intermediate columns', () => {
    const task = { workspace_id: 9, status_id: PERSONAL_TASK_OPEN_STATUS_ID };

    expect(statusIdForBoardColumnMove(task, columns[0], columns, personalWorkspaceIds)).toBe(
      PERSONAL_TASK_OPEN_STATUS_ID
    );
    expect(statusIdForBoardColumnMove(task, columns[1], columns, personalWorkspaceIds)).toBeNull();
    expect(statusIdForBoardColumnMove(task, columns[2], columns, personalWorkspaceIds)).toBe(
      PERSONAL_TASK_DONE_STATUS_ID
    );
  });
});

describe('default board column order', () => {
  it('orders statuses from nested API v2 categories as Open, In Progress, Done', () => {
    const statuses = [
      { id: 3, name: 'Done', category: { builtin_key: 'done', color: '#22c55e' } },
      {
        id: 2,
        name: 'In Progress',
        category: { builtin_key: 'in_progress', color: '#3b82f6' },
      },
      { id: 1, name: 'Open', category: { builtin_key: 'to_do', color: '#d1d5db' } },
    ];

    expect(buildDisplayColumns(null, statuses)).toEqual([
      expect.objectContaining({ id: 1, name: 'Open', color: '#d1d5db' }),
      expect.objectContaining({ id: 2, name: 'In Progress', color: '#3b82f6' }),
      expect.objectContaining({ id: 3, name: 'Done', color: '#22c55e' }),
    ]);
  });
});
