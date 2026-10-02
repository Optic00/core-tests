import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SidebarResizeHandleHarness from './SidebarResizeHandleHarness.svelte';

afterEach(() => {
  cleanup();
  document.body.classList.remove('sidebar-resize-active');
});

describe('SidebarResizeHandle', () => {
  it('captures pointer resizing, clamps the width, and commits on release', async () => {
    render(SidebarResizeHandleHarness);

    const handle = screen.getByTestId('sidebar-resize-handle');
    const state = screen.getByTestId('sidebar-state');
    const setPointerCapture = vi.fn();
    handle.setPointerCapture = setPointerCapture;

    await fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 320,
      pointerId: 7,
    });

    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(document.body).toHaveClass('sidebar-resize-active');

    await fireEvent.pointerMove(handle, { clientX: 900, pointerId: 7 });
    expect(state).toHaveAttribute('data-width', '560');
    expect(handle).toHaveAttribute('aria-valuenow', '560');
    expect(state).toHaveAttribute('data-committed', '');

    await fireEvent.pointerUp(handle, { pointerId: 7 });
    expect(state).toHaveAttribute('data-committed', '560:false');
    expect(document.body).not.toHaveClass('sidebar-resize-active');
  });

  it('supports keyboard resizing and double-click reset', async () => {
    render(SidebarResizeHandleHarness);

    const handle = screen.getByTestId('sidebar-resize-handle');
    const state = screen.getByTestId('sidebar-state');

    expect(handle).toHaveAttribute('role', 'separator');
    expect(handle).toHaveAttribute('aria-valuemin', '240');
    expect(handle).toHaveAttribute('aria-valuemax', '560');
    expect(handle).toHaveAttribute('title', 'Resize hint');

    await fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(state).toHaveAttribute('data-width', '336');
    expect(state).toHaveAttribute('data-committed', '336:false');

    await fireEvent.keyDown(handle, { key: 'Home' });
    expect(state).toHaveAttribute('data-width', '240');

    await fireEvent.keyDown(handle, { key: 'End' });
    expect(state).toHaveAttribute('data-width', '560');

    await fireEvent.dblClick(handle);
    expect(state).toHaveAttribute('data-width', '320');
    expect(state).toHaveAttribute('data-committed', '320:false');
  });

  it('reverses pointer and keyboard movement for a left-edge handle', async () => {
    render(SidebarResizeHandleHarness, { edge: 'left' });

    const handle = screen.getByTestId('sidebar-resize-handle');
    const state = screen.getByTestId('sidebar-state');
    handle.setPointerCapture = vi.fn();

    await fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 500,
      pointerId: 12,
    });
    await fireEvent.pointerMove(handle, { clientX: 450, pointerId: 12 });
    expect(state).toHaveAttribute('data-width', '370');
    await fireEvent.pointerUp(handle, { pointerId: 12 });

    await fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(state).toHaveAttribute('data-width', '386');
    await fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(state).toHaveAttribute('data-width', '370');
  });

  it('keeps collapse optional and expands a collapsed sidebar from the handle', async () => {
    render(SidebarResizeHandleHarness, {
      initialWidth: 256,
      minWidth: 180,
      maxWidth: 520,
      defaultWidth: 256,
      collapsible: true,
    });

    const handle = screen.getByTestId('sidebar-resize-handle');
    const state = screen.getByTestId('sidebar-state');

    expect(handle).toHaveAttribute('aria-valuemin', '48');

    await fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 256,
      pointerId: 9,
    });
    await fireEvent.pointerMove(handle, { clientX: 80, pointerId: 9 });
    expect(state).toHaveAttribute('data-collapsed', 'true');
    expect(state).toHaveAttribute('data-width', '48');
    expect(handle).toHaveAttribute('aria-valuenow', '48');

    await fireEvent.pointerMove(handle, { clientX: 140, pointerId: 9 });
    expect(state).toHaveAttribute('data-collapsed', 'false');
    expect(state).toHaveAttribute('data-width', '180');

    await fireEvent.pointerUp(handle, { pointerId: 9 });
    expect(state).toHaveAttribute('data-committed', '180:false');

    await fireEvent.keyDown(handle, { key: 'Home' });
    expect(state).toHaveAttribute('data-collapsed', 'true');
    expect(state).toHaveAttribute('data-width', '48');

    await fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(state).toHaveAttribute('data-collapsed', 'false');
    expect(state).toHaveAttribute('data-width', '180');

    await fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(state).toHaveAttribute('data-collapsed', 'true');

    await fireEvent.dblClick(handle);
    expect(state).toHaveAttribute('data-collapsed', 'false');
    expect(state).toHaveAttribute('data-width', '256');
  });
});
