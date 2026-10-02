import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';
import { rewriteBreakHTML } from './milkdown-hardbreak.js';

/**
 * Parse markdown with the transformer applied and return the transformed
 * mdast. Mirrors Milkdown's pipeline (remark-parse + run) so the tests lock
 * down exactly what the editor's schema mapper will see.
 */
async function parseWithPlugin(markdown) {
  const processor = unified().use(remarkParse).use(rewriteBreakHTML);
  const tree = processor.parse(markdown);
  await processor.run(tree);
  return tree;
}

describe('hardbreakHTMLPlugin', () => {
  it('converts inline <br /> html inside a paragraph into a break node', async () => {
    const tree = await parseWithPlugin('first line <br />second line\n');
    const paragraph = tree.children[0];
    expect(paragraph.type).toBe('paragraph');
    expect(paragraph.children.map((child) => child.type)).toEqual(['text', 'break', 'text']);
  });

  it('serializes converted breaks as markdown hard breaks, not html', async () => {
    const processor = unified().use(remarkParse).use(rewriteBreakHTML).use(remarkStringify);
    const tree = processor.parse('first line <br />second line\n');
    const out = String(processor.stringify(await processor.run(tree)));
    expect(out).not.toContain('<br');
    // remark-stringify's hard-break spelling (backslash + newline).
    expect(out).toContain('first line \\');
    expect(out).toContain('second line');
  });

  it('understands every milkdown spelling: <br>, <br/>, and <br />', async () => {
    for (const spelling of ['<br>', '<br/>', '<br />', '<BR />']) {
      const tree = await parseWithPlugin(`a ${spelling} b\n`);
      const paragraph = tree.children[0];
      expect(paragraph.children.some((child) => child.type === 'break'), spelling).toBe(true);
      expect(paragraph.children.some((child) => child.type === 'html'), spelling).toBe(false);
    }
  });

  it('converts a block-level <br /> line into a paragraph holding a break', async () => {
    const tree = await parseWithPlugin('above\n\n<br />\n\nbelow\n');
    expect(tree.children.map((child) => child.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
    expect(tree.children[1].children[0].type).toBe('break');
  });

  it('leaves non-break html untouched', async () => {
    const tree = await parseWithPlugin('keep <span>this</span> as is\n');
    const paragraph = tree.children[0];
    expect(paragraph.children.some((child) => child.type === 'html')).toBe(true);
    expect(paragraph.children.some((child) => child.type === 'break')).toBe(false);
  });

  it('leaves br spellings with attributes (not produced by milkdown) alone', async () => {
    const tree = await parseWithPlugin('a <br class="x"> b\n');
    const paragraph = tree.children[0];
    expect(paragraph.children.some((child) => child.type === 'break')).toBe(false);
  });
});
