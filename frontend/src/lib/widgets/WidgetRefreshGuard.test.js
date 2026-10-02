import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getItems: vi.fn(),
  getIterations: vi.fn(),
  getMilestones: vi.fn(),
  getProgressMany: vi.fn(),
}));

vi.mock('../api.js', () => ({
  api: {
    items: { getAll: mocks.getItems },
    iterations: { getAll: mocks.getIterations, getProgressMany: mocks.getProgressMany },
    milestones: { getAll: mocks.getMilestones },
  },
}));
vi.mock('../stores/i18n.svelte.js', () => ({ t: (key) => key }));

import IterationTimelineWidget from './IterationTimelineWidget.svelte';
import OverdueItemsWidget from './OverdueItemsWidget.svelte';
import UpcomingDeadlinesWidget from './UpcomingDeadlinesWidget.svelte';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getItems.mockResolvedValue({ data: [] });
  mocks.getIterations.mockResolvedValue([]);
  mocks.getMilestones.mockResolvedValue([]);
  mocks.getProgressMany.mockResolvedValue({});
});

afterEach(cleanup);

describe.each([
  ['iteration timeline', IterationTimelineWidget, 'widgets.iterationTimeline.refreshAriaLabel', mocks.getIterations],
  ['overdue items', OverdueItemsWidget, 'widgets.overdueItems.refreshAriaLabel', mocks.getItems],
  ['upcoming deadlines', UpcomingDeadlinesWidget, 'widgets.upcomingDeadlines.refreshAriaLabel', mocks.getItems],
])('%s refresh', (_name, Component, label, request) => {
  it('does not start a concurrent refresh while loading', async () => {
    let resolveRequest;
    request.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );
    render(Component, { props: { workspaceId: 7 } });
    await waitFor(() => expect(request).toHaveBeenCalledOnce());

    await fireEvent.click(screen.getByLabelText(label));
    expect(request).toHaveBeenCalledOnce();

    resolveRequest(request === mocks.getItems ? { data: [] } : []);
    await waitFor(() => expect(screen.getByLabelText(label)).toBeEnabled());
  });
});
