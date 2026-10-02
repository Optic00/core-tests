import { render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LazyMilkdownEditor from './LazyMilkdownEditor.svelte';

// Every read-only markdown surface (item description, comments, chat,
// pages, portal, public board) renders through LazyMilkdownEditor in
// readonly mode. These tests pin the shared contract: real markdown
// structure, inert editing, and raw HTML shown as inert text.
const MARKDOWN = [
  '## Launch plan',
  '',
  'Some **bold** and `inline` code with a [link](https://example.com).',
  '',
  '- first',
  '- second',
  '',
  'Raw <script>window.__readonlyXss = true</script> and <img src="x" onerror="window.__readonlyXss = true"> tags stay text.',
].join('\n');

async function renderReadonly(content) {
  const { container } = render(LazyMilkdownEditor, {
    props: { content, readonly: true, showToolbar: false, testId: 'readonly-md' },
  });
  const host = await waitFor(
    () => {
      const el = container.querySelector('[data-testid="readonly-md"]');
      expect(el).not.toBeNull();
      expect(el).toHaveAttribute('data-ready', 'true');
      return el;
    },
    { timeout: 30_000 }
  );
  return { container, host };
}

describe("readonly Milkdown rendering", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // jsdom exposes requestIdleCallback but never dispatches idle callbacks
  // under vitest, so the lazy editor module would never load.
  function scheduleIdleImmediately() {
    vi.stubGlobal('requestIdleCallback', (cb) => queueMicrotask(() => cb({ didTimeout: false })));
  }

  it('renders markdown structure with editor typography', { timeout: 90_000 }, async () => {
    scheduleIdleImmediately();
    const { host } = await renderReadonly(MARKDOWN);

    expect(host.querySelector('h2')?.textContent).toBe('Launch plan');
    expect(host.querySelector('strong')?.textContent).toBe('bold');
    expect(host.querySelector('code')?.textContent).toBe('inline');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(host.querySelectorAll('ul > li').length).toBe(2);
  });

  it('is inert: the document is not editable', { timeout: 90_000 }, async () => {
    scheduleIdleImmediately();
    const { host } = await renderReadonly(MARKDOWN);

    expect(host.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false');
  });

  it('shows raw HTML as literal text without creating executable DOM', { timeout: 90_000 }, async () => {
    scheduleIdleImmediately();
    const { host } = await renderReadonly(MARKDOWN);

    expect(host.querySelectorAll('script').length).toBe(0);
    expect(host.querySelectorAll('img').length).toBe(0);
    const htmlText = Array.from(host.querySelectorAll('span[data-type="html"]'))
      .map((span) => span.textContent)
      .join('');
    expect(htmlText).toContain('<script>');
    expect(htmlText).toContain('<img src="x"');
    expect(Reflect.has(window, '__readonlyXss')).toBe(false);
  });

  it('renders nothing but the skeleton before the editor module loads', () => {
    const { container } = render(LazyMilkdownEditor, {
      props: { content: MARKDOWN, readonly: true, showToolbar: false },
    });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(container.querySelector('.ProseMirror')).toBeNull();
  });
});
