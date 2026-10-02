import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

// Rewrite `import { Power } from '@lucide/svelte'` into a direct per-icon
// import (`@lucide/svelte/icons/power`). The barrel re-exports ~1,500 icon
// components, so every test file that touches it pays a multi-second Svelte
// compile of the whole icon set during Vite's SSR transform. A direct file
// import transforms exactly one icon. Anything the rewrite cannot map
// (unknown names, unusual syntax) falls through to the barrel unchanged.

const NAMED_IMPORT_RE = /import\s+(?:type\s+)?\{([^}]+)\}\s*from\s*(['"])@lucide\/svelte\2/g;

let iconsDir;
const aliasTargets = new Map();
const fileExists = new Map();

function init() {
  if (iconsDir) return;
  // Resolve the main entry, not package.json: the exports map does not
  // expose "./package.json" and node enforces that strictly.
  const entry = require.resolve('@lucide/svelte');
  const pkgDir = dirname(dirname(entry)); // dist/lucide-svelte.js → dist → package
  iconsDir = join(pkgDir, 'dist', 'icons');
  for (const file of ['aliases.js', 'prefixed.js', 'suffixed.js']) {
    const p = join(pkgDir, 'dist', 'aliases', file);
    if (!existsSync(p)) continue;
    const src = readFileSync(p, 'utf8');
    for (const m of src.matchAll(/default as ([\w$]+)\s*\}\s*from\s*'([^']+\.js)'/g)) {
      // Record the icon file (e.g. '../icons/x-circle.js') behind each alias.
      aliasTargets.set(m[1], m[2]);
    }
  }
}

function iconSubpath(name) {
  init();
  const kebab = name
    .replace(/^Lucide/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([a-z])(\d)/g, '$1-$2')
    .toLowerCase();
  if (!fileExists.has(kebab)) {
    fileExists.set(kebab, existsSync(join(iconsDir, `${kebab}.js`)));
  }
  if (fileExists.get(kebab)) {
    return `@lucide/svelte/icons/${kebab}`;
  }
  const alias = aliasTargets.get(name);
  if (alias) {
    return `@lucide/svelte/icons/${alias.replace(/^\.\.\/icons\//, '').replace(/\.js$/, '')}`;
  }
  return null;
}

export function lucideDirectImports() {
  return {
    name: 'lucide-direct-imports',
    enforce: 'pre',
    transform(code, id) {
      if (id.startsWith('\0') || !code.includes('@lucide/svelte')) return null;
      try {
        return this.rewrite(code);
      } catch {
        // Any unexpected failure keeps the original barrel import.
        return null;
      }
    },
    rewrite(code) {
      let rewrote = false;
      const next = code.replace(NAMED_IMPORT_RE, (statement, specList) => {
        const parts = [];
        for (const raw of specList.split(',')) {
          const spec = raw.trim();
          if (!spec) continue;
          const m = spec.match(/^(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?$/);
          if (!m) return statement;
          const imported = m[1];
          const local = m[2] ?? imported;
          const subpath = iconSubpath(imported);
          if (!subpath) return statement;
          parts.push([imported, local, subpath]);
        }
        if (!parts.length) return statement;
        rewrote = true;
        return parts
          .map(([imported, local, subpath]) =>
            local === imported
              ? `import ${imported} from '${subpath}';`
              : `import ${imported} from '${subpath}'; const ${local} = ${imported};`
          )
          .join('\n');
      });
      return rewrote ? { code: next, map: null } : null;
    },
  };
}
