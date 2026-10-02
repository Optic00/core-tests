<script>
  import EntityFormModal from './EntityFormModal.svelte';

  let submitted = $state(0);
  let closed = $state(0);
</script>

<div data-testid="modal-state" data-submitted={submitted} data-closed={closed}>
  <EntityFormModal
    title="Edit connection"
    onclose={() => closed += 1}
    onsubmit={() => submitted += 1}
    confirmLabel="Save"
  >
    {#snippet fields()}
      <input data-testid="entity-name" />
    {/snippet}
  </EntityFormModal>
</div>
