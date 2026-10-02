import { createItemViaAPI, createWorkspaceViaAPI, listItemTypesViaAPI } from '../fixtures/api-helpers';
import { expect, test } from '../fixtures/context-path';
import { generateWorkspace } from '../fixtures/test-data';

const SEC_FETCH = { "Sec-Fetch-Site": "same-origin" };

/**
 * GH #261: a per-item-type view screen (configured on the workspace's
 * configuration set with "Configure per item type") must apply to the full
 * item detail page. The reporter's Project Brief screen puts a required
 * Estimate field on Initiative; the field showed during create but was
 * missing on the detail page.
 */
test.describe('Per item type view screen on detail page', () => {
  test('estimate from the Initiative view screen renders on the detail page', async ({
    request,
    page,
  }, testInfo) => {
    const stamp = `${Date.now()}-${testInfo.workerIndex}-${testInfo.repeatEachIndex}`;
    const workspace = await createWorkspaceViaAPI(
      request,
      generateWorkspace(`gh261-${stamp}`)
    );

    const itemTypes = await listItemTypesViaAPI(request);
    const initiative = itemTypes.find(
      (t: { name: string }) => t.name === 'Initiative'
    );
    expect(initiative, 'Initiative item type exists').toBeTruthy();

    // Project Brief screen: estimate (required) + priority, nothing else.
    const screenResponse = await request.post('/api/screens', {
      headers: SEC_FETCH,
      data: { name: `GH261 Project Brief ${stamp}` },
    });
    expect(screenResponse.ok()).toBeTruthy();
    const screen = await screenResponse.json();
    const fieldsResponse = await request.put(`/api/screens/${screen.id}/fields`, {
      headers: SEC_FETCH,
      data: ['priority', 'estimate'].map((field_identifier, display_order) => ({
        field_type: 'system',
        field_identifier,
        display_order,
        is_required: field_identifier === 'estimate',
        field_width: 'full',
      })),
    });
    expect(fieldsResponse.ok()).toBeTruthy();

    // Dedicated configuration set: per-item-type screens for Initiative,
    // assigned only to the throwaway workspace so the shared default config
    // set is untouched.
    const configResponse = await request.post('/api/configuration-sets', {
      headers: SEC_FETCH,
      data: {
        name: `GH261 Initiative screens ${stamp}`,
        workspace_ids: [workspace.id],
        differentiate_by_item_type: true,
        item_type_configs: [
          {
            item_type_id: initiative.id,
            create_screen_id: screen.id,
            edit_screen_id: screen.id,
            view_screen_id: screen.id,
          },
        ],
      },
    });
    expect(
      configResponse.ok(),
      `create config set: ${await configResponse.text()}`
    ).toBeTruthy();

    const item = await createItemViaAPI(request, workspace.id, {
      title: `Initiative brief ${stamp}`,
      item_type_id: initiative.id,
    });

    await page.goto(`/workspaces/${workspace.id}/items/${item.id}`);
    // The estimate field rendering at all is the GH #261 regression: the
    // per-type view screen's system fields must gate the detail sidebar.
    const estimateField = page.getByTestId('item-estimate-field');
    await expect(estimateField).toBeVisible();
    await expect(estimateField).not.toBeEmpty();
  });
});
