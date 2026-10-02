<script>
  // Test stub for WorkItemRow: renders just the item title so tests can assert
  // which completed items are on screen.
  let { item } = $props();
</script>

<div data-testid="stub-completed-item">{item.title}</div>
