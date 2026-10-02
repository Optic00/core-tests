import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../stores/i18n.svelte.js', () => ({
  t: (key) => ({ 'common.enabled': 'Enabled', 'common.disabled': 'Disabled' })[key] ?? key,
}));

import EnabledStatus from './EnabledStatus.svelte';

afterEach(cleanup);

describe('EnabledStatus', () => {
  it('renders both enabled states through one component', async () => {
    const view = render(EnabledStatus, { enabled: true });
    expect(screen.getByText('Enabled')).toBeInTheDocument();

    await view.rerender({ enabled: false });
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });
});
