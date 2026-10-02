import { render, screen } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';

const theme = vi.hoisted(() => ({ isDarkMode: false }));

vi.mock('../stores/theme.svelte.js', () => ({ themeStore: theme }));

import Lozenge from './Lozenge.svelte';
import { namedColorHex } from '../utils/colors.js';

afterEach(() => {
  theme.isDarkMode = false;
});

it('uses the canonical named color palette', () => {
  render(Lozenge, { props: { color: 'purple', text: 'Shared color' } });
  const lozenge = screen.getByText('Shared color');
  expect(lozenge).toHaveStyle(`border-color: ${namedColorHex.purple}`);
  expect(lozenge).toHaveStyle(`color: ${namedColorHex.purple}`);
});

it('resolves gray from the --ds-accent-gray token in both color modes', () => {
  render(Lozenge, { props: { color: 'gray', text: 'Open' } });
  const light = screen.getByText('Open').getAttribute('style');
  expect(light).toContain('var(--ds-accent-gray)');
  expect(light).not.toContain('#71717a');
  expect(light).not.toContain('#a1a1aa');
  expect(light).toContain('10%');

  theme.isDarkMode = true;
  render(Lozenge, { props: { color: 'gray', text: 'Open' } });
  const dark = screen.getAllByText('Open')[1].getAttribute('style');
  expect(dark).toContain('var(--ds-accent-gray)');
  expect(dark).toContain('19%');
});
