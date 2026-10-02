import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

// Direct api.workspaces.getAll() calls bypass the shared, cached workspace
// directory in workspacesStore and re-run a full paged fetch on every open
// (WI-1443). New callers must route through workspacesStore.load(); anything
// on this allowlist needs a written reason.

const ALLOWED_CALL_SITES = new Set([
  // The admin directory needs the complete workspace list, not the store's
  // cached first page, until WI-1446 replaces this with server-side paging
  // and search.
  'lib/workspaces/Workspaces.svelte',
]);

const DIRECT_GET_ALL = /api\.workspaces\.getAll\s*\(/;
const SOURCE_EXTENSIONS = new Set(['.js', '.svelte', '.ts']);

function listSourceFiles(root) {
  const files = [];
  const stack = [root];
  const skippedDirectories = new Set(['node_modules', 'dist', 'test-results']);
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      if (skippedDirectories.has(entry)) continue;
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        stack.push(fullPath);
      } else if (
        SOURCE_EXTENSIONS.has('.' + entry.split('.').pop()) &&
        !entry.endsWith('.test.js') &&
        !entry.endsWith('.spec.ts')
      ) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

describe('workspace list routing guard', () => {
  test('every api.workspaces.getAll caller is allowlisted', () => {
    // The test lives at <frontend>/src/lib/api/, so the scan root is src/.
    const srcRoot = join(import.meta.dirname, '..', '..');
    const violations = [];

    for (const filePath of listSourceFiles(srcRoot)) {
      const relativePath = relative(srcRoot, filePath).split(sep).join('/');
      if (relativePath === 'lib/api/workspaces.js') continue; // the client definition itself
      const contents = readFileSync(filePath, 'utf8');
      if (DIRECT_GET_ALL.test(contents) && !ALLOWED_CALL_SITES.has(relativePath)) {
        violations.push(relativePath);
      }
    }

    expect(violations).toEqual([]);
  });
});
