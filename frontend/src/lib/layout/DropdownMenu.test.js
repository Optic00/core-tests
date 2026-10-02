import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import DropdownMenu from './DropdownMenu.svelte';

describe('DropdownMenu selected items', () => {
  it('keeps labels aligned and places the selected checkmark after the label', () => {
    render(DropdownMenu, {
      props: {
        isOpen: true,
        triggerText: 'Width',
        items: [
          { id: 'third', title: 'Third', onClick: () => {} },
          { id: 'two-thirds', title: 'Two-thirds', selected: true, onClick: () => {} },
          { id: 'full', title: 'Full', onClick: () => {} },
        ],
      },
    });

    const menu = screen.getByRole('menu');
    const items = [...menu.querySelectorAll('[data-menu-item]')];

    expect(items).toHaveLength(3);
    expect(items.map((item) => item.firstElementChild.className)).toEqual([
      'flex-1 text-left',
      'flex-1 text-left',
      'flex-1 text-left',
    ]);
    expect(items[1].lastElementChild.tagName).toBe('svg');
    expect(items[0].lastElementChild.tagName).toBe('DIV');
    expect(items[2].lastElementChild.tagName).toBe('DIV');
  });
});
