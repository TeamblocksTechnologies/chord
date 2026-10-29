<script lang="ts">
  // The recording notes window shown while recording a project with notes. It's apart from the island, moves by its bar,
  // and resizes from any edge. The main process keeps the page, so it's the same here and in the main window, and notes
  // when it changes.
  import NotesPanel from "./NotesPanel.svelte";
  import { connectDesktop, desktop } from "#platform/renderer/desktop.svelte";
  import { windowDrag, windowResize } from "./windowDrag.ts";
  import type { ResizeEdge } from "../domain/notes.ts";

  connectDesktop();
  let notes = $derived(desktop.recording.target?.notes ?? []);

  const edges: { edge: ResizeEdge; class: string }[] = [
    { edge: "n", class: "inset-x-3 top-0 h-1.5 cursor-ns-resize" },
    { edge: "s", class: "inset-x-3 bottom-0 h-1.5 cursor-ns-resize" },
    { edge: "w", class: "inset-y-3 left-0 w-1.5 cursor-ew-resize" },
    { edge: "e", class: "inset-y-3 right-0 w-1.5 cursor-ew-resize" },
    { edge: "nw", class: "top-0 left-0 size-3 cursor-nwse-resize" },
    { edge: "se", class: "right-0 bottom-0 size-3 cursor-nwse-resize" },
    { edge: "ne", class: "top-0 right-0 size-3 cursor-nesw-resize" },
    { edge: "sw", class: "bottom-0 left-0 size-3 cursor-nesw-resize" },
  ];
</script>

<div class="relative h-screen w-screen p-px text-neutral-100 antialiased select-none">
  {#if notes.length > 0}
    <NotesPanel
      class="size-full rounded-xl border border-white/10 bg-neutral-950/70"
      pages={notes}
      page={desktop.recording.page}
      phase={desktop.recording.phase}
      onpage={(page) => window.chord.desktop.recording.setPage(page)}
      bar={windowDrag()}
    />
  {/if}
  {#each edges as { edge, class: className } (edge)}
    <div class={["absolute z-10", className]} aria-hidden="true" {@attach windowResize(edge)}></div>
  {/each}
</div>
