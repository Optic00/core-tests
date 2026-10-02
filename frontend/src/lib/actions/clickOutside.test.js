import { afterEach, describe, expect, it, vi } from 'vitest';
import { clickOutside } from './clickOutside.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('clickOutside', () => {
  it('dispatches only for outside clicks and removes its listener', () => {
    const node = document.createElement('div');
    const child = document.createElement('button');
    node.appendChild(child);
    document.body.appendChild(node);
    const listener = vi.fn();
    node.addEventListener('clickOutside', listener);
    const action = clickOutside(node);

    child.click();
    expect(listener).not.toHaveBeenCalled();
    document.body.click();
    expect(listener).toHaveBeenCalledOnce();

    action.destroy();
    document.body.click();
    expect(listener).toHaveBeenCalledOnce();
  });
});
