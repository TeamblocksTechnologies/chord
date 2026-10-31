<script lang="ts">
  import { afterExit } from "@teamblocks.dev/chord-ui/dialog";
  // Sets up and starts a new recording for a project.
  import { onMount } from "svelte";
  import { recordsAnything, recorder } from "./recorder.svelte.ts";
  import type { Project } from "#project-document/domain/recording";
  import PermissionsPanel from "./PermissionsPanel.svelte";
  import RecordButton from "@teamblocks.dev/chord-ui/recording/RecordButton.svelte";
  import RecordingControls from "@teamblocks.dev/chord-ui/recording/RecordingControls.svelte";

  let { project, onclose }: { project: Project; onclose: () => void } = $props();

  let dialog: HTMLDialogElement;
  onMount(() => dialog.showModal());
</script>

<dialog
  bind:this={dialog}
  closedby="any"
  id="recording-setup"
  class="m-auto w-[36rem] max-w-[calc(100%-2rem)] overflow-visible rounded-xl border border-glass-800 bg-popover p-5 backdrop-blur-2xl backdrop-saturate-150 text-neutral-200 shadow-2xl backdrop:bg-black/50"
  aria-labelledby="recording-setup-title"
  onclose={afterExit(onclose)}
>
  <h2 id="recording-setup-title" class="mb-4 text-sm font-medium text-neutral-100">
    New recording
  </h2>
  <PermissionsPanel />
  <RecordingControls setup={project.setup} overlay={false} fill />
  <div class="mt-5 flex items-center justify-end gap-2">
    <button
      class="h-8 rounded-md px-3 text-xs text-glass-400 hover:bg-glass-800 hover:text-neutral-100"
      onclick={() => dialog.close()}>Cancel</button
    >
    <RecordButton
      compact
      label="Start recording"
      class="w-40"
      disabled={!recordsAnything(project.setup)}
      onclick={() => {
        recorder.start(project.setup, project);
        dialog.close();
      }}
    />
  </div>
</dialog>
