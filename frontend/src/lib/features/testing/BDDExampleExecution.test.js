import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api.js', () => ({
  api: {
    tests: {
      testRuns: {
        updateExampleResult: vi.fn(),
        updateExampleStepResult: vi.fn(),
      },
    },
  },
}));

vi.mock('../../stores/i18n.svelte.js', () => ({
  t: (key, vars) => (vars && 'n' in vars ? `${key}:${vars.n}` : key),
}));

import { api } from '../../api.js';
import BDDExampleExecution from './BDDExampleExecution.svelte';

const testCase = { id: 42, format: 'bdd' };
const snapshot = {
  test_case_id: 42,
  gherkin: 'Feature: Login',
  spec: JSON.stringify({
    scenario_keyword: 'Scenario Outline',
    scenario_name: 'valid credentials',
    background: [{ keyword: 'Given', text: 'a browser' }],
    steps: [{ keyword: 'When', text: 'the <role> logs in' }],
    examples: [{ name: '', header: ['role'], rows: [['admin'], ['viewer']] }],
  }),
};

function initialResults() {
  return [
    {
      run_id: 9,
      test_case_id: 42,
      example_index: 0,
      row_values: { role: 'admin' },
      status: 'not_run',
      actual_result: '',
      notes: '',
      step_results: [],
    },
    {
      run_id: 9,
      test_case_id: 42,
      example_index: 1,
      row_values: { role: 'viewer' },
      status: 'not_run',
      actual_result: '',
      notes: '',
      step_results: [],
    },
  ];
}

const onResultsChange = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('BDDExampleExecution', () => {
  it('renders one result card per example row with its row values', () => {
    render(BDDExampleExecution, {
      props: { workspaceId: 3, runId: 9, testCase, snapshot, initialResults: initialResults() },
    });
    const rows = screen.getAllByTestId('bdd-example-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('testing.exampleN:1');
    expect(rows[0].textContent).toContain('role: admin');
    expect(rows[1].textContent).toContain('testing.exampleN:2');
  });

  it('records an example status through the run endpoint', async () => {
    api.tests.testRuns.updateExampleResult.mockResolvedValue({});
    render(BDDExampleExecution, {
      props: {
        workspaceId: 3,
        runId: 9,
        testCase,
        snapshot,
        initialResults: initialResults(),
        onResultsChange,
      },
    });

    fireEvent.click(screen.getAllByTestId('bdd-example-status-passed')[0]);

    await waitFor(() =>
      expect(api.tests.testRuns.updateExampleResult).toHaveBeenCalledWith(3, 9, 42, 0, {
        status: 'passed',
      })
    );
    await waitFor(() => expect(onResultsChange).toHaveBeenCalled());
    const reported = onResultsChange.mock.calls.at(-1)[0];
    expect(reported.find((row) => row.example_index === 0).status).toBe('passed');
  });

  it('records a step status with the expanded example and background numbering', async () => {
    api.tests.testRuns.updateExampleStepResult.mockResolvedValue({});
    render(BDDExampleExecution, {
      props: { workspaceId: 3, runId: 9, testCase, snapshot, initialResults: initialResults() },
    });

    // Expand the first example, then pass background step #1.
    fireEvent.click(screen.getAllByTestId('bdd-toggle-steps')[0]);
    const stepButtons = screen.getAllByTestId('bdd-step-status-passed');
    expect(stepButtons.length).toBeGreaterThanOrEqual(2); // background + scenario step
    fireEvent.click(stepButtons[0]);

    await waitFor(() =>
      expect(api.tests.testRuns.updateExampleStepResult).toHaveBeenCalledWith(
        3,
        9,
        42,
        0,
        1,
        { status: 'passed', item_id: null }
      )
    );
  });

  it('commits notes on blur while keeping the current status', async () => {
    api.tests.testRuns.updateExampleResult.mockResolvedValue({});
    render(BDDExampleExecution, {
      props: {
        workspaceId: 3,
        runId: 9,
        testCase,
        snapshot,
        initialResults: initialResults().map((row, i) =>
          i === 0 ? { ...row, status: 'failed' } : row
        ),
      },
    });

    const notes = screen.getAllByTestId('bdd-example-notes')[0];
    fireEvent.input(notes, { target: { value: 'console error on submit' } });
    fireEvent.blur(notes);

    await waitFor(() =>
      expect(api.tests.testRuns.updateExampleResult).toHaveBeenCalledWith(3, 9, 42, 0, {
        notes: 'console error on submit',
        status: 'failed',
        actual_result: '',
      })
    );
  });
});
