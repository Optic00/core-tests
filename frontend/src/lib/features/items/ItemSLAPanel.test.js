import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api.js', () => ({
  api: {
    sla: { getItemSLA: vi.fn() },
  },
}));

vi.mock('../../stores/i18n.svelte.js', () => ({
  t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));

vi.mock('../../utils/dateFormatter.js', () => ({
  formatInstant: (_value, timezone, options) => `${timezone} ${options.hour}:${options.minute}`,
}));

import { api } from '../../api.js';
import ItemSLAPanel from './ItemSLAPanel.svelte';

const stateWithCycle = [
  {
    metric_id: 1,
    metric_name: 'First response',
    display_format: 'time',
    recalculating: false,
    ongoing: {
      cycle_no: 1,
      breached: true,
      paused: false,
      within_calendar_hours: true,
      elapsed_ms: 7200000,
      goal_duration_ms: 3600000,
      remaining_ms: -3600000,
      coverage: {
        reference: 'team_service_hours',
        discrepancy: 'sla_wider',
        note: 'sla_outside_team_service_hours',
      },
    },
    completed: [{ cycle_no: 1, elapsed_ms: 100, breached: true }],
  },
];

describe('ItemSLAPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides itself when the item has no SLA cycles', async () => {
    api.sla.getItemSLA.mockResolvedValue([]);
    render(ItemSLAPanel, { itemId: 42 });

    await waitFor(() => expect(api.sla.getItemSLA).toHaveBeenCalledWith(42));
    expect(screen.queryByTestId('item-sla-panel')).toBeNull();
  });

  it('renders the ongoing cycle with breach state and completed history', async () => {
    api.sla.getItemSLA.mockResolvedValue(stateWithCycle);
    render(ItemSLAPanel, { itemId: 42 });

    expect(await screen.findByTestId('item-sla-panel')).toBeTruthy();
    expect(screen.getByTestId('item-sla-metric-1')).toBeTruthy();
    expect(screen.getByText('First response')).toBeTruthy();
    // Breached badge appears on both the ongoing and completed cycle.
    expect(screen.getAllByText('items.sla.breached').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('item-sla-coverage-1')).toBeTruthy();
  });

  it('shows an explicit outside-hours state independently of pause state', async () => {
    api.sla.getItemSLA.mockResolvedValue([
      {
        ...stateWithCycle[0],
        ongoing: { ...stateWithCycle[0].ongoing, breached: false, within_calendar_hours: false },
      },
    ]);
    render(ItemSLAPanel, { itemId: 42 });

    expect(await screen.findByText('items.sla.outsideHours')).toBeTruthy();
    expect(screen.queryByText('items.sla.withinHours')).toBeNull();
    expect(screen.queryByText('items.sla.paused')).toBeNull();
  });

  it('renders due-date deadlines with the calendar timezone and time', async () => {
    api.sla.getItemSLA.mockResolvedValue([
      {
        ...stateWithCycle[0],
        display_format: 'due_date',
        ongoing: {
          ...stateWithCycle[0].ongoing,
          breached: false,
          next_deadline_at: '2026-09-28T09:00:00Z',
          calendar_timezone: 'Asia/Tokyo',
        },
      },
    ]);
    render(ItemSLAPanel, { itemId: 42 });

    expect(await screen.findByText(/Asia\/Tokyo numeric:2-digit/)).toBeTruthy();
  });

  it('reloads when item mutations fire refresh-work-items', async () => {
    api.sla.getItemSLA.mockResolvedValue(stateWithCycle);
    render(ItemSLAPanel, { itemId: 42 });
    await screen.findByTestId('item-sla-panel');

    api.sla.getItemSLA.mockClear();
    window.dispatchEvent(new CustomEvent('refresh-work-items'));

    await waitFor(() => expect(api.sla.getItemSLA).toHaveBeenCalledWith(42));
  });
});
