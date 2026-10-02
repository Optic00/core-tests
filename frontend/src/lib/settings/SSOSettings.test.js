import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ssoStore } = vi.hoisted(() => ({
  ssoStore: {
    loadProviders: vi.fn(),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
    testProvider: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock('../stores', () => ({
  ssoStore,
  capabilitiesStore: {
    has: vi.fn(() => false),
  },
}));

vi.mock('../stores/i18n.svelte.js', () => ({
  t: (key) => key,
}));

import SSOSettings from './SSOSettings.svelte';

describe('SSOSettings provider submission errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ssoStore.loadProviders.mockResolvedValue(undefined);
    ssoStore.subscribe.mockImplementation((subscriber) => {
      subscriber({ adminProviders: [] });
      return () => {};
    });
  });

  it('shows a create failure inside the open provider modal', async () => {
    const providerError = 'OIDC discovery failed. Verify the issuer URL.';
    ssoStore.createProvider.mockRejectedValue(new Error(providerError));

    render(SSOSettings);

    const addButtons = await screen.findAllByRole('button', {
      name: 'settings.sso.addProvider',
    });
    await fireEvent.click(addButtons[0]);

    const dialog = screen.getByRole('dialog');
    await fireEvent.input(within(dialog).getByLabelText(/settings\.sso\.displayName/), {
      target: { value: 'Entra' },
    });
    await fireEvent.input(within(dialog).getByLabelText(/settings\.sso\.issuerUrl/), {
      target: { value: 'https://login.example.test/tenant' },
    });
    await fireEvent.input(within(dialog).getByLabelText(/settings\.sso\.clientId/), {
      target: { value: 'client-id' },
    });
    await fireEvent.input(within(dialog).getByLabelText(/settings\.sso\.clientSecret/), {
      target: { value: 'client-secret' },
    });
    await fireEvent.click(
      within(dialog).getByRole('button', { name: 'settings.sso.createProvider' })
    );

    await waitFor(() => {
      expect(ssoStore.createProvider).toHaveBeenCalledOnce();
      expect(within(dialog).getByText(providerError)).toBeInTheDocument();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows an update failure inside the open provider modal', async () => {
    const provider = {
      id: 7,
      name: 'Entra',
      slug: 'entra',
      provider_type: 'oidc',
      enabled: true,
      is_default: true,
      issuer_url: 'https://login.example.test/tenant',
      client_id: 'client-id',
      auto_provision_users: false,
      require_verified_email: true,
    };
    const providerError = 'Failed to connect to OIDC provider.';
    ssoStore.subscribe.mockImplementation((subscriber) => {
      subscriber({ adminProviders: [provider] });
      return () => {};
    });
    ssoStore.updateProvider.mockRejectedValue(new Error(providerError));

    render(SSOSettings);

    await fireEvent.click(await screen.findByRole('button', { name: 'common.edit' }));
    const dialog = screen.getByRole('dialog');
    await fireEvent.click(within(dialog).getByRole('button', { name: 'common.saveChanges' }));

    await waitFor(() => {
      expect(ssoStore.updateProvider).toHaveBeenCalledOnce();
      expect(within(dialog).getByText(providerError)).toBeInTheDocument();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
