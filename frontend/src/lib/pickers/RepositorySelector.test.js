import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api.js', () => ({
  api: {
    workspaceSCM: {
      getAvailableRepos: vi.fn(),
      getLinkedRepos: vi.fn(),
      startOAuth: vi.fn(),
      linkRepos: vi.fn(),
    },
  },
}));

vi.mock('../stores/i18n.svelte.js', () => ({
  t: (key) => key,
}));

import { api } from '../api.js';
import RepositorySelector from './RepositorySelector.svelte';

const connection = { id: 5, name: 'GitLab' };

const repositories = [
  {
    id: 1,
    full_name: 'acme/windshift',
    description: 'The main app',
    is_private: true,
    is_linked: false,
    default_branch: 'main'
  },
  {
    id: 2,
    full_name: 'acme/website',
    description: 'Marketing site',
    is_private: false,
    is_linked: false,
    default_branch: 'main'
  }
];

beforeEach(() => {
  vi.clearAllMocks();
  api.workspaceSCM.getAvailableRepos.mockResolvedValue({ repositories });
  api.workspaceSCM.getLinkedRepos.mockResolvedValue({ repositories: [] });
});

afterEach(() => cleanup());

function renderSelector() {
  return render(RepositorySelector, {
    props: { workspaceId: 1, connection, onclose: vi.fn(), onlinked: vi.fn() }
  });
}

describe('RepositorySelector server-side search', () => {
  it('loads the first page without a search param', async () => {
    renderSelector();

    await waitFor(() => expect(api.workspaceSCM.getAvailableRepos).toHaveBeenCalledTimes(1));
    expect(api.workspaceSCM.getAvailableRepos).toHaveBeenCalledWith(1, 5, {
      page: 1,
      per_page: 30
    });
    expect(screen.getAllByTestId('repository-selector-repo')).toHaveLength(2);
  });

  it('debounces input into one server-side search with the trimmed query', async () => {
    renderSelector();
    await waitFor(() => expect(api.workspaceSCM.getAvailableRepos).toHaveBeenCalledTimes(1));

    const input = screen.getByTestId('repository-selector-search');
    fireEvent.input(input, { target: { value: 'win' } });
    fireEvent.input(input, { target: { value: '  windshift  ' } });

    await waitFor(
      () => expect(api.workspaceSCM.getAvailableRepos).toHaveBeenCalledTimes(2),
      { timeout: 2000 }
    );
    // The second keystroke lands inside the debounce window, so both
    // keystrokes collapse into a single request for the trimmed query.
    expect(api.workspaceSCM.getAvailableRepos).toHaveBeenLastCalledWith(1, 5, {
      page: 1,
      per_page: 30,
      search: 'windshift'
    });
  });

  it('still narrows the visible list client-side when the provider ignores search', async () => {
    // Provider without native search: the page stays unfiltered.
    api.workspaceSCM.getAvailableRepos.mockResolvedValue({ repositories });

    renderSelector();
    await waitFor(() => expect(api.workspaceSCM.getAvailableRepos).toHaveBeenCalledTimes(1));

    fireEvent.input(screen.getByTestId('repository-selector-search'), {
      target: { value: 'website' }
    });

    await waitFor(
      () => expect(api.workspaceSCM.getAvailableRepos).toHaveBeenCalledTimes(2),
      { timeout: 2000 }
    );
    const rows = screen.getAllByTestId('repository-selector-repo');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('acme/website');
  });
});
