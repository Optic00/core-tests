import { describe, expect, it } from 'vitest';

import { objectDisplayDescription, objectDisplayName, objectDisplayValue } from './systemLabels.js';

describe('object display values', () => {
  it('prefers localized display fields without replacing canonical fields', () => {
    const priority = {
      name: 'Customer Escalation',
      display_name: 'Kundeneskalation',
      description: 'Canonical description',
      display_description: 'Lokalisierte Beschreibung',
    };

    expect(objectDisplayName(priority)).toBe('Kundeneskalation');
    expect(objectDisplayDescription(priority)).toBe('Lokalisierte Beschreibung');
    expect(priority.name).toBe('Customer Escalation');
    expect(priority.description).toBe('Canonical description');
  });

  it('falls back to canonical fields for untranslated custom objects', () => {
    const priority = {
      name: 'Customer Escalation',
      display_name: '',
      description: 'Canonical description',
    };

    expect(objectDisplayName(priority)).toBe('Customer Escalation');
    expect(objectDisplayValue(priority, 'description')).toBe('Canonical description');
  });
});
