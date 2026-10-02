<script>
  import SidebarResizeHandle from './SidebarResizeHandle.svelte';

  let {
    initialWidth = 320,
    minWidth = 240,
    maxWidth = 560,
    defaultWidth = 320,
    edge = 'right',
    collapsible = false,
    collapsedWidth = 48,
    collapseThreshold = 100,
  } = $props();

  let width = $state(0);
  let collapsed = $state(false);
  let committedState = $state('');

  $effect(() => {
    width = initialWidth;
  });
</script>

<div
  data-testid="sidebar-state"
  data-width={collapsed ? collapsedWidth : width}
  data-collapsed={collapsed}
  data-committed={committedState}
>
  <SidebarResizeHandle
    {width}
    {minWidth}
    {maxWidth}
    {defaultWidth}
    {edge}
    {collapsed}
    {collapsedWidth}
    collapseThreshold={collapsible ? collapseThreshold : null}
    label="Resize test navigation"
    title="Resize hint"
    testId="sidebar-resize-handle"
    onresize={(nextWidth) => width = nextWidth}
    oncollapsechange={(nextCollapsed) => collapsed = nextCollapsed}
    onresizeend={(nextWidth, nextCollapsed) => committedState = `${nextWidth}:${nextCollapsed}`}
  />
</div>
