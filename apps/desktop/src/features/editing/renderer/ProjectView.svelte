<script lang="ts">
  import { projectEdits } from "#features/editing/renderer/edits";
  import { onMount } from "svelte";
  import ClipInspector from "./layout/ClipInspector.svelte";
  import { visualLayersOf } from "../domain/visualLayers.ts";
  import RecordingInspector from "./RecordingInspector.svelte";
  import PanelButton from "@teamblocks.dev/chord-ui/PanelButton.svelte";
  import PanelHeader from "@teamblocks.dev/chord-ui/PanelHeader.svelte";
  import { Backgrounds } from "#features/background-removal/renderer/backgrounds.svelte";
  import { NoiseStates } from "#features/audio-processing/renderer/noise.svelte";
  import { Transcriptions } from "#features/transcription/renderer/transcriptions.svelte";
  import ExportDialog from "#features/exporting/renderer/ExportDialog.svelte";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import ProjectDeleteConfirmation from "#features/projects/renderer/ProjectDeleteConfirmation.svelte";
  import RecordingActions from "./RecordingActions.svelte";
  import RecordingDeleteConfirmation from "./RecordingDeleteConfirmation.svelte";
  import ProjectExports from "#features/exporting/renderer/ProjectExports.svelte";
  import ProjectPlayer from "./ProjectPlayer.svelte";
  import Menu from "@teamblocks.dev/chord-ui/Menu.svelte";
  import MenuAction from "@teamblocks.dev/chord-ui/MenuAction.svelte";
  import MenuEntries from "@teamblocks.dev/chord-ui/MenuEntries.svelte";
  import PanelResize from "@teamblocks.dev/chord-ui/PanelResize.svelte";
  import NotesDialog from "#features/recording/renderer/NotesDialog.svelte";
  import RecordDialog from "#features/recording/renderer/RecordDialog.svelte";
  import TopBar from "#platform/renderer/TopBar.svelte";
  import type { Project, Recording } from "#project-document/domain/recording";
  import { formatDateTime, formatDuration } from "#shared/domain/format";
  import { projectFolder, projectStore } from "#project-document/renderer/projects.svelte";
  import { piecesOf } from "#project-document/domain/recording";
  import type { ExportSource } from "#features/exporting/renderer/exporter";
  import type { TranscriptPlayback } from "#media-engine/renderer/transcript";
  import { router } from "#platform/renderer/router.svelte";
  import { openContextMenu, type MenuEntry } from "@teamblocks.dev/chord-ui/contextMenu.svelte";
  import { desktop } from "#platform/renderer/desktop.svelte";
  import {
    hasTrack,
    RECORDING_DRAG_TYPE,
    selectedTrack,
    type EditorView,
    type WorkspaceSelection,
  } from "./selection.ts";
  import {
    untranscribedRecordings,
    unprocessedRecordings,
  } from "#project-document/renderer/recordingJobs";

  let { project, initialTime = 0 }: { project: Project; initialTime?: number } = $props();

  const backgrounds = new Backgrounds(() => project);
  const noise = new NoiseStates(() => project);
  const transcriptions = new Transcriptions(() => project);
  let captions = $state(true);
  let selected = $state<WorkspaceSelection | null>(null);
  /** The video, or a recording edited on its own. */
  let view = $state<EditorView>({ type: "video" });
  let workspaceWidth = $state(1100);
  let inspectorWidth = $state(296);
  /** The recording edited on its own. */
  const editing = $derived.by(() => {
    const current = view;
    return current.type === "recording"
      ? project.recordings.find((recording) => recording.id === current.recordingId)
      : undefined;
  });
  /** The clip of the video selected, and its recording. */
  const clip = $derived.by(() => {
    if (view.type !== "video" || selected?.type !== "piece") return undefined;
    const id = selected.pieceId;
    const piece = piecesOf(project).find((piece) => piece.id === id);
    const recording =
      piece && project.recordings.find((recording) => recording.id === piece.recordingId);
    return piece && recording ? { piece, recording } : undefined;
  });
  const inspecting = $derived(!!editing || !!clip);
  const pendingTranscriptions = $derived(
    untranscribedRecordings(project.recordings, transcriptions.states),
  );
  const pendingBackgrounds = $derived(
    unprocessedRecordings(project.recordings, backgrounds.states),
  );

  let deletingRecordingId = $state<string | null>(null);
  let confirmingProjectDelete = $state(false);
  let recordOpen = $state(false);
  let notesOpen = $state(false);
  /** What's being exported, while the export dialog is open. */
  let exporting = $state<ExportSource | null>(null);
  /** Where the playhead was when the export was opened, for its range. */
  let exportPlayhead = $state<number | null>(null);
  let sidebarWidth = $state(264);
  let sidebarMin = $derived(Math.min(208, workspaceWidth * 0.38));
  let sidebarMax = $derived(Math.min(400, workspaceWidth * 0.48));
  let sidebarSize = $derived(Math.min(Math.max(sidebarWidth, sidebarMin), sidebarMax));
  let inspectorMin = $derived(Math.min(264, workspaceWidth * 0.7));
  // Leave at least 320px for the editor when both side panes are docked.
  let inspectorMax = $derived(Math.min(440, Math.max(264, workspaceWidth - sidebarSize - 324)));
  let inspectorSize = $derived(Math.min(Math.max(inspectorWidth, inspectorMin), inspectorMax));
  let player = $state<ProjectPlayer>();
  let playback = $state<TranscriptPlayback>({ parts: [], time: 0, ready: false });
  let exports = $state<ProjectExports>();
  /** The recording the player is on. */
  let playing = $state<string | null>(null);
  /** Whether the video has the whole editor, with the panels around it hidden. */
  let expanded = $state(false);

  let takes = $derived(project.recordings.length);
  /** The recordings the video plays some of. */
  let inVideo = $derived(new Set(piecesOf(project).map((piece) => piece.recordingId)));
  // A recording deleted while it's edited goes back to the video.
  $effect(() => {
    if (view.type === "recording" && !editing) showVideo();
  });

  function showVideo(): void {
    view = { type: "video" };
    selected = null;
  }

  /** A recording's actions, the same from its menu button and a right-click. */
  function recordingActions(recording: Recording): MenuEntry[] {
    const directory = recording.directory;
    return [
      {
        label: "Show in folder",
        icon: "folder",
        disabled: !directory,
        onselect: () => {
          if (directory) void window.chord.desktop.recording.reveal(directory);
        },
      },
      "separator",
      {
        label: "Delete recording",
        icon: "trash",
        destructive: true,
        onselect: () => {
          if (project.recordings.some((item) => item.id === recording.id))
            deletingRecordingId = recording.id;
        },
      },
    ];
  }

  function recordingContextMenu(event: MouseEvent, recording: Recording): void {
    if ((event.target as HTMLElement).closest("[role=menu]")) return;
    openContextMenu(event, recordingActions(recording));
  }

  /**
   * Edits a recording on its own, from `time` on its own timeline. Going from one recording to another keeps the
   * same track's settings open, where it has that track.
   */
  // A search result opens its recording where the words are said.
  onMount(() => {
    const route = router.current;
    if (route.name === "project" && route.id === project.id && route.recording)
      openRecording(route.recording.id, route.recording.time);
  });

  function openRecording(recordingId: string, time = 0): void {
    const recording = project.recordings.find((r) => r.id === recordingId);
    if (!recording) return;
    const track = view.type === "recording" ? selectedTrack(selected) : undefined;
    view = { type: "recording", recordingId, time };
    const nextTrack =
      track && hasTrack(recording, track)
        ? track
        : recording.hasMicrophone
          ? "microphone"
          : recording.mode
            ? "screen"
            : recording.hasCamera
              ? "camera"
              : recording.hasSystemAudio
                ? "systemAudio"
                : undefined;
    const layer = visualLayersOf(recording).find((layer) => layer.kind === nextTrack);
    selected = {
      type: "recording",
      recordingId,
      ...(nextTrack && { track: nextTrack }),
      ...(layer && { layerId: layer.id }),
    };
  }
</script>

<TopBar
  onBack={() => router.back()}
  backLabel="Projects"
  heading={project.name || "Untitled project"}
/>

{#snippet recordingRow(recording: Recording, index: number)}
  {@const current = recording.id === playing}
  {@const active = editing?.id === recording.id}
  {@const transcription = recording.directory
    ? transcriptions.states[recording.directory]
    : undefined}
  {@const background = recording.directory ? backgrounds.states[recording.directory] : undefined}
  {@const failed = transcription?.phase === "failed" || background?.phase === "failed"}
  {@const busy =
    transcription?.phase === "queued" ||
    transcription?.phase === "transcribing" ||
    background?.phase === "queued" ||
    background?.phase === "processing"}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <li
    class={[
      "group/recording relative flex h-9 items-center rounded-md transition",
      active
        ? "bg-glass-800 text-neutral-50"
        : "text-glass-300 hover:bg-glass-800/60 hover:text-neutral-100",
    ]}
    data-recording-row={recording.id}
    aria-current={current || undefined}
    draggable={!!recording.directory}
    oncontextmenu={(event) => recordingContextMenu(event, recording)}
    ondragstart={(event) => {
      event.dataTransfer?.setData(RECORDING_DRAG_TYPE, recording.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    }}
  >
    <button
      class="flex h-full min-w-0 flex-1 items-center gap-2.5 px-2.5 text-left text-xs"
      onclick={() => openRecording(recording.id)}
      aria-label={`Edit recording ${index + 1}`}
      aria-pressed={active}
      title={formatDateTime(recording.createdAt)}
    >
      <Icon
        name={recording.mode ? "monitor" : recording.hasCamera ? "camera" : "mic"}
        class="size-3.5 shrink-0 text-glass-500"
      />
      <span class="min-w-0 flex-1 truncate">Recording {index + 1}</span>
      {#if failed}<span
          class="size-1.5 shrink-0 rounded-full bg-amber-300"
          role="img"
          aria-label="Processing needs attention"
          title="Processing needs attention"
        ></span>
      {:else if busy}<span
          class="size-1.5 shrink-0 animate-pulse rounded-full bg-primary"
          role="img"
          aria-label="Processing recording"
          title="Processing recording"
        ></span>{/if}
      <span
        class="shrink-0 text-glass-500 tabular-nums group-focus-within/recording:invisible group-hover/recording:invisible"
        >{formatDuration(recording.duration)}</span
      >
    </button>
    <div class="absolute inset-y-0 right-1 flex items-center rounded-md">
      {#if recording.directory && !inVideo.has(recording.id)}
        <button
          class="flex size-7 items-center justify-center rounded-md text-glass-500 opacity-0 hover:bg-glass-700 hover:text-neutral-100 group-focus-within/recording:opacity-100 group-hover/recording:opacity-100"
          onclick={() => projectEdits.addToTracks(project, recording.id)}
          aria-label={`Add recording ${index + 1} to the video`}
          title="Add to video"
        >
          <Icon name="plus" class="size-3.5" />
        </button>
      {/if}
      <RecordingActions
        label={`Recording ${index + 1}`}
        entries={() => recordingActions(recording)}
      />
    </div>
  </li>
{/snippet}

<header class="flex h-12 shrink-0 items-center gap-3 border-y border-glass-800 px-3">
  <div class="flex min-w-0 flex-1 items-center gap-1">
    <input
      class="field-sizing-content min-w-24 max-w-full rounded-lg bg-transparent px-2 py-1 text-base font-semibold tracking-tight text-neutral-50 hover:bg-glass-900 focus:bg-glass-900"
      bind:value={project.name}
      oninput={() => projectStore.touch(project)}
      onkeydown={(event) => event.key === "Enter" && event.currentTarget.blur()}
      aria-label="Project name"
    />
    <Menu align="start">
      {#snippet trigger({ toggle, open })}
        <button
          class="flex size-7 items-center justify-center rounded-md text-glass-400 transition hover:bg-glass-800 hover:text-neutral-100"
          onclick={() => {
            confirmingProjectDelete = false;
            toggle();
          }}
          aria-label="Project actions"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Icon name="more" />
        </button>
      {/snippet}
      {#snippet children({ close })}
        {@const directory = project.recordings.find((recording) => recording.directory)?.directory}
        <MenuEntries
          {close}
          entries={[
            {
              label: "Show in folder",
              icon: "folder",
              disabled: !directory,
              onselect: () => {
                if (directory)
                  void window.chord.desktop.recording.reveal(
                    directory.split("/").slice(0, -1).join("/"),
                  );
              },
            },
            "separator",
            {
              label: "Delete project",
              icon: "trash",
              destructive: true,
              onselect: () => (confirmingProjectDelete = true),
            },
          ]}
        />
      {/snippet}
    </Menu>
  </div>
  {#if takes > 0}
    {@const source = player?.exportSource()}
    <button
      class="flex h-8 shrink-0 items-center justify-center rounded-lg bg-primary px-4 text-xs font-semibold text-white transition enabled:hover:bg-primary-hover disabled:opacity-50"
      disabled={!source}
      onclick={() => {
        exportPlayhead = player?.videoPlayhead() ?? null;
        exporting = source ?? null;
      }}
    >
      Export
    </button>
  {/if}
</header>

<div
  class="relative flex min-h-0 flex-1 overflow-hidden"
  bind:clientWidth={workspaceWidth}
  data-project-workspace
>
  {#if !expanded}
    <aside
      id="project-sidebar"
      class="@container flex min-h-0 shrink-0 flex-col bg-glass-900/40"
      style:width={`${sidebarSize}px`}
      aria-label="Project"
    >
      {#if takes > 0}
        <div class="shrink-0 border-b border-glass-800 p-2">
          <button
            class={[
              "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-xs transition",
              view.type === "video"
                ? "bg-glass-800 text-neutral-50"
                : "text-glass-300 hover:bg-glass-800/60 hover:text-neutral-100",
            ]}
            onclick={showVideo}
            aria-pressed={view.type === "video"}
            data-video
          >
            <Icon name="film" class="size-3.5 shrink-0 text-glass-500" />
            <span class="min-w-0 flex-1 truncate">Video</span>
          </button>
        </div>
      {/if}
      <PanelHeader title="Recordings">
        {#snippet actions()}
          {#if takes > 0 && (pendingTranscriptions.length || pendingBackgrounds.length)}
            <Menu align="end">
              {#snippet trigger({ toggle, open })}
                <button
                  class="flex size-7 items-center justify-center rounded-md text-glass-400 transition hover:bg-glass-800 hover:text-neutral-100"
                  onclick={toggle}
                  aria-label="Recording actions"
                  aria-haspopup="menu"
                  aria-expanded={open}><Icon name="more" class="size-3.5" /></button
                >
              {/snippet}
              {#snippet children({ close })}
                {#if pendingTranscriptions.length}
                  <MenuAction
                    disabled={!desktop.preferences.transcriptionModel}
                    title={desktop.preferences.transcriptionModel
                      ? undefined
                      : "Set up transcription in settings"}
                    onclick={() => {
                      void Promise.all(
                        pendingTranscriptions.map((recording) =>
                          transcriptions.run(recording.directory!),
                        ),
                      );
                      close();
                    }}
                  >
                    Transcribe {pendingTranscriptions.length}
                    {pendingTranscriptions.length === 1 ? "recording" : "recordings"}
                  </MenuAction>
                {/if}
                {#if pendingBackgrounds.length}
                  <MenuAction
                    disabled={!desktop.preferences.backgroundModel}
                    title={desktop.preferences.backgroundModel
                      ? undefined
                      : "Set up background removal in settings"}
                    onclick={() => {
                      void Promise.all(
                        pendingBackgrounds.map((recording) =>
                          backgrounds.run(recording.directory!),
                        ),
                      );
                      close();
                    }}
                  >
                    Remove {pendingBackgrounds.length} camera {pendingBackgrounds.length === 1
                      ? "background"
                      : "backgrounds"}
                  </MenuAction>
                {/if}
              {/snippet}
            </Menu>
          {/if}
          <PanelButton icon="plus" label="New recording" onclick={() => (recordOpen = true)} />
        {/snippet}
      </PanelHeader>
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-recordings-list>
        <ol class="flex flex-col gap-0.5 p-2" aria-label="Recordings">
          {#each project.recordings as recording, index (recording.id)}
            {@render recordingRow(recording, index)}
          {/each}
        </ol>
        {#key projectFolder(project)}
          <ProjectExports folder={projectFolder(project)} bind:this={exports} />
        {/key}
      </div>
      <div class="shrink-0 border-t border-glass-800 p-2">
        <button
          class="flex h-8 w-full shrink-0 items-center gap-2.5 rounded-md px-2.5 text-left text-xs text-glass-300 hover:bg-glass-800/60 hover:text-neutral-100"
          onclick={() => (notesOpen = true)}
          aria-haspopup="dialog"
          aria-controls="project-notes"
        >
          <Icon name="notes" class="size-3.5 shrink-0 text-glass-500" />
          <span class="min-w-0 flex-1">Notes</span>
        </button>
      </div>
    </aside>

    <PanelResize
      orientation="vertical"
      label="Recordings panel width"
      value={sidebarSize}
      min={sidebarMin}
      max={sidebarMax}
      defaultValue={264}
      onresize={(value) => (sidebarWidth = value)}
    />
  {/if}

  <main class="flex min-h-0 min-w-0 flex-1 flex-col">
    <!-- Rebuilt when a take is added or removed. -->
    {#key project.recordings.map((r) => `${r.id}:${r.directory}`).join()}
      <ProjectPlayer
        {project}
        {view}
        {initialTime}
        transcripts={transcriptions.states}
        backgroundStates={backgrounds.states}
        noiseStates={noise.states}
        bind:captions
        bind:this={player}
        bind:selected
        bind:current={playing}
        bind:playback
        bind:expanded
        onrecord={() => (recordOpen = true)}
        onframe={() => void exports?.refresh()}
        onopen={openRecording}
        onvideo={showVideo}
        ondeleteRecording={(id) => (deletingRecordingId = id)}
      />
    {/key}
  </main>
  {#if inspecting && !expanded}
    <PanelResize
      orientation="vertical"
      label="Inspector width"
      value={inspectorSize}
      min={inspectorMin}
      max={inspectorMax}
      defaultValue={296}
      reverse
      onresize={(value) => (inspectorWidth = value)}
    />
    <aside
      id="recording-inspector"
      aria-label="Inspector"
      class="flex min-h-0 shrink-0 flex-col bg-glass-900/40"
      style:width={`${inspectorSize}px`}
    >
      {#if editing}
        <RecordingInspector
          {project}
          recording={editing}
          {selected}
          {backgrounds}
          {noise}
          {transcriptions}
          {playback}
          onseek={(time) => void player?.seekTranscript(time)}
          ontoggle={() => player?.toggleTranscript()}
          oncut={(id, ranges) => void player?.cutTranscript(id, ranges)}
          onrestore={(id, start, end) => void player?.restoreTranscript(id, start, end)}
          onundo={() => void player?.undoTranscriptCut()}
          onrecut={(id, cuts) => player?.recut(id, cuts)}
          onselect={(selection) => (selected = selection)}
        />
      {:else if clip}
        <ClipInspector
          {project}
          recording={clip.recording}
          piece={clip.piece}
          part={playback.parts.find((part) => part.pieceId === clip.piece.id)}
          onopen={() => openRecording(clip.recording.id)}
        />
      {/if}
    </aside>
  {/if}
</div>

{#if recordOpen}
  <RecordDialog {project} onclose={() => (recordOpen = false)} />
{/if}

{#if notesOpen}
  <NotesDialog {project} onclose={() => (notesOpen = false)} />
{/if}

{#if exporting}
  <ExportDialog
    {project}
    source={exporting}
    playhead={exportPlayhead}
    onexported={() => void exports?.refresh()}
    onclose={() => (exporting = null)}
  />
{/if}

{#if confirmingProjectDelete}
  <ProjectDeleteConfirmation
    {project}
    onclose={() => (confirmingProjectDelete = false)}
    ondelete={() => router.back()}
  />
{/if}

{#if deletingRecordingId}
  {@const recording = project.recordings.find((recording) => recording.id === deletingRecordingId)}
  {#if recording}
    <RecordingDeleteConfirmation
      {project}
      {recording}
      onclose={() => (deletingRecordingId = null)}
    />
  {/if}
{/if}
