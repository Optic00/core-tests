<script>
  // Test stub for AttachmentDiagramList: renders just the attachment names so
  // tests can assert which task's attachment list is on screen.
  let { attachments = [] } = $props();
</script>

{#each attachments as attachment}
  <div data-testid="stub-attachment">{attachment.original_filename}</div>
{/each}
