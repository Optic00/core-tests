import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => ({
  api: {
    jiraImport: {
      analyzeProjects: vi.fn(),
      testConnection: vi.fn(),
      startImport: vi.fn(),
      getJobStatus: vi.fn(),
      getProjectCounts: vi.fn().mockResolvedValue({ APP: 2 }),
      getProjects: vi
        .fn()
        .mockResolvedValue([{ id: '1', key: 'APP', name: 'Application', is_team_managed: false }]),
    },
  },
}));

import { api } from '../api.js';
import { jiraImport } from './JiraImportStore.svelte.js';

const baseAnalysis = {
  projects: [{ key: 'APP', name: 'Application', issue_count: 2 }],
  issue_types: [],
  statuses: [],
  custom_fields: [],
  versions: [],
  total_issues: 2,
};

describe('Jira Data Center authentication', () => {
  beforeEach(() => {
    jiraImport.reset();
    vi.clearAllMocks();
    api.jiraImport.testConnection.mockResolvedValue({
      connection_id: 'connection-dc',
      instance_info: { display_name: 'Example Jira' },
    });
  });

  it('submits a PAT without a username for Data Center connections', async () => {
    const result = await jiraImport.testConnection(
      'https://jira.example.com',
      'stale-user@example.com',
      'data-center-pat',
      'datacenter'
    );

    expect(result).toEqual({ success: true });
    expect(api.jiraImport.testConnection).toHaveBeenCalledWith({
      instance_url: 'https://jira.example.com',
      email: '',
      api_token: 'data-center-pat',
      deployment_type: 'datacenter',
    });
    expect(jiraImport.connection.email).toBe('');
  });
});

async function prepareSelectedProject() {
  jiraImport.useSavedConnection({
    id: 'connection-1',
    instance_url: 'https://example.atlassian.net',
    email: 'admin@example.com',
    deployment_type: 'cloud',
  });
  await jiraImport.loadProjects();
  jiraImport.toggleProject('APP');
}

describe('Jira import Xray wizard step', () => {
  beforeEach(() => {
    jiraImport.reset();
    vi.clearAllMocks();
    api.jiraImport.getProjects.mockResolvedValue([
      { id: '1', key: 'APP', name: 'Application', is_team_managed: false },
    ]);
    api.jiraImport.getProjectCounts.mockResolvedValue({ APP: 2 });
  });

  it('inserts the Xray step only after positive Xray detection', async () => {
    api.jiraImport.analyzeProjects.mockResolvedValue({
      ...baseAnalysis,
      xray: {
        detection_status: 'detected',
        requires_credential: true,
        total_tests: 2,
        test_issue_type_ids: ['10001'],
      },
    });
    await prepareSelectedProject();

    await jiraImport.analyzeProjects();

    expect(jiraImport.wizard.steps.map((step) => step.id)).toEqual([
      'connect',
      'projects',
      'xray',
      'mapping',
      'preview',
      'import',
    ]);
    expect(jiraImport.xray.totalTests).toBe(2);
  });

  it('does not insert the Xray step for same-named non-Xray issue types', async () => {
    api.jiraImport.analyzeProjects.mockResolvedValue({
      ...baseAnalysis,
      xray: {
        detection_status: 'not_detected',
        requires_credential: true,
        total_tests: 0,
      },
    });
    await prepareSelectedProject();

    await jiraImport.analyzeProjects();

    expect(jiraImport.wizard.steps.map((step) => step.id)).toEqual([
      'connect',
      'projects',
      'mapping',
      'preview',
      'import',
    ]);
  });
});

describe('Jira import workspace key collisions', () => {
  beforeEach(() => {
    jiraImport.reset();
    vi.clearAllMocks();
    api.jiraImport.getProjects.mockResolvedValue([
      { id: '1', key: 'APP', name: 'Application', is_team_managed: false },
    ]);
    api.jiraImport.getProjectCounts.mockResolvedValue({ APP: 2 });
  });

  it('uses the suggested alias and blocks the mapping step until it is acknowledged', async () => {
    api.jiraImport.analyzeProjects.mockResolvedValue({
      ...baseAnalysis,
      projects: [
        {
          key: 'APP',
          name: 'Application',
          issue_count: 2,
          workspace_key_collision: true,
          suggested_workspace_key: 'JIRA_APP',
        },
      ],
      xray: {
        detection_status: 'not_detected',
        total_tests: 0,
      },
    });
    await prepareSelectedProject();
    await jiraImport.analyzeProjects();
    jiraImport.goToStepId('mapping');

    expect(jiraImport.mappings.workspaces[0]).toMatchObject({
      jiraKey: 'APP',
      newWorkspaceKey: 'JIRA_APP',
      workspaceKeyCollisionFound: true,
      keyAliasAcknowledged: false,
    });
    expect(jiraImport.canProceed()).toBe(false);

    jiraImport.setWorkspaceKeyAliasAcknowledged('APP', true);

    expect(jiraImport.mappings.workspaces[0].keyAliasAcknowledged).toBe(true);
    expect(jiraImport.canProceed()).toBe(true);
  });
});

describe('Jira import custom-field fidelity', () => {
  beforeEach(() => {
    jiraImport.reset();
    vi.clearAllMocks();
    api.jiraImport.getProjects.mockResolvedValue([
      { id: '1', key: 'APP', name: 'Application', is_team_managed: false },
    ]);
    api.jiraImport.getProjectCounts.mockResolvedValue({ APP: 2 });
  });

  it('retains the backend raw-preservation disposition in the import plan', async () => {
    api.jiraImport.analyzeProjects.mockResolvedValue({
      ...baseAnalysis,
      custom_fields: [
        {
          jira_field_id: 'customfield_10031',
          jira_field_name: 'Persona payload',
          jira_field_type: 'vendor.app:persona',
          windshift_field_type: 'textarea',
          can_map: true,
          preserve_raw: true,
          notes: 'App-owned value will be preserved as JSON text.',
        },
      ],
      xray: {
        detection_status: 'not_detected',
        total_tests: 0,
      },
    });
    await prepareSelectedProject();
    await jiraImport.analyzeProjects();

    expect(jiraImport.mappings.customFields[0]).toMatchObject({
      jiraId: 'customfield_10031',
      windshiftType: 'textarea',
      preserveRaw: true,
      action: 'create',
    });
  });
});

describe('Jira team-managed project selection', () => {
  beforeEach(() => {
    jiraImport.reset();
    vi.clearAllMocks();
    api.jiraImport.getProjects.mockResolvedValue([
      { id: '1', key: 'APP', name: 'Application', is_team_managed: false },
      { id: '2', key: 'TEAM', name: 'Team project', is_team_managed: true },
    ]);
    api.jiraImport.getProjectCounts.mockResolvedValue({ APP: 2, TEAM: 3 });
  });

  it('includes team-managed projects in select all', async () => {
    jiraImport.useSavedConnection({
      id: 'connection-1',
      instance_url: 'https://example.atlassian.net',
      email: 'admin@example.com',
      deployment_type: 'cloud',
    });
    await jiraImport.loadProjects();

    jiraImport.selectAllProjects();

    expect(jiraImport.projects.selected).toEqual(['APP', 'TEAM']);
  });
});

describe('Jira forced re-import', () => {
  beforeEach(() => {
    jiraImport.reset();
    vi.clearAllMocks();
    api.jiraImport.getProjects.mockResolvedValue([
      { id: '1', key: 'APP', name: 'Application', is_team_managed: false },
    ]);
    api.jiraImport.getProjectCounts.mockResolvedValue({ APP: 2 });
    api.jiraImport.startImport.mockResolvedValue({ job_id: 'job-reimport' });
    api.jiraImport.getJobStatus.mockResolvedValue({
      status: 'completed',
      phase: 'completed',
      progress: {},
    });
  });

  it('sends an explicit force_reimport flag only for the update path', async () => {
    await prepareSelectedProject();

    await jiraImport.startImport(true);

    expect(api.jiraImport.startImport).toHaveBeenCalledOnce();
    expect(api.jiraImport.startImport.mock.calls[0][0]).toMatchObject({
      connection_id: 'connection-1',
      project_keys: ['APP'],
      force_reimport: true,
    });
  });
});

describe('Jira partial import completion', () => {
  beforeEach(() => {
    jiraImport.reset();
    vi.clearAllMocks();
    api.jiraImport.getProjects.mockResolvedValue([
      { id: '1', key: 'APP', name: 'Application', is_team_managed: false },
    ]);
    api.jiraImport.getProjectCounts.mockResolvedValue({ APP: 2 });
    api.jiraImport.startImport.mockResolvedValue({ job_id: 'job-partial' });
    api.jiraImport.getJobStatus.mockResolvedValue({
      status: 'completed_with_errors',
      phase: 'completed_with_errors',
      progress: { imported_issues: 1, failed_issues: 1 },
    });
  });

  it('stops polling and exposes completed-with-errors as a result', async () => {
    await prepareSelectedProject();

    await jiraImport.startImport();

    await vi.waitFor(() => {
      expect(jiraImport.import.result?.status).toBe('completed_with_errors');
    });
    expect(jiraImport.import.error).toBeNull();
    expect(jiraImport.wizard.steps.find((step) => step.id === 'import')?.completed).toBe(true);
  });
});
