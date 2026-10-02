<script>
  import { onMount } from 'svelte';
  // Test stub for Comments: mimics the real component's contract — comments
  // load once on mount. The rendered id is frozen at mount time so a test can
  // tell a remount (new item's comments) from an in-place prop update (stale
  // comments still on screen).
  let { itemId, onCommentsLoaded } = $props();

  let mountedItemId = $state(null);
  onMount(() => {
    mountedItemId = itemId;
    onCommentsLoaded?.({ count: 7 });
  });
</script>

<div data-testid="stub-comments">comments-{mountedItemId}</div>
