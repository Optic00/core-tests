import { describe, expect, it } from 'vitest';

import { ENGLISH_FALLBACK_KEYS } from './adminOperationsFallback.js';
import deAdminOperations from './de/adminOperations.js';
import enAdminOperations from './en/adminOperations.js';

function collectLeafKeys(object, prefix = '') {
  const keys = [];
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...collectLeafKeys(value, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function resolve(object, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], object);
}

function placeholdersOf(text) {
  return [...String(text).matchAll(/\{[^}]+\}/g)].map((match) => match[0]);
}

// The German adminOperations module silently falls back to English for every
// key it does not override, so a missing section shows untranslated text to
// German users instead of failing loudly. These tests pin the securitySettings
// section (the Security settings page) to real German translations.
const section = 'securitySettings';
const englishKeys = collectLeafKeys(enAdminOperations[section]);

describe('German securitySettings translations', () => {
  it('provides a translation for every English securitySettings key', () => {
    expect(englishKeys.length).toBeGreaterThan(0);

    const missing = englishKeys.filter(
      (key) => resolve(deAdminOperations[section], key) === undefined
    );
    expect(missing).toEqual([]);
  });

  it('does not leak any securitySettings key to the English fallback', () => {
    const fallbackKeys = deAdminOperations[ENGLISH_FALLBACK_KEYS] ?? new Set();
    const leaked = englishKeys.filter((key) => fallbackKeys.has(`${section}.${key}`));
    expect(leaked).toEqual([]);
  });

  it.each(englishKeys)('keeps the placeholders of %s', (key) => {
    const english = resolve(enAdminOperations[section], key);
    const german = resolve(deAdminOperations[section], key);

    expect(placeholdersOf(german)).toEqual(expect.arrayContaining(placeholdersOf(english)));
  });
});
