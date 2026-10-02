import { describe, expect, it } from 'vitest';
import { transitionFromLabel } from './transitionLabels.js';

describe('transitionFromLabel', () => {
  it('uses the from status name for directed transitions', () => {
    expect(
      transitionFromLabel({ from_all_statuses: false, from_status_name: 'Open' }),
    ).toBe('Open');
  });

  it('labels from-all transitions as "Any status"', () => {
    expect(
      transitionFromLabel({
        from_all_statuses: true,
        from_status_name: '',
        from_status_id: null,
      }),
    ).toBe('Any status');
  });

  it('labels initial transitions as "Initial"', () => {
    expect(
      transitionFromLabel({
        from_all_statuses: false,
        from_status_name: '',
        from_status_id: null,
      }),
    ).toBe('Initial');
  });
});
