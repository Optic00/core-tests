import { describe, expect, it } from 'vitest';
import { ADMIN_COMPONENT_LOADERS } from './adminComponentRoutes.js';
import { adminGroups } from './adminNavigation.js';

describe('admin component route splitting', () => {
  it('provides a lazy loader for every built-in admin navigation item', () => {
    const tabIds = adminGroups.flatMap((group) => group.items.map((item) => item.id));

    for (const tabId of tabIds) {
      expect(ADMIN_COMPONENT_LOADERS[tabId], tabId).toBeTypeOf('function');
    }
  });

  it.each([
    'permission-set-detail',
    'configuration-set-detail',
    'condition-set-detail',
    'approval-set-detail',
    'form-channel',
    'portal-channel',
  ])('provides a lazy loader for nested route %s', (routeKey) => {
    expect(ADMIN_COMPONENT_LOADERS[routeKey]).toBeTypeOf('function');
  });
});
