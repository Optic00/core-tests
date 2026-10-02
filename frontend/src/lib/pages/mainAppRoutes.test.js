import { describe, expect, test } from 'vitest';

import {
  getMainAppRouteProps,
  MAIN_APP_COMPONENT_LOADERS,
  MAIN_APP_TEST_VIEWS,
  resolveMainAppRoute,
} from './mainAppRoutes.js';

describe('test-management page routes', () => {
  test('every recognized test view resolves to a loadable page', () => {
    for (const view of MAIN_APP_TEST_VIEWS) {
      const route = resolveMainAppRoute(view);

      expect(route.config, `${view} has no route configuration`).toBeTruthy();
      expect(MAIN_APP_COMPONENT_LOADERS[route.key], `${view} has no component loader`).toBeTypeOf(
        'function'
      );
    }
  });

  test('test-case detail receives its workspace, case, and report origin', () => {
    const props = getMainAppRouteProps('test-case-detail', {
      params: { id: '12', testId: '34' },
      query: { from: 'reports' },
    });

    expect(props).toEqual({ workspaceId: '12', testCaseId: '34', from: 'reports' });
  });
});

describe('top-level page route splitting', () => {
  test.each([
    'workspaces',
    'workspace-settings-general',
    'collections-list',
    'collections-edit',
    'channels',
    'hub',
    'organizations',
    'teams-list',
    'team-detail',
    'notifications',
    'approvals-inbox',
    'search',
    'profile',
    'security',
    'about',
    'api-docs',
    'cli-authorize',
    'oauth-authorize',
    '404',
  ])('%s resolves through a route-level loader', (view) => {
    const route = resolveMainAppRoute(view);

    expect(route.config).toBeTruthy();
    expect(MAIN_APP_COMPONENT_LOADERS[route.key]).toBeTypeOf('function');
  });
});
