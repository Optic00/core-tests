import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

vi.mock('../../stores/i18n.svelte.js', () => ({
  t: (key) => key,
}));

import BDDScenarioView from './BDDScenarioView.svelte';

const spec = {
  feature_name: 'Login',
  feature_tags: ['smoke'],
  background: [{ keyword: 'Given', text: 'a fresh browser' }],
  scenario_keyword: 'Scenario Outline',
  scenario_name: 'valid credentials',
  scenario_tags: ['regression'],
  steps: [
    { keyword: 'When', text: 'the <role> submits valid credentials' },
    { keyword: 'Then', text: 'the dashboard is shown' },
  ],
  examples: [
    { name: 'standard', header: ['role'], rows: [['admin'], ['viewer']] },
    { name: '', header: ['role'], rows: [['root']] },
  ],
};

describe('BDDScenarioView', () => {
  it('renders the feature context, scenario, and steps', () => {
    render(BDDScenarioView, { props: { spec } });

    expect(screen.getByTestId('bdd-scenario-view').textContent).toContain('Login');
    expect(screen.getByTestId('bdd-scenario-view').textContent).toContain('Scenario Outline');
    expect(screen.getByTestId('bdd-scenario-view').textContent).toContain('valid credentials');
    const steps = screen.getByTestId('bdd-steps');
    expect(steps.textContent).toContain('When');
    expect(steps.textContent).toContain('the <role> submits valid credentials');
  });

  it('renders every examples block with its rows', () => {
    render(BDDScenarioView, { props: { spec } });
    const blocks = screen.getAllByTestId('bdd-examples-block');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].textContent).toContain('standard');
    expect(blocks[0].textContent).toContain('admin');
    expect(blocks[1].textContent).toContain('root');
  });

  it('toggles to the raw feature source and back', async () => {
    render(BDDScenarioView, { props: { spec, raw: 'Feature: Login\n  Scenario Outline: valid credentials' } });

    fireEvent.click(screen.getByTestId('bdd-toggle-raw'));
    expect(screen.getByTestId('bdd-scenario-view').textContent).toContain('Scenario Outline: valid credentials');
    expect(screen.queryByTestId('bdd-steps')).toBeNull();

    fireEvent.click(screen.getByTestId('bdd-toggle-raw'));
    expect(screen.getByTestId('bdd-steps')).toBeTruthy();
  });
});
