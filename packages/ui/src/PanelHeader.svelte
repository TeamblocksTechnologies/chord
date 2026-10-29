<script lang="ts">
  import type { Snippet } from "svelte";

  /** The top of a side panel: its title, what it's showing, and the actions that apply to the whole panel. */
  let { title, detail, actions }: { title: string; detail?: string; actions?: Snippet } = $props();
</script>

<header
  class="flex min-h-11 shrink-0 items-center gap-1 border-b border-glass-800 py-2.5 pr-2 pl-4"
>
  <div class="flex min-w-0 flex-1 flex-col">
    <h2 class="truncate text-xs font-medium text-neutral-100" data-panel-title>{title}</h2>
    {#if detail}<p class="truncate text-xs text-glass-500" title={detail} data-panel-detail>
        {detail}
      </p>{/if}
  </div>
  {#if actions}{@render actions()}{/if}
</header>
