import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./lib/router.js', async () => {
  const { writable } = await import('svelte/store');
  return {
    currentRoute: writable({ view: 'mobile-my-work', path: '/m', params: {} }),
    initRouter: vi.fn(),
    isMobileRoute: vi.fn((view) => String(view).startsWith('mobile-')),
    navigate: vi.fn(),
  };
});

vi.mock('./lib/stores', async () => {
  const { get, writable } = await import('svelte/store');
  const authStore = writable({
    isAuthenticated: false,
    loading: false,
    currentUser: null,
  });
  authStore.init = vi.fn();
  Object.defineProperty(authStore, 'currentUser', {
    get: () => get(authStore).currentUser,
  });
  return { authStore };
});

vi.mock('./lib/stores/moduleSettings.js', () => ({
  moduleSettings: { load: vi.fn(), reload: vi.fn() },
}));

// App startup owns the audience and loading boundary. The shell service's
// hydration and request lifecycle have their own dedicated unit tests.
vi.mock('./lib/services/authenticatedShellUI.js', () => ({
  loadAuthenticatedShellUI: vi.fn().mockResolvedValue(true),
  resetAuthenticatedShellUILoad: vi.fn(),
}));

vi.mock('./lib/api.js', () => ({
  api: {
    setup: { getStatus: vi.fn() },
    themes: { getActive: vi.fn() },
  },
}));

vi.mock('./lib/stores/theme.svelte.js', () => ({
  themeStore: {
    resolvedTheme: 'light',
    init: vi.fn(),
    setActiveTheme: vi.fn(),
  },
}));

vi.mock('./lib/stores/i18n.svelte.js', () => ({
  t: (key) => key,
  i18n: {
    locale: 'en',
    direction: 'ltr',
    init: vi.fn().mockResolvedValue(undefined),
    setLocale: vi.fn(),
  },
  SUPPORTED_LOCALES: [{ code: 'en' }],
}));

vi.mock('./lib/mobile/MobileShell.svelte', async () => ({
  default: (await import('./test-fixtures/AppReadyStub.svelte')).default,
}));

vi.mock('./lib/dialogs/LoginDialog.svelte', async () => ({
  default: (await import('./test-fixtures/AppDialogStub.svelte')).default,
}));
vi.mock('./lib/pages/WelcomeAssistant.svelte', async () => ({
  default: (await import('./test-fixtures/AppDialogStub.svelte')).default,
}));
vi.mock('./lib/layout/Portal.svelte', async () => ({
  default: (await import('./test-fixtures/AppDialogStub.svelte')).default,
}));
vi.mock('./lib/features/forms/PublicFormPage.svelte', async () => ({
  default: (await import('./test-fixtures/AppDialogStub.svelte')).default,
}));
vi.mock('./lib/pages/SetPassword.svelte', async () => ({
  default: (await import('./test-fixtures/AppDialogStub.svelte')).default,
}));
vi.mock('./lib/pages/MainApp.svelte', async () => ({
  default: (await import('./test-fixtures/AppReadyStub.svelte')).default,
}));
vi.mock('./lib/pages/PublicBoard.svelte', async () => ({
  default: (await import('./test-fixtures/AppDialogStub.svelte')).default,
}));
vi.mock('./lib/features/pages/PagePrintView.svelte', async () => ({
  default: (await import('./test-fixtures/AppDialogStub.svelte')).default,
}));

import App from './App.svelte';
import { api } from './lib/api.js';
import { currentRoute } from './lib/router.js';
import {
  loadAuthenticatedShellUI,
  resetAuthenticatedShellUILoad,
} from './lib/services/authenticatedShellUI.js';
import { authStore } from './lib/stores';
import { i18n } from './lib/stores/i18n.svelte.js';
import { themeStore } from './lib/stores/theme.svelte.js';

const authenticatedState = {
  isAuthenticated: true,
  loading: false,
  currentUser: { id: 1, language: 'en' },
};

describe('App startup recovery', () => {
  let originalHTMLAttributes;
  beforeEach(() => {
    originalHTMLAttributes = [...document.documentElement.attributes].map(({ name, value }) => [
      name,
      value,
    ]);
    currentRoute.set({ view: 'mobile-my-work', path: '/m', params: {} });
    loadAuthenticatedShellUI.mockReset().mockResolvedValue(true);
    resetAuthenticatedShellUILoad.mockClear();
    authStore.set({
      isAuthenticated: false,
      loading: false,
      currentUser: null,
    });
    authStore.init.mockReset().mockImplementation(async () => {
      authStore.set(authenticatedState);
      return { status: 'authenticated' };
    });
    api.setup.getStatus.mockReset().mockResolvedValue({ setup_completed: true });
    api.themes.getActive.mockReset().mockResolvedValue({});
    themeStore.init.mockClear();
    themeStore.setActiveTheme.mockClear();
    i18n.init.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    for (const { name } of [...document.documentElement.attributes])
      document.documentElement.removeAttribute(name);
    for (const [name, value] of originalHTMLAttributes)
      document.documentElement.setAttribute(name, value);
  });

  it('shows the branded loader during startup', () => {
    vi.useFakeTimers();
    i18n.init.mockReturnValue(new Promise(() => {}));

    render(App);

    const loader = screen.getByTestId('branded-loader');
    expect(within(loader).getByTestId('branded-loader-logo')).toHaveAttribute(
      'src',
      'windshift-3.svg'
    );
    expect(loader).toHaveAttribute('role', 'status');
  });

  it('renders the authenticated shell without waiting for theme loading', async () => {
    api.themes.getActive.mockReturnValue(new Promise(() => {}));

    render(App);

    expect(await screen.findByTestId('app-shell-ready')).toBeInTheDocument();
    expect(loadAuthenticatedShellUI).toHaveBeenCalledOnce();
    expect(loadAuthenticatedShellUI).toHaveBeenCalledWith(1);
    expect(api.themes.getActive).toHaveBeenCalledWith({ timeout: 10_000 });
  });

  it('keeps the desktop loader visible until its authenticated shell is ready', async () => {
    currentRoute.set({ view: 'my-work', path: '/', params: {} });
    let resolveShell;
    loadAuthenticatedShellUI.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveShell = resolve;
      })
    );
    render(App);
    await waitFor(() => expect(loadAuthenticatedShellUI).toHaveBeenCalledWith(1));
    expect(screen.getByTestId('branded-loader')).toBeInTheDocument();
    expect(screen.queryByTestId('app-shell-ready')).not.toBeInTheDocument();
    resolveShell(true);
    expect(await screen.findByTestId('app-shell-ready')).toBeInTheDocument();
    expect(screen.queryByTestId('branded-loader')).not.toBeInTheDocument();
  });

  it('loads the active theme after an interactive login', async () => {
    const activeTheme = {
      nav_background_color_light: '#112233',
      nav_text_color_light: '#fefefe',
      nav_background_color_dark: '#010203',
      nav_text_color_dark: '#eeeeee',
    };
    authStore.init.mockResolvedValue({ status: 'unauthenticated' });
    api.themes.getActive.mockResolvedValue(activeTheme);

    render(App);

    expect(await screen.findByTestId('dialog-stub')).toBeInTheDocument();
    expect(api.themes.getActive).not.toHaveBeenCalled();

    authStore.set(authenticatedState);

    await waitFor(() => expect(api.themes.getActive).toHaveBeenCalledWith({ timeout: 10_000 }));
    expect(themeStore.setActiveTheme).toHaveBeenLastCalledWith(activeTheme);
    expect(loadAuthenticatedShellUI).toHaveBeenCalledWith(1);
  });

  it('ignores an authenticated theme response that arrives after logout', async () => {
    const activeTheme = {
      nav_background_color_light: '#112233',
      nav_text_color_light: '#fefefe',
      nav_background_color_dark: '#010203',
      nav_text_color_dark: '#eeeeee',
    };
    let resolveTheme;
    const themeRequest = new Promise((resolve) => {
      resolveTheme = resolve;
    });
    api.themes.getActive.mockReturnValue(themeRequest);

    render(App);

    expect(await screen.findByTestId('app-shell-ready')).toBeInTheDocument();
    await waitFor(() => expect(api.themes.getActive).toHaveBeenCalledOnce());

    authStore.set({
      isAuthenticated: false,
      loading: false,
      currentUser: null,
    });
    await waitFor(() =>
      expect(themeStore.setActiveTheme).toHaveBeenLastCalledWith(
        expect.objectContaining({ nav_background_color_light: '#ffffff' })
      )
    );

    resolveTheme(activeTheme);
    await themeRequest;
    await Promise.resolve();

    expect(themeStore.setActiveTheme).not.toHaveBeenCalledWith(activeTheme);
    expect(resetAuthenticatedShellUILoad).toHaveBeenCalledOnce();
  });

  it('shows a connection error and retries bootstrap in place', async () => {
    api.setup.getStatus
      .mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' }))
      .mockResolvedValueOnce({ setup_completed: true });

    render(App);

    expect(await screen.findByTestId('startup-error')).toBeInTheDocument();
    expect(screen.getByTestId('startup-retry')).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId('startup-retry'));

    await waitFor(() => expect(screen.getByTestId('app-shell-ready')).toBeInTheDocument());
    expect(api.setup.getStatus).toHaveBeenCalledTimes(2);
  });

  it('times out a stalled locale chunk instead of loading forever', async () => {
    vi.useFakeTimers();
    i18n.init.mockReturnValue(new Promise(() => {}));

    render(App);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(screen.getByTestId('startup-error')).toBeInTheDocument();
    expect(screen.getByTestId('startup-retry')).toBeInTheDocument();
    expect(api.setup.getStatus).not.toHaveBeenCalled();
  });
});
