import { render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api.js', () => ({
  api: {
    sla: { getCoveragePreview: vi.fn() },
  },
}));

vi.mock('../../stores/i18n.svelte.js', () => ({
  t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));

import { api } from '../../api.js';
import WorkingCalendarEditor from './WorkingCalendarEditor.svelte';

const workspaceCalendar = {
  id: 3,
  workspace_id: 5,
  name: 'Support hours',
  timezone: 'UTC',
  weekly_intervals: { monday: [{ start: '09:00', end: '17:00' }] },
  holidays: [],
};

describe('WorkingCalendarEditor coverage preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the coverage comparison for a workspace-owned calendar', async () => {
    api.sla.getCoveragePreview.mockResolvedValue({
      reference: 'team_service_hours',
      sla_weekly_ms: 604800000,
      team_weekly_ms: 172800000,
      overlap_weekly_ms: 172800000,
      discrepancy: 'sla_wider',
    });

    render(WorkingCalendarEditor, {
      isOpen: true,
      calendar: workspaceCalendar,
      workspaceId: 5,
      onSave: vi.fn(),
    });

    await waitFor(() => expect(api.sla.getCoveragePreview).toHaveBeenCalledWith(5, 3));
    expect(await screen.findByTestId('sla-calendar-coverage')).toBeTruthy();
  });

  it('does not request coverage for a team-owned calendar', async () => {
    render(WorkingCalendarEditor, {
      isOpen: true,
      calendar: { ...workspaceCalendar, workspace_id: null, team_id: 7 },
      workspaceId: 5,
      onSave: vi.fn(),
    });

    await Promise.resolve();
    expect(api.sla.getCoveragePreview).not.toHaveBeenCalled();
  });
});
