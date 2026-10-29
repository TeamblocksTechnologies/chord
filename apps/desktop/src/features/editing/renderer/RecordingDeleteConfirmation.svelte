<script lang="ts">
  import { projectStore } from "#project-document/renderer/projects.svelte";
  import type { Project, Recording } from "#project-document/domain/recording";
  import ConfirmDialog from "@teamblocks.dev/chord-ui/ConfirmDialog.svelte";

  let {
    project,
    recording,
    onclose,
  }: { project: Project; recording: Recording; onclose: () => void } = $props();
  const number = $derived(project.recordings.indexOf(recording) + 1);
</script>

<ConfirmDialog
  id="recording-delete"
  title={`Delete Recording ${number}?`}
  confirmLabel="Delete recording"
  {onclose}
  onconfirm={() => projectStore.removeRecording(project, recording.id)}
>
  Its files will be moved to the Trash and all of its clips will be removed from the video.
</ConfirmDialog>
