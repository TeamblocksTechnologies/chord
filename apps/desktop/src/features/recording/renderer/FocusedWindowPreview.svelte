<script lang="ts">
  import { appIcons, loadIcons } from "./apps.svelte.ts";
  import { followedWindow } from "./followedWindow.svelte.ts";
  import { uniqueApplications } from "./sources.svelte.ts";
  import WindowPreview from "./WindowPreview.svelte";

  let {
    allowedApps,
    hiddenApps,
    pinnedWindowIds = [],
  }: { allowedApps: string[]; hiddenApps: string[]; pinnedWindowIds?: number[] } = $props();

  // Copied so editing any list restarts the watch.
  $effect(() => followedWindow.watch([...allowedApps], [...hiddenApps], [...pinnedWindowIds]));

  let current = $derived(followedWindow.window);
  let bundleId = $derived(current?.bundleId);

  $effect(() => {
    if (!bundleId) return;
    const pid = uniqueApplications().find((a) => a.bundleId === bundleId)?.pid;
    loadIcons([{ bundleId, pid }]);
  });
</script>

{#if current}
  <WindowPreview windowId={current.id} />
  <div
    class="mt-1.5 flex items-center gap-1.5 text-xs text-glass-400"
    title={current.title ?? current.appName}
  >
    {#if appIcons[current.bundleId]}<img
        src={appIcons[current.bundleId]}
        alt=""
        class="size-4 shrink-0"
        draggable="false"
      />{/if}
    <span class="shrink-0 text-neutral-200">{current.appName}</span>
    {#if current.title && current.title !== current.appName}<span class="truncate"
        >{current.title}</span
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
