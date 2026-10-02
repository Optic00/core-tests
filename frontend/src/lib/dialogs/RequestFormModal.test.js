import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../api.js';
import RequestFormModal from './RequestFormModal.svelte';

vi.mock('../api.js', () => ({
  api: {
    portal: {
      getRequestTypeFields: vi.fn(),
      getCustomFields: vi.fn(),
      drafts: { getForRequestType: vi.fn(), save: vi.fn(), delete: vi.fn() },
    },
  },
}));
vi.mock('../stores', () => ({ authStore: { isAuthenticated: false } }));
vi.mock('../stores/portalAuth.svelte.js', () => ({
  portalAuthStore: {
    subscribe: (run) => {
      run({ isAuthenticated: false });
      return () => {};
    },
  },
}));
vi.mock('../stores/portal.svelte.js', () => ({ portalCustomizationStore: {} }));
vi.mock('../stores/i18n.svelte.js', () => ({ t: (key) => key }));

beforeEach(() => {
  api.portal.getRequestTypeFields.mockResolvedValue([
    { field_identifier: 'title', field_type: 'default', display_name: 'Summary', step_number: 1 },
    {
      field_identifier: 'description',
      field_type: 'default',
      display_name: 'Details',
      step_number: 2,
    },
  ]);
  api.portal.getCustomFields.mockResolvedValue([]);
  api.portal.drafts.getForRequestType.mockResolvedValue(null);
  api.portal.drafts.save.mockImplementation(async (_slug, payload) => ({ id: 1, ...payload }));
  api.portal.drafts.delete.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function openForm() {
  return render(RequestFormModal, {
    isOpen: true,
    portalSlug: 'support',
    requestType: { id: 7, name: 'Incident' },
  });
}

it('saves a new request on step two without announcing a resumed draft', async () => {
  openForm();
  await fireEvent.input(await screen.findByLabelText(/^Summary/), {
    target: { value: 'Printer issue' },
  });
  await fireEvent.click(screen.getByTestId('request-form-next-step'));
  expect(await screen.findByText('portal.draftSaved')).toBeTruthy();
  expect(api.portal.drafts.save).toHaveBeenCalledWith('support', {
    request_type_id: 7,
    title: 'Printer issue',
    description: '',
    custom_fields: {},
    current_step: 2,
  });
  expect(screen.queryByTestId('request-form-draft-resume-banner')).toBeNull();
  expect(screen.getByLabelText(/^Details/)).toBeTruthy();
});

it('restores the saved step and title when reopening a request', async () => {
  api.portal.drafts.getForRequestType.mockResolvedValue({ title: 'Saved title', current_step: 2 });
  openForm();
  expect(await screen.findByTestId('request-form-draft-resume-banner')).toBeTruthy();
  expect(screen.getByLabelText(/^Details/)).toBeTruthy();
  await fireEvent.click(screen.getByTestId('request-form-back-step'));
  expect(screen.getByLabelText(/^Summary/).value).toBe('Saved title');
});

it('keeps the resume notice dismissed after starting fresh and advancing', async () => {
  api.portal.drafts.getForRequestType.mockResolvedValue({ title: 'Saved title', current_step: 2 });
  openForm();
  await fireEvent.click(await screen.findByText('portal.draftStartFresh'));
  expect((await screen.findByLabelText(/^Summary/)).value).toBe('');
  expect(api.portal.drafts.delete).toHaveBeenCalledWith('support', 7);
  await fireEvent.input(screen.getByLabelText(/^Summary/), { target: { value: 'Fresh title' } });
  await fireEvent.click(screen.getByTestId('request-form-next-step'));
  expect(await screen.findByText('portal.draftSaved')).toBeTruthy();
  expect(screen.queryByTestId('request-form-draft-resume-banner')).toBeNull();
});

it('applies prefill after a resumed draft and ignores unknown keys', async () => {
  api.portal.getRequestTypeFields.mockResolvedValue([
    { field_identifier: 'title', field_type: 'default', display_name: 'Summary', step_number: 1 },
    { field_identifier: '42', field_type: 'custom', display_name: 'Device', step_number: 1 },
  ]);
  api.portal.getCustomFields.mockResolvedValue([{ id: 42, name: 'Device', field_type: 'text' }]);
  api.portal.drafts.getForRequestType.mockResolvedValue({
    title: 'Draft title',
    custom_field_values: { 42: 'old-device' },
    current_step: 1,
  });

  render(RequestFormModal, {
    isOpen: true,
    portalSlug: 'support',
    requestType: { id: 7, name: 'Incident' },
    prefill: { 42: '431', unknown: 'ignored' },
  });

  // The draft's other values survive while the prefilled target field wins.
  expect((await screen.findByLabelText(/^Summary/)).value).toBe('Draft title');
  expect(await screen.findByDisplayValue('431')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('ignored')).toBeNull();
});
