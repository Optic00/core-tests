<script>
  import { GitBranch } from '@lucide/svelte';
  import SCMRepositoryModal from './SCMRepositoryModal.svelte';

  let repositories = $state([]);
  let selectedRepoId = $state(null);
  let error = $state(null);
  let submitted = $state(0);
</script>

<div
  data-testid="scm-modal-state"
  data-repository-count={repositories.length}
  data-selected-repository={selectedRepoId ?? ''}
  data-submitted={submitted}
>
  <SCMRepositoryModal
    itemId={12}
    title="Create branch"
    emptyIcon={GitBranch}
    bind:repositories
    bind:selectedRepoId
    bind:error
    confirmLabel="Create"
    loadingLabel="Creating"
    onclose={() => {}}
    onsubmit={() => submitted += 1}
  >
    {#snippet fields()}
      <input data-testid="branch-name" />
    {/snippet}
  </SCMRepositoryModal>
</div>
