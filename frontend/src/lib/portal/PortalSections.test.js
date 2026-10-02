import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sections: [],
  reports: [],
  manage: false,
}));

vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  dropTargetForElements: vi.fn(() => () => {}),
}));

vi.mock('../composables/useConfirm.js', () => ({
  confirm: vi.fn(),
}));

vi.mock('../stores/portalPresentation.js', () => ({
  iconMap: {},
}));

vi.mock('../stores/i18n.svelte.js', () => ({
  t: (key) => key,
}));

vi.mock('../stores/portal.svelte.js', () => ({
  portalCustomizationStore: {
    get isEditing() {
      return mocks.manage;
    },
    get showCustomizePanel() {
      return false;
    },
    get activeSection() {
      return null;
    },
    isDarkMode: false,
  },
  portalCatalogStore: {
    get portalSections() {
      return mocks.sections;
    },
    getSectionRequestTypes: () => [],
    getSectionAssetReports: (section, inCustomizeMode) =>
      inCustomizeMode ? mocks.reports : mocks.reports.filter((r) => r.is_active !== false),
    draggedRequestType: null,
    draggedAssetReport: null,
    moveSectionUp: vi.fn(),
    moveSectionDown: vi.fn(),
    deleteSection: vi.fn(),
    removeAssetReportFromSection: vi.fn(),
    removeRequestTypeFromSection: vi.fn(),
    addAssetReportToSection: vi.fn(),
    addRequestTypeToSection: vi.fn(),
  },
}));

import PortalSections from './PortalSections.svelte';

describe('PortalSections form asset report cards', () => {
  beforeEach(() => {
    mocks.manage = false;
    mocks.sections = [
      { id: 'sec-1', title: 'Resources', subtitle: '', asset_report_ids: [10], request_type_ids: [] },
    ];
  });

  it('does not badge a public form report whose payload omits is_active', () => {
    mocks.reports = [{ id: 10, name: 'Audience lookup', run_mode: 'form', column_config: [] }];

    render(PortalSections);

    expect(screen.getByText('Audience lookup')).toBeInTheDocument();
    expect(screen.queryByText('INACTIVE')).not.toBeInTheDocument();
  });

  it('badges a form report explicitly marked inactive in management mode', () => {
    mocks.manage = true;
    mocks.reports = [
      { id: 10, name: 'Retired lookup', run_mode: 'form', is_active: false, column_config: [] },
    ];

    render(PortalSections);

    expect(screen.getByText('Retired lookup')).toBeInTheDocument();
    expect(screen.getByText('INACTIVE')).toBeInTheDocument();
  });
});
