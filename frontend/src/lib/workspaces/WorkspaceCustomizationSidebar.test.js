import { render } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import WorkspaceCustomizationSidebar from './WorkspaceCustomizationSidebar.svelte';

describe('WorkspaceCustomizationSidebar', () => {
  it('preserves the workspace drag-card contract', () => {
    const { container } = render(WorkspaceCustomizationSidebar, {
      isOpen: true,
      activeCategory: 'built-in',
    });

    const widget = container.querySelector('[data-widget-type][data-widget-card]');
    expect(widget).not.toBeNull();
  });
});
