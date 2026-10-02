import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { consumeOAuthReturnURL, setOAuthReturnURL } from './oauthReturn.js';

// Pins the OAuth return mechanism: SCM settings pages store their URL before
// bouncing to the provider, and the app shell consumes it when the OAuth
// callback lands so the user returns to the page that started the flow.

const ORIGIN = window.location.origin;

function setWindowLocation(path, search) {
  window.history.replaceState({}, '', path + search);
}

beforeEach(() => {
  sessionStorage.clear();
  setWindowLocation('/workspaces/2/settings/source-control', '');
});

afterEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('consumeOAuthReturnURL', () => {
  test('returns null when the current URL is not an OAuth callback landing', () => {
    setOAuthReturnURL(`${ORIGIN}/workspaces/2/settings/source-control`);
    expect(consumeOAuthReturnURL('?tab=general')).toBeNull();
    // The stored entry must survive a non-callback page load.
    expect(sessionStorage.getItem('scm_oauth_return')).not.toBeNull();
  });

  test('returns null when nothing was stored before the flow', () => {
    expect(consumeOAuthReturnURL('?oauth=success&provider=gitlab')).toBeNull();
  });

  test('returns the stored path with callback params merged and clears storage', () => {
    setOAuthReturnURL(`${ORIGIN}/workspaces/2/settings/source-control?state=connected`);

    const dest = consumeOAuthReturnURL('?oauth=success&provider=gitlab');

    expect(dest).toBe(
      '/workspaces/2/settings/source-control?state=connected&oauth=success&provider=gitlab'
    );
    expect(sessionStorage.getItem('scm_oauth_return')).toBeNull();
  });

  test('merges error message params for failed flows', () => {
    setOAuthReturnURL(`${ORIGIN}/profile`);

    const dest = consumeOAuthReturnURL('?oauth=error&message=Invalid+or+expired+state');

    expect(dest).toBe('/profile?oauth=error&message=Invalid+or+expired+state');
  });

  test('overwrites a stale oauth param on the stored URL', () => {
    setOAuthReturnURL(`${ORIGIN}/profile?oauth=error`);

    const dest = consumeOAuthReturnURL('?oauth=success&provider=gitlab');

    expect(dest).toBe('/profile?oauth=success&provider=gitlab');
  });

  test('rejects stored URLs from another origin', () => {
    setOAuthReturnURL('https://evil.example.com/workspaces/2/settings/source-control');

    expect(consumeOAuthReturnURL('?oauth=success&provider=gitlab')).toBeNull();
  });

  test('rejects entries older than the freshness window', () => {
    setOAuthReturnURL(`${ORIGIN}/profile`);
    const entry = JSON.parse(sessionStorage.getItem('scm_oauth_return'));
    entry.ts = Date.now() - 16 * 60 * 1000;
    sessionStorage.setItem('scm_oauth_return', JSON.stringify(entry));

    expect(consumeOAuthReturnURL('?oauth=success&provider=gitlab')).toBeNull();
  });

  test('returns null for corrupted storage payloads and clears them', () => {
    sessionStorage.setItem('scm_oauth_return', 'not-json{');

    expect(consumeOAuthReturnURL('?oauth=success&provider=gitlab')).toBeNull();
    expect(sessionStorage.getItem('scm_oauth_return')).toBeNull();
  });
});

describe('setOAuthReturnURL', () => {
  test('defaults to the current page URL', () => {
    setWindowLocation('/items/2342/scm', '');

    setOAuthReturnURL();

    const entry = JSON.parse(sessionStorage.getItem('scm_oauth_return'));
    expect(entry.url).toBe(`${ORIGIN}/items/2342/scm`);
    expect(Number.isFinite(entry.ts)).toBe(true);
  });
});
