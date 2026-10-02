<script>
  import TestManagementHeader from './TestManagementHeader.svelte';

  let milestoneFilter = $state(null);
  let createCount = $state(0);
</script>

<div data-testid="header-state" data-milestone={milestoneFilter ?? ''} data-create-count={createCount}>
  <TestManagementHeader
    title="Test plans"
    subtitle="Plan and run tests"
    bind:milestoneFilter
    oncreate={() => createCount += 1}
    createEvent="trigger-test-plan-form"
  >
    {#snippet primaryAction()}
      <button type="button">Create plan</button>
    {/snippet}
  </TestManagementHeader>
</div>
