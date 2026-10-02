import { cleanup, render, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../stores/i18n.svelte.js', async (importOriginal) => ({
  ...(await importOriginal()),
  t: (key) => key,
}));

import DashboardCustomizationSidebar from './DashboardCustomizationSidebar.svelte';

afterEach(cleanup);

describe('DashboardCustomizationSidebar', () => {
  it('shows the widget name and description in its draggable card', () => {
    const { container } = render(DashboardCustomizationSidebar, {
      isOpen: true,
      activeCategory: 'activity',
    });

    const dailyBriefing = container.querySelector('[data-widget-type="daily-briefing"]');
    expect(dailyBriefing).not.toBeNull();
    expect(dailyBriefing).toHaveAttribute('data-dashboard-widget-card');
    expect(
      within(dailyBriefing).getByText('dashboard.widgetCatalog.dailyBriefing.name')
    ).toBeInTheDocument();
    expect(
      within(dailyBriefing).getByText('dashboard.widgetCatalog.dailyBriefing.description')
    ).toBeInTheDocument();
  });
});
