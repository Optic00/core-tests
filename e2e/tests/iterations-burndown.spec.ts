import { randomUUID } from 'node:crypto';
import { expect, test } from '../fixtures/context-path';
import {
  createItemViaAPI,
  createIterationViaAPI,
  createWorkspaceViaAPI,
  listIterationTypesViaAPI,
  updateItemViaAPI,
} from '../fixtures/api-helpers';
import { shot } from '../helpers/screenshot';

/**
 * Iteration burndown chart coverage:
 *   - GET /iterations/{id}/burndown reconstructs per-day remaining/completed
 *     counts and story-point totals from item history across the iteration
 *     window (data points stop at today).
 *   - The iteration detail page renders the chart, defaults to items, and
 *     switches to story points via the metric selector.
 *
 * The API can only write history "now", so the seeded timeline is placed
 * on a two-week schedule through the WINDSHIFT_E2E_TEST_HOOKS-only
 * backdate route (POST /api/test/history/backdate), which shifts
 * timestamps of rows the production API already created. That keeps the
 * fixture on the production write path while making the time dimension
 * deterministic.
 */

/** UTC date string N days from today (iteration dates are date-only). */
function isoDate(daysFromToday: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

/** RFC3339 timestamp at a fixed local time-of-day on a seeded day. */
function at(dayOffset: number, time: string): string {
  return `${isoDate(dayOffset)}T${time}Z`;
}

/** Replicates the chart's fmtD so labels match regardless of timezone. */
function chartLabel(date: string): string {
  const parsed = new Date(date);
  return `${String(parsed.getMonth() + 1).padStart(2, '0')}/${String(parsed.getDate()).padStart(2, '0')}`;
}

const START = -14;
const END = 2;
// Data points run start..today inclusive, so today is the last index.
const TODAY_INDEX = 14;

/**
 * Seeded sprint: 6 items committed at kick-off (19 points), one item
 * added mid-sprint (+2), one item re-estimated 3 -> 8 mid-sprint, four
 * items completing in staggered steps. Today: 3 items / 12 points
 * remaining, 4 items / 14 points completed.
 */
const plan = [
  { title: 'Burndown item A', points: 5, inProgress: -12, done: -9 },
  { title: 'Burndown item B', points: 3, inProgress: -8, done: -5 },
  { title: 'Burndown item C', points: 3, inProgress: -4, done: -2 },
  { title: 'Burndown item D', points: 2, inProgress: null, done: null },
  { title: 'Burndown item E', points: 3, inProgress: -3, done: -1 },
  { title: 'Burndown item F', points: 3, inProgress: null, done: null, reestimatedTo: 8, reestimatedAt: -6 },
] as const;

// Expected daily curve (remaining, completed, remaining_points, completed_points).
const curve = [
  [6, 0, 19, 0], [6, 0, 19, 0], [6, 0, 19, 0], [6, 0, 19, 0],
  [6, 0, 19, 0], [5, 1, 14, 5], [5, 1, 14, 5], [6, 1, 16, 5],
  [6, 1, 21, 5], [5, 2, 18, 8], [5, 2, 18, 8], [5, 2, 18, 8],
  [4, 3, 15, 11], [3, 4, 12, 14], [3, 4, 12, 14],
];

test.describe('Iteration Burndown', () => {
  let workspaceId: number;
  let iterationId: number;
  let openStatusId: number;
  let inProgressStatusId: number;
  let doneStatusId: number;

  test.beforeEach(async ({ request }) => {
    const key = randomUUID().replaceAll('-', '').slice(0, 7).toUpperCase();
    const workspace = await createWorkspaceViaAPI(request, {
      name: `Burndown ${Date.now()}-${key}`,
      key: `BDN${key}`,
      description: 'Iteration burndown chart E2E',
    });
    workspaceId = workspace.id;

    const statuses = await (
      await request.get(`/api/v2/workspaces/${workspaceId}/statuses`)
    ).json();
    const statusList = statuses.data ?? statuses;
    const byCategory = (builtin: string): number => {
      const status = statusList.find(
        (s: { category?: { builtin_key?: string } }) => s.category?.builtin_key === builtin,
      );
      if (!status) throw new Error(`No ${builtin} status seeded for fresh workspace`);
      return status.id;
    };
    inProgressStatusId = byCategory('in_progress');
    doneStatusId = byCategory('done');
    openStatusId = byCategory('to_do');

    const types = await listIterationTypesViaAPI(request);
    if (types.length === 0) throw new Error('No iteration types seeded');
    const iteration = await createIterationViaAPI(request, {
      name: `Burndown sprint ${Date.now()}`,
      start_date: isoDate(START),
      end_date: isoDate(END),
      type_id: types[0].id,
      workspace_id: workspaceId,
      status: 'active',
    });
    iterationId = iteration.id;
  });

  test('renders the burndown and switches between items and story points', async ({
    request,
    page,
  }) => {
    // Seed every item through the production API: create with points,
    // assign to the iteration, then walk the status transitions.
    const itemIds: number[] = [];
    for (const entry of plan) {
      const item = await createItemViaAPI(request, workspaceId, {
        title: entry.title,
        story_points: entry.points,
      });
      itemIds.push(item.id);
      await updateItemViaAPI(request, item.id, { iteration_id: iterationId });
      if (entry.inProgress !== null) {
        const res = await request.post(`/api/v2/items/${item.id}/transition`, {
          headers: { 'Content-Type': 'application/json' },
          data: { to_status_id: inProgressStatusId },
        });
        expect(res.ok(), `in-progress transition failed: ${await res.text()}`).toBeTruthy();
      }
      if (entry.done !== null) {
        const res = await request.post(`/api/v2/items/${item.id}/transition`, {
          headers: { 'Content-Type': 'application/json' },
          data: { to_status_id: doneStatusId },
        });
        expect(res.ok(), `done transition failed: ${await res.text()}`).toBeTruthy();
      }
      if ('reestimatedTo' in entry) {
        await updateItemViaAPI(request, item.id, { story_points: entry.reestimatedTo });
      }
    }

    // Mid-sprint scope addition, two days after its creation.
    const slack = await createItemViaAPI(request, workspaceId, {
      title: 'Burndown item G',
      story_points: 2,
    });
    await updateItemViaAPI(request, slack.id, { iteration_id: iterationId });
    itemIds.push(slack.id);

    // Place the seeded changes on the sprint timeline (test hook).
    const backdate = await request.post('/api/test/history/backdate', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        items: [
          ...plan.map((entry, index) => ({
            item_id: itemIds[index],
            created_at: at(START, '08:00:00'),
            set: [
              { field_name: '*', changed_at: at(START, '09:30:00') },
              ...(entry.inProgress !== null
                ? [{
                    field_name: 'status_id',
                    old_value: String(openStatusId),
                    new_value: String(inProgressStatusId),
                    changed_at: at(entry.inProgress, '11:00:00'),
                  }]
                : []),
              ...(entry.done !== null
                ? [{
                    field_name: 'status_id',
                    old_value: String(inProgressStatusId),
                    new_value: String(doneStatusId),
                    changed_at: at(entry.done, '16:00:00'),
                  }]
                : []),
              ...('reestimatedTo' in entry
                ? [{
                    field_name: 'story_points',
                    old_value: String(entry.points),
                    new_value: String(entry.reestimatedTo),
                    changed_at: at(entry.reestimatedAt, '10:00:00'),
                  }]
                : []),
            ],
          })),
          {
            item_id: slack.id,
            created_at: at(-8, '10:00:00'),
            set: [
              { field_name: '*', changed_at: at(-8, '10:00:00') },
              { field_name: 'iteration_id', old_value: '', new_value: String(iterationId), changed_at: at(-7, '09:00:00') },
            ],
          },
        ],
      },
    });
    expect(backdate.ok(), `backdate failed: ${await backdate.text()}`).toBeTruthy();

    // API contract: one data point per day from start to today with the
    // exact seeded curve, and an ideal line based on the day-0 commitment.
    const burndown = await (await request.get(`/api/v2/iterations/${iterationId}/burndown`)).json();
    const data = burndown.data;
    expect(data).toMatchObject({
      iteration_id: iterationId,
      start_date: isoDate(START),
      end_date: isoDate(END),
      total_items: 7,
    });
    const points = data.data_points;
    expect(points).toHaveLength(TODAY_INDEX + 1);
    curve.forEach(([remaining, completed, remainingPoints, completedPoints], index) => {
      expect(points[index], `data point ${index}`).toEqual({
        date: isoDate(START + index),
        remaining,
        completed,
        remaining_points: remainingPoints,
        completed_points: completedPoints,
        ideal: 6 - Math.trunc((index * 6) / 16),
        ideal_points: (19 * (16 - index)) / 16,
      });
    });

    await page.goto(`/iterations/${iterationId}`);
    const card = page.getByTestId('iteration-burndown-card');
    const metric = page.getByTestId('iteration-burndown-metric');
    await expect(metric).toBeVisible();
    await expect(metric).toHaveValue('items');

    // Today's remaining point is the last one on the chart.
    const todayPoint = page.getByTestId(`chart-point-remaining-${TODAY_INDEX}`);
    await expect(todayPoint).toHaveAttribute('aria-label', `${chartLabel(isoDate(0))}: 3`);
    await shot(page, 'burndown-items-mode', { locator: card });

    await metric.selectOption('points');
    await expect(todayPoint).toHaveAttribute('aria-label', `${chartLabel(isoDate(0))}: 12`);
    await shot(page, 'burndown-story-points-mode', { locator: card });

    await metric.selectOption('items');
    await expect(todayPoint).toHaveAttribute('aria-label', `${chartLabel(isoDate(0))}: 3`);
  });
});
