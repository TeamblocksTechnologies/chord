<script lang="ts">
  // The open windows, by app, frontmost app first. Checking one pins it: it's recorded on its own besides the followed
  // window, with a live preview under it while pinned.
  import type { WindowSource } from "@teamblocks.dev/chord-recorder-protocol";
  import { appIcons, loadIcons } from "../apps.svelte.ts";
  import { windowPreview, type PreviewSource } from "../preview.ts";
  import { refreshSources, sources } from "../sources.svelte.ts";
  import type { RecordingSetup } from "#project-document/domain/recording";
  import MenuItem from "@teamblocks.dev/chord-ui/MenuItem.svelte";
  import VideoPreview from "../VideoPreview.svelte";
  import { togglePinnedWindow } from "./shared.ts";

  let { setup, hiddenApps }: { setup: RecordingSetup; hiddenApps: string[] } = $props();

  // Keeps up with windows opening and closing while shown.
  $effect(() => {
    void refreshSources();
    const timer = setInterval(() => void refreshSources(), 2000);
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
    loadIcons(
      apps.map(([w]) => ({
        bundleId: w.bundleId,
        pid: sources.applications.find((a) => a.bundleId === w.bundleId)?.pid,
      })),
    );
  });

  // One per window, so relisting the windows doesn't restart its preview.
  const previews = new Map<number, PreviewSource>();
  function previewOf(id: number): PreviewSource {
    if (!previews.has(id)) previews.set(id, windowPreview(id));
    return previews.get(id)!;
  }
</script>

{#each apps as windows (windows[0].bundleId)}
  {@const app = windows[0]}
  <div class="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-xs font-medium text-glass-500">
    {#if appIcons[app.bundleId]}<img
        src={appIcons[app.bundleId]}
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
      {#snippet preview()}<VideoPreview open={previewOf(w.id)} />{/snippet}
    </MenuItem>
  {/each}
{:else}
  <div class="px-2.5 py-6 text-center text-xs text-glass-500">No windows open</div>
{/each}
