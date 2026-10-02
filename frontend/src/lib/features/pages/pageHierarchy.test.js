import { describe, expect, it } from 'vitest';

import { orderPagesDepthFirst } from './pageHierarchy.js';

describe('orderPagesDepthFirst', () => {
  it('places descendants after their parent while preserving sibling order', () => {
    const pages = [
      { id: 1, parent_id: null },
      { id: 4, parent_id: null },
      { id: 2, parent_id: 1 },
      { id: 5, parent_id: 4 },
      { id: 3, parent_id: 2 },
    ];

    expect(orderPagesDepthFirst(pages).map((page) => page.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps pages with an inaccessible parent visible as roots', () => {
    const pages = [{ id: 2, parent_id: 99 }];

    expect(orderPagesDepthFirst(pages)).toEqual(pages);
  });
});
