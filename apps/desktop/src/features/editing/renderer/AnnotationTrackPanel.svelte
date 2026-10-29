<script lang="ts">
  import { projectEdits } from "#features/editing/renderer/edits";
  import { normalizeSpans, type AnnotationSpan } from "../domain/annotations.ts";
  import { ANNOTATION_TOOLS } from "#media-engine/renderer/annotations";

  import { selectedLayerId, type WorkspaceSelection } from "./selection.ts";
  import type { Project, Recording } from "#project-document/domain/recording";
  import {
    CURSOR_SIZE,
    cursorStyleOf,
    visualLayersOf,
    type AnnotationLayer,
    type CursorStyle,
  } from "../domain/visualLayers.ts";
  import Inspector from "@teamblocks.dev/chord-ui/Inspector.svelte";
  import Toggle from "@teamblocks.dev/chord-ui/Toggle.svelte";
  import { mac } from "#features/settings/renderer/shortcuts.svelte";
  import { bindingLabel } from "#features/settings/domain/shortcuts";
  import SliderField from "@teamblocks.dev/chord-ui/SliderField.svelte";

  let {
    project,
    recording,
    layer,
    selected,
    duration,
    onselect,
  }: {
    project: Project;
    recording: Recording;
    layer: AnnotationLayer;
    selected: WorkspaceSelection | null;
    duration: number;
    onselect: (selection: WorkspaceSelection) => void;
  } = $props();
  const kind = $derived(layer.kind);
  const label = $derived(layer.name ?? ANNOTATION_TOOLS[kind].label);
  const spans = $derived(layer.spans);
  const index = $derived(
    selected?.type === "span" && selectedLayerId(selected) === layer.id ? selected.index : -1,
  );
  const span = $derived(spans[index]);
  const throughout = $derived(
    spans.length === 1 && spans[0]!.start === 0 && spans[0]!.end === duration,
  );
  const style = $derived(kind === "cursor" ? cursorStyleOf(layer) : undefined);
  const button =
    "h-8 rounded-md bg-glass-800 px-3 text-xs text-neutral-100 hover:bg-glass-700 disabled:opacity-50";

  function save(next: AnnotationSpan[]): void {
    projectEdits.setVisualLayers(
      project,
      recording,
      visualLayersOf(recording).map((item) =>
        item.id === layer.id ? { ...layer, spans: normalizeSpans(next, duration) } : item,
      ),
    );
  }

  function setStyle(patch: Partial<CursorStyle>): void {
    projectEdits.setVisualLayers(
      project,
      recording,
      visualLayersOf(recording).map((item) =>
        item.id === layer.id ? { ...layer, cursor: { ...cursorStyleOf(layer), ...patch } } : item,
      ),
    );
  }

  function enableThroughout(): void {
    save([{ start: 0, end: duration }]);
    onselect({ type: "recording", recordingId: recording.id, track: kind, layerId: layer.id });
  }

  function duplicateTrack(): void {
    const copy = projectEdits.duplicateAnnotationTrack(
      project,
      recording,
      layer,
      ANNOTATION_TOOLS[kind].label,
    );
    onselect({ type: "recording", recordingId: recording.id, track: kind, layerId: copy.id });
  }

  function removeTrack(): void {
    projectEdits.setVisualLayers(
      project,
      recording,
      visualLayersOf(recording).filter((item) => item.id !== layer.id),
    );
    onselect({ type: "recording", recordingId: recording.id, track: "screen" });
  }

  function removeSpan(): void {
    save(spans.filter((_, i) => i !== index));
    onselect({ type: "recording", recordingId: recording.id, track: kind, layerId: layer.id });
  }
</script>

<Inspector
  title={ANNOTATION_TOOLS[kind].label}
  detail={label === ANNOTATION_TOOLS[kind].label ? undefined : label}
  reveal={recording.directory
    ? () => void window.chord.desktop.recording.reveal(recording.directory!)
    : undefined}
  actions={[
    // A recording draws one cursor.
    ...(kind === "cursor" ? [] : [{ label: "Duplicate track", onselect: duplicateTrack }]),
    {
      label: "Enable throughout recording",
      disabled: duration <= 0 || throughout,
      onselect: enableThroughout,
    },
    ...(span
      ? [{ label: "Remove span", detail: bindingLabel("Backspace", mac), onselect: removeSpan }]
      : []),
    "separator",
    { label: "Remove track", destructive: true, onselect: removeTrack },
  ]}
>
  <section class="flex flex-col gap-3 p-3" aria-label={`${label} controls`}>
    {#if spans.length === 0}<button
        class={button}
        disabled={duration <= 0}
        onclick={enableThroughout}>Enable throughout recording</button
      >{/if}
    {#if style}
      <SliderField
        label="Size"
        ariaLabel="Cursor size"
        value={style.size}
        min={CURSOR_SIZE.min}
        max={CURSOR_SIZE.max}
        step={0.1}
        scale={100}
        suffix="%"
        onchange={(size) => setStyle({ size })}
      />
      <div class="flex items-center justify-between gap-3 text-xs text-glass-400">
        Smooth movement
        <Toggle
          label="Smooth cursor movement"
          bind:checked={() => style.smooth, (smooth) => setStyle({ smooth })}
        />
      </div>
      <div class="flex items-center justify-between gap-3 text-xs text-glass-400">
        Hide when idle
        <Toggle
          label="Hide cursor when idle"
          bind:checked={() => style.hideWhenIdle, (hideWhenIdle) => setStyle({ hideWhenIdle })}
        />
      </div>
    {/if}
  </section>
</Inspector>
