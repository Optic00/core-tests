import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api.js', () => ({
  api: {
    sla: {
      validateGoalQuery: vi.fn(),
    },
    queryLanguage: {
      getCatalog: vi.fn().mockResolvedValue({}),
      getValues: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock('../../stores/i18n.svelte.js', () => ({
  t: (key) => key,
}));

vi.mock('../../pickers/CategoryMultiSelect.svelte', () => ({ default: () => null }));
vi.mock('../shared/QlQueryBar.svelte', () => ({ default: () => null }));

import { api } from '../../api.js';
import SlaMetricEditor from './SlaMetricEditor.svelte';

const metric = {
  id: 1,
  name: 'First response',
  display_format: 'time',
  position: 0,
  is_active: true,
  conditions: [],
  goals: [
    {
      ql_query: 'priority = High',
      import_status: 'native',
      targets: [{ is_fallback: true, target_ms: 3600000, calendar_id: 1 }],
    },
  ],
};

const calendars = [{ id: 1, name: 'Support hours' }];

describe('SlaMetricEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks the save when a goal query is rejected by the parser', async () => {
    api.sla.validateGoalQuery.mockResolvedValue('Unexpected token');
    const onSave = vi.fn();

    render(SlaMetricEditor, { isOpen: true, metric, calendars, workspaceId: 5, onSave });

    await fireEvent.click(screen.getByTestId('sla-metric-submit'));

    await waitFor(() => expect(api.sla.validateGoalQuery).toHaveBeenCalledWith(5, 'priority = High'));
    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByTestId('sla-metric-error')).toBeTruthy();
  });

  it('saves the goal payload once every query parses', async () => {
    api.sla.validateGoalQuery.mockResolvedValue(null);
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(SlaMetricEditor, { isOpen: true, metric, calendars, workspaceId: 5, onSave });

    await fireEvent.click(screen.getByTestId('sla-metric-submit'));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const payload = onSave.mock.calls[0][0];
    expect(payload.name).toBe('First response');
    expect(payload.goals).toHaveLength(1);
    expect(payload.goals[0].ql_query).toBe('priority = High');
    expect(payload.goals[0].targets[0].calendar_id).toBe(1);
    expect(payload.goals[0].targets[0].target_ms).toBe(3600000);
  });
});
