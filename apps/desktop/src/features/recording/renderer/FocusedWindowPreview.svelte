<script lang="ts">
  import { followedWindow } from "./followedWindow.svelte.ts";
  import WindowPreview from "./WindowPreview.svelte";

  let {
    allowedApps,
    hiddenApps,
    pinnedWindowIds = [],
  }: { allowedApps: string[]; hiddenApps: string[]; pinnedWindowIds?: number[] } = $props();

  // Copied so editing any list restarts the watch.
  $effect(() => followedWindow.watch([...allowedApps], [...hiddenApps], [...pinnedWindowIds]));

  let current = $derived(followedWindow.window);
</script>

{#if current}
  <WindowPreview windowId={current.id} />
  <div class="mt-1.5 truncate text-xs text-glass-400" title={current.title ?? current.appName}>
    <span class="text-neutral-200">{current.appName}</span>
    {#if current.title && current.title !== current.appName}<span class="ml-1">{current.title}</span
      >{/if}
  </div>
{:else if followedWindow.loaded}
  <div
    class="flex aspect-video items-center justify-center rounded-lg border border-dashed border-glass-800 px-4 text-center text-xs text-glass-500"
  >
    {allowedApps.length > 0
      ? "None of the allowed apps has a window open"
      : "No window to follow. Open an app to record."}
  </div>
{:else}
  <div class="aspect-video rounded-lg border border-glass-800 bg-black"></div>
{/if}
