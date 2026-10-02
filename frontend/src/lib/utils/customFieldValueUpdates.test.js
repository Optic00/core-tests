import { describe, expect, test, vi } from 'vitest';
import { updateCustomFieldValue } from './customFieldValueUpdates.js';

// The server merges custom field patches per field: the client sends exactly
// the edited field and the item's other fields survive untouched.
describe('updateCustomFieldValue', () => {
  test('sends only the edited field', async () => {
    const api = {
      items: { update: vi.fn(async (id, data) => ({ id, ...data })) },
    };

    const updated = await updateCustomFieldValue(api, 7, '11', 'first');

    expect(api.items.update).toHaveBeenCalledWith(7, {
      custom_field_values: { 11: 'first' },
    });
    expect(updated).toEqual({ id: 7, custom_field_values: { 11: 'first' } });
  });

  test('clearing a field sends a null value for that field only', async () => {
    const api = {
      items: { update: vi.fn(async (id, data) => ({ id, ...data })) },
    };

    await updateCustomFieldValue(api, 7, '11', null);

    expect(api.items.update).toHaveBeenCalledWith(7, {
      custom_field_values: { 11: null },
    });
  });
});
