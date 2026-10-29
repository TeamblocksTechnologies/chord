<script lang="ts">
  import type { Piece } from "#project-document/domain/recording";
  import type { Project, Recording } from "#project-document/domain/recording";
  import type { Part } from "#media-engine/renderer/timeline";
  import { clipSourcePath } from "#media-engine/renderer/clipSource";
  import Inspector from "@teamblocks.dev/chord-ui/Inspector.svelte";
  import ClipLayoutPanel from "./ClipLayoutPanel.svelte";

  /** A clip of the video: how it's laid out, and its recording, to edit on its own. */
  let {
    project,
    recording,
    piece,
    part,
    onopen,
  }: {
    project: Project;
    recording: Recording;
    piece: Piece;
    part?: Part;
    onopen: () => void;
  } = $props();

  const name = $derived(`Recording ${project.recordings.indexOf(recording) + 1}`);
</script>

<Inspector
  title="Clip"
  detail={name}
  reveal={clipSourcePath(recording.directory, part)
    ? () => void window.chord.desktop.recording.reveal(clipSourcePath(recording.directory, part)!)
    : undefined}
>
  <ClipLayoutPanel {project} {piece} {part} />
  <section class="flex flex-col gap-3 p-3" aria-label="Recording">
    <button
      class="h-8 rounded-md bg-glass-800 px-3 text-xs text-neutral-100 hover:bg-glass-700"
      onclick={onopen}>Edit recording</button
    >
  </section>
</Inspector>
