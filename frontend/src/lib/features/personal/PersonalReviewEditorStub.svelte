<script>
  // Test stub for LazyMilkdownEditor: keeps the bindable content contract so
  // PersonalReview renders without the real editor.
  let { content = $bindable('') } = $props();
</script>

<div data-testid="stub-review-editor">{content}</div>
