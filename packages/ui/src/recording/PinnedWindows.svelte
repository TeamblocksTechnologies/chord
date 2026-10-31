<script lang="ts">
  // The open windows, by app, frontmost app first. Checking one pins it: it's recorded on its own besides the followed
  // window, with a live preview under it while pinned.
  import type { WindowSource } from "#ui/model/sources.ts";
  import type { RecordingSetup } from "#ui/model/setup.ts";
  import MenuItem from "#ui/MenuItem.svelte";
  import { togglePinnedWindow } from "./controls.ts";
  import { recordingEnvironment } from "./environment.ts";

  let { setup, hiddenApps }: { setup: RecordingSetup; hiddenApps: string[] } = $props();

  const { sources, apps: catalogue, previews, refreshSources } = recordingEnvironment();
  const WindowPreview = previews.window;

  // Keeps up with windows opening and closing while shown.
  $effect(() => {
    refreshSources();
    const timer = setInterval(refreshSources, 2000);
    return () => clearInterval(timer);
  });

  let apps = $derived.by(() => {
    const byApp = new Map<string, WindowSource[]>();
    for (const w of sources.windows) {
      if (hiddenApps.includes(w.bundleId)) continue;
      byApp.set(w.bundleId, [...(byApp.get(w.bundleId) ?? []), w]);
    }
    return [...byApp.values()];
  });

  $effect(() => {
    catalogue.load(
      apps.map(([w]) => ({
        bundleId: w.bundleId,
        pid: sources.applications.find((a) => a.bundleId === w.bundleId)?.pid,
      })),
    );
  });
</script>

{#each apps as windows (windows[0].bundleId)}
  {@const app = windows[0]}
  <div class="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-xs font-medium text-glass-500">
    {#if catalogue.icons[app.bundleId]}<img
        src={catalogue.icons[app.bundleId]}
        alt=""
        class="size-4"
        draggable="false"
      />{/if}
    <span class="truncate">{app.appName}</span>
  </div>
  {#each windows as w (w.id)}
    <MenuItem
      selected={setup.pinnedWindowIds.includes(w.id)}
      multiple
      onclick={() => togglePinnedWindow(setup, w.id)}
    >
      {w.title || "Untitled window"}
      {#snippet preview()}<WindowPreview windowId={w.id} />{/snippet}
    </MenuItem>
  {/each}
{:else}
  <div class="px-2.5 py-6 text-center text-xs text-glass-500">No windows open</div>
{/each}
