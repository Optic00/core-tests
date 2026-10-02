import { describe, expect, it } from 'vitest';
import {
  parseScenarioSpec,
  flattenExamples,
  applyExampleRow,
  formatExampleRow,
} from './bddSpec.js';

const specJson = JSON.stringify({
  feature_name: 'Login',
  feature_tags: ['smoke'],
  scenario_keyword: 'Scenario Outline',
  scenario_name: 'valid credentials',
  steps: [{ keyword: 'Given', text: 'the <role> login page' }],
  examples: [
    {
      name: '',
      header: ['role'],
      rows: [['admin'], ['viewer']],
    },
  ],
});

describe('parseScenarioSpec', () => {
  it('parses a stored spec string', () => {
    const spec = parseScenarioSpec(specJson);
    expect(spec.scenario_name).toBe('valid credentials');
    expect(spec.steps).toHaveLength(1);
  });

  it('returns null for missing or malformed specs', () => {
    expect(parseScenarioSpec(null)).toBeNull();
    expect(parseScenarioSpec('')).toBeNull();
    expect(parseScenarioSpec('not json')).toBeNull();
    expect(parseScenarioSpec('{"steps": "nope"}')).toBeNull();
  });
});

describe('flattenExamples', () => {
  it('numbers example rows globally across blocks in document order', () => {
    const spec = parseScenarioSpec(specJson);
    const rows = flattenExamples({
      ...spec,
      examples: [
        { header: ['role'], rows: [['admin'], ['viewer']] },
        { name: 'edge', header: ['role'], rows: [['root']] },
      ],
    });
    expect(rows.map((row) => row.exampleIndex)).toEqual([0, 1, 2]);
    expect(rows[2].blockName).toBe('edge');
    expect(rows[0].header).toEqual(['role']);
  });

  it('returns an empty list without examples', () => {
    expect(flattenExamples({ steps: [] })).toEqual([]);
  });
});

describe('applyExampleRow', () => {
  it('substitutes placeholders from the example row', () => {
    expect(applyExampleRow('the <role> logs in', { role: 'admin' })).toBe('the admin logs in');
  });

  it('leaves unmatched placeholders untouched', () => {
    expect(applyExampleRow('the <role> logs in <other>', { role: 'admin' })).toBe(
      'the admin logs in <other>'
    );
  });
});

describe('formatExampleRow', () => {
  it('joins row values into a readable label', () => {
    expect(formatExampleRow({ role: 'admin', tier: 'free' })).toBe('role: admin, tier: free');
    expect(formatExampleRow(undefined)).toBe('');
  });
});
