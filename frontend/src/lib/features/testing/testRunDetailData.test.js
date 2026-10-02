import { describe, expect, it, vi } from 'vitest';
import { loadTestRunDetail } from './testRunDetailData.js';

describe('test run detail request graph', () => {
  it('loads and normalizes the complete run graph with one API request', async () => {
    const apiClient = {
      tests: {
        testRuns: {
          getDetail: vi.fn().mockResolvedValue({
            run: { id: 9, set_id: 4 },
            test_cases: [{ id: 1, test_steps: [{ id: 11 }] }, { id: 2 }],
            results: [{ id: 21, test_case_id: 1 }],
            step_results: [{ test_case_id: 1, step_id: 11, status: 'passed' }],
            bdd_snapshots: [{ test_case_id: 2, gherkin: 'Feature: …', spec: '{}' }],
            example_results: [
              { run_id: 9, test_case_id: 2, example_index: 0, status: 'passed' },
              { run_id: 9, test_case_id: 2, example_index: 1, status: 'not_run' },
            ],
          }),
          get: vi.fn(),
          getResults: vi.fn(),
          getStepResults: vi.fn(),
        },
        testPlans: {
          get: vi.fn(),
          getTestCases: vi.fn(),
        },
        testCases: { steps: { getAll: vi.fn() } },
      },
    };

    const detail = await loadTestRunDetail(apiClient, 3, 9);

    expect(apiClient.tests.testRuns.getDetail).toHaveBeenCalledOnce();
    expect(apiClient.tests.testRuns.getDetail).toHaveBeenCalledWith(3, 9);
    expect(apiClient.tests.testRuns.get).not.toHaveBeenCalled();
    expect(apiClient.tests.testRuns.getResults).not.toHaveBeenCalled();
    expect(apiClient.tests.testRuns.getStepResults).not.toHaveBeenCalled();
    expect(apiClient.tests.testPlans.get).not.toHaveBeenCalled();
    expect(apiClient.tests.testPlans.getTestCases).not.toHaveBeenCalled();
    expect(apiClient.tests.testCases.steps.getAll).not.toHaveBeenCalled();
    expect(detail).toEqual({
      run: { id: 9, set_id: 4 },
      testCases: [
        { id: 1, test_steps: [{ id: 11 }] },
        { id: 2, test_steps: [] },
      ],
      results: [{ id: 21, test_case_id: 1 }],
      stepResults: { '1_11': { test_case_id: 1, step_id: 11, status: 'passed' } },
      bddSnapshots: { 2: { test_case_id: 2, gherkin: 'Feature: …', spec: '{}' } },
      bddExampleResults: [
        { run_id: 9, test_case_id: 2, example_index: 0, status: 'passed' },
        { run_id: 9, test_case_id: 2, example_index: 1, status: 'not_run' },
      ],
    });
  });

  it('rejects an incomplete aggregate response', async () => {
    const apiClient = {
      tests: { testRuns: { getDetail: vi.fn().mockResolvedValue({}) } },
    };

    await expect(loadTestRunDetail(apiClient, 3, 9)).rejects.toThrow('Test run not found');
  });
});
