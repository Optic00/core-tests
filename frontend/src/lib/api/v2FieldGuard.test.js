import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each([
  ['unknown_field', 1],
  ['title', 0],
])('checks merge-patch field %s', (field, status) => {
  const root = mkdtempSync(join(tmpdir(), 'v2-field-guard-'));
  roots.push(root);
  for (const dir of ['scripts', 'api', 'frontend/src'])
    mkdirSync(join(root, dir), { recursive: true });
  copyFileSync(
    resolve('../scripts/check-frontend-v2-fields.mjs'),
    join(root, 'scripts/check-frontend-v2-fields.mjs')
  );
  copyFileSync(resolve('../api/openapi-v2.json'), join(root, 'api/openapi-v2.json'));
  writeFileSync(
    join(root, 'frontend/src/request.js'),
    `fetchV2Data(\`/items/\${id}\`, { method: 'PATCH', body: JSON.stringify({ ${field}: 'value' }) });`
  );
  const result = spawnSync('bun', [join(root, 'scripts/check-frontend-v2-fields.mjs')], {
    encoding: 'utf8',
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr + result.stdout).toBe(status);
  if (status === 1) expect(result.stderr).toContain('field(s) [unknown_field]');
});
