import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchAPI } from './core.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('lang');
  localStorage.clear();
});

describe('API request locale', () => {
  it('sends the active document locale in Accept-Language', async () => {
    document.documentElement.lang = 'de-CH';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchAPI('/priorities');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1].headers['Accept-Language']).toBe('de-CH');
  });
});
