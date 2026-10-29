<script lang="ts">
  import { onMount } from "svelte";
  import { afterExit } from "@teamblocks.dev/chord-ui/dialog";
  import { projectStore } from "#project-document/renderer/projects.svelte";
  import type { Project } from "#project-document/domain/recording";
  import NotesEditor from "./NotesEditor.svelte";

  let { project, onclose }: { project: Project; onclose: () => void } = $props();

  let dialog: HTMLDialogElement;
  onMount(() => dialog.showModal());
</script>

<dialog
  bind:this={dialog}
  closedby="any"
  id="project-notes"
  class="m-auto w-[36rem] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-xl border border-glass-800 bg-popover text-neutral-200 shadow-2xl backdrop-blur-2xl backdrop-saturate-150 backdrop:bg-black/50 open:flex"
  aria-labelledby="project-notes-title"
  aria-describedby="project-notes-description"
  onclose={afterExit(onclose)}
>
  <div class="shrink-0 p-5 pb-4">
    <h2 id="project-notes-title" class="text-sm font-medium text-neutral-100">Notes</h2>
    <p id="project-notes-description" class="mt-1 text-xs text-glass-400">
      Prepare talking points or a script, page by page, to follow while recording.
    </p>
  </div>
  <div class="min-h-0 overflow-y-auto overscroll-contain px-5 py-1">
    <NotesEditor pages={project.notes} onchange={() => projectStore.touch(project)} />
  </div>
  <div class="flex shrink-0 items-center justify-end p-5 pt-4">
    <button
      class="h-8 rounded-md bg-primary px-4 text-xs font-semibold text-white transition hover:bg-primary-hover"
      onclick={() => dialog.close()}>Done</button
    >
  </div>
</dialog>
