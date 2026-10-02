import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api.js', () => ({
  api: {
    sla: {
      getMetrics: vi.fn(),
      getAvailableCalendars: vi.fn(),
      createMetric: vi.fn(),
      updateMetric: vi.fn(),
      deleteMetric: vi.fn(),
    },
    statuses: { getAll: vi.fn() },
    statusCategories: { getAll: vi.fn() },
    priorities: { getAll: vi.fn() },
  },
}));

vi.mock('../../stores/i18n.svelte.js', () => ({
  t: (key) => key,
}));

vi.mock('../../stores/toasts.svelte.js', () => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock('../../composables/useConfirm.js', () => ({
  confirm: vi.fn().mockResolvedValue(false),
}));

import { api } from '../../api.js';
import SlaMetricsTab from './SlaMetricsTab.svelte';

const metrics = [
  {
    id: 1,
    name: 'First response',
    display_format: 'time',
    position: 0,
    is_active: true,
    conditions: [{ phase: 'start', position: 0, condition_type: 'created', config: {} }],
    goals: [],
  },
];

describe('SlaMetricsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.sla.getMetrics.mockResolvedValue(metrics);
    api.sla.getAvailableCalendars.mockResolvedValue([]);
    api.sla.updateMetric.mockResolvedValue(metrics[0]);
    api.statuses.getAll.mockResolvedValue([]);
    api.statusCategories.getAll.mockResolvedValue([]);
    api.priorities.getAll.mockResolvedValue([]);
  });

  it('lists metrics for the workspace', async () => {
    render(SlaMetricsTab, { workspaceId: 5 });

    await waitFor(() => expect(api.sla.getMetrics).toHaveBeenCalledWith(5));
    expect(await screen.findByTestId('sla-metric-row-1')).toBeTruthy();
    expect(screen.getByText('First response')).toBeTruthy();
  });

  it('ignores metrics from a previous workspace after switching workspaces', async () => {
    let resolveFirst;
    api.sla.getMetrics
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce([{ ...metrics[0], id: 2, name: 'Second workspace metric' }]);
    const view = render(SlaMetricsTab, { workspaceId: 5 });
    await waitFor(() => expect(api.sla.getMetrics).toHaveBeenCalledWith(5));

    await view.rerender({ workspaceId: 6 });
    expect(await screen.findByText('Second workspace metric')).toBeTruthy();
    resolveFirst([{ ...metrics[0], name: 'Stale workspace metric' }]);

    await Promise.resolve();
    expect(screen.queryByText('Stale workspace metric')).toBeNull();
    expect(screen.getByText('Second workspace metric')).toBeTruthy();
  });

  it('persists an active-toggle change through the metric payload', async () => {
    render(SlaMetricsTab, { workspaceId: 5 });
    await screen.findByTestId('sla-metric-row-1');

    await fireEvent.click(screen.getByTestId('sla-metric-active-toggle-1'));

    await waitFor(() => expect(api.sla.updateMetric).toHaveBeenCalled());
    const [workspaceArg, metricID, payload] = api.sla.updateMetric.mock.calls[0];
    expect(workspaceArg).toBe(5);
    expect(metricID).toBe(1);
    expect(payload.is_active).toBe(false);
    expect(payload.name).toBe('First response');
    expect(payload.conditions).toHaveLength(1);
  });
});
