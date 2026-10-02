<script>
  import DynamicFilterPopover from './DynamicFilterPopover.svelte';

  let filters = $state([]);
  let applied = $state('');
</script>

<div data-testid="filter-state" data-filters={JSON.stringify(filters)} data-applied={applied}>
  <DynamicFilterPopover
    bind:filters
    applied={Boolean(applied)}
    onapply={(rows) => applied = JSON.stringify(rows)}
    onclear={() => applied = ''}
  >
    {#snippet filterRow({ filter, index, onchange, onremove, onexecute })}
      <div data-testid={`filter-row-${index}`}>
        <button
          type="button"
          data-testid={`set-filter-${index}`}
          onclick={() => onchange({ ...filter, field: { id: 'title' }, value: 'wind' })}
        >Set</button>
        <button type="button" data-testid={`remove-filter-${index}`} onclick={onremove}>Remove</button>
        <button type="button" data-testid={`execute-filter-${index}`} onclick={onexecute}>Execute</button>
      </div>
    {/snippet}
  </DynamicFilterPopover>
</div>
