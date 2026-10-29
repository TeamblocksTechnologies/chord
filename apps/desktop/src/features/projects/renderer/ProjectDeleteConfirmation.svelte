<script lang="ts">
  import { projectStore } from "#project-document/renderer/projects.svelte";
  import type { Project } from "#project-document/domain/recording";
  import ConfirmDialog from "@teamblocks.dev/chord-ui/ConfirmDialog.svelte";

  let {
    project,
    onclose,
    ondelete,
  }: { project: Project; onclose: () => void; ondelete?: () => void } = $props();
  const takes = $derived(project.recordings.length);
</script>

<ConfirmDialog
  id="project-delete"
  title="Delete this project?"
  detail={project.name || "Untitled project"}
  confirmLabel="Delete project"
  icon="trash"
  {onclose}
  onconfirm={() => {
    projectStore.remove(project.id);
    ondelete?.();
  }}
>
  {takes > 0
    ? `Its ${takes === 1 ? "recording" : `${takes} recordings`} will be moved to the Trash too.`
    : "It hasn't been recorded yet."}
</ConfirmDialog>
