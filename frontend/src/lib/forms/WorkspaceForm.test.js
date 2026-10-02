import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../editors/LazyMilkdownEditor.svelte', () => ({
  default: vi.fn(),
}));

vi.mock('../stores/i18n.svelte.js', () => ({
  t: (key) =>
    ({
      'createModal.workspaceName': 'Workspace name',
      'createModal.workspaceKeyPlaceholder': 'Workspace key',
      'createModal.workspaceTemplate': 'Template',
      'createModal.workspaceTemplateBlank': 'Blank workspace',
      'createModal.workspaceRestrict': 'Restrict visibility',
      'createModal.workspaceRestrictHint': 'Only you and people you assign can see this workspace',
      'createModal.addDescription': 'Add description...',
    })[key] ?? key,
}));

import WorkspaceForm from './WorkspaceForm.svelte';

describe('WorkspaceForm restricted-to-creator checkbox', () => {
  it('defaults to open and includes restricted_to_creator in the create payload', async () => {
    const { component } = render(WorkspaceForm, {
      props: { formData: { name: 'Locked', key: 'LOCK', description: '', restricted_to_creator: false } },
    });

    const checkbox = screen.getByTestId('workspace-restrict-checkbox');
    expect(checkbox).toHaveTextContent('Restrict visibility');
    expect(component.getFormData().restricted_to_creator).toBe(false);

    await fireEvent.click(checkbox.querySelector('input'));
    expect(component.getFormData().restricted_to_creator).toBe(true);
  });

  it('keeps the payload false when the checkbox is left untouched', () => {
    const { component } = render(WorkspaceForm, {
      props: { formData: { name: 'Open', key: 'OPEN', description: '', restricted_to_creator: false } },
    });

    expect(component.getFormData().restricted_to_creator).toBe(false);
  });
});
