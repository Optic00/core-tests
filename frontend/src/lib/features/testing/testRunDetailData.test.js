import { describe, expect, it, vi } from 'vitest';
import { loadTestRunDetail } from './testRunDetailData.js';

describe('test run detail request graph', () => {
  it('loads and normalizes the complete run graph with one API request', async () => {
    const apiClient = {
      tests: {
        testRuns: {
          getDetail: vi.fn().mockResolvedValue({
            run: { id: 9, plan_id: 4 },
            test_cases: [
              { id: 1, test_steps: [{ id: 11 }] },
              { id: 2, test_steps: [{ id: 12 }] },
              { id: 3 },
            ],
            results: [{ id: 21, test_case_id: 1 }],
            step_results: [
              { test_case_id: 1, step_id: 11, status: 'passed' },
              { test_case_id: 2, step_id: 12, status: 'failed' },
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
      run: { id: 9, plan_id: 4 },
      testCases: [
        { id: 1, test_steps: [{ id: 11 }] },
        { id: 2, test_steps: [{ id: 12 }] },
        { id: 3, test_steps: [] },
      ],
      results: [{ id: 21, test_case_id: 1 }],
      stepResults: {
        '1_11': { test_case_id: 1, step_id: 11, status: 'passed' },
        '2_12': { test_case_id: 2, step_id: 12, status: 'failed' },
      },
    });
  });

  it('rejects an incomplete aggregate response', async () => {
    const apiClient = {
      tests: { testRuns: { getDetail: vi.fn().mockResolvedValue({}) } },
    };

    await expect(loadTestRunDetail(apiClient, 3, 9)).rejects.toThrow('Test run not found');
  });

  it('normalizes missing optional graph lists without additional requests', async () => {
    const getDetail = vi.fn().mockResolvedValue({ run: { id: 9, plan_id: 4 } });
    const apiClient = { tests: { testRuns: { getDetail } } };
    await expect(loadTestRunDetail(apiClient, 3, 9)).resolves.toEqual({
      run: { id: 9, plan_id: 4 },
      testCases: [],
      results: [],
      stepResults: {},
    });
    expect(getDetail).toHaveBeenCalledExactlyOnceWith(3, 9);
  });

  it('propagates a failed aggregate request', async () => {
    const failure = new Error('Run unavailable');
    const getDetail = vi.fn().mockRejectedValue(failure);
    const apiClient = { tests: { testRuns: { getDetail } } };
    await expect(loadTestRunDetail(apiClient, 3, 9)).rejects.toBe(failure);
    expect(getDetail).toHaveBeenCalledExactlyOnceWith(3, 9);
  });
});
