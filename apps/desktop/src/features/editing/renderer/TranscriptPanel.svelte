<script lang="ts">
  import { tick } from "svelte";
  import {
    TranscriptSelection,
    TRANSCRIPT_ITEM as ITEM,
    transcriptItemId as itemId,
  } from "./transcript/transcriptSelection.svelte.ts";
  import type { Recording } from "#project-document/domain/recording";
  import type { Transcriptions } from "#features/transcription/renderer/transcriptions.svelte";
  import { desktop } from "#platform/renderer/desktop.svelte";
  import { settings } from "#features/settings/renderer/settings.svelte";
  import { formatDuration } from "#shared/domain/format";
  import { cutEdgeBounds, moveCutEdge, keptRanges } from "../domain/cuts.ts";
  import {
    keptLength,
    SILENCE_PADDING,
    silenceAt,
    silenceCut,
    transcriptCutMarkers,
    transcriptRecordedSpan,
    transcriptPosition,
    transcriptRanges,
    transcriptSessionTime,
    transcriptSilences,
    transcriptWords,
    wordCutState,
    wordOccurrences,
    wordSeekTime,
    type TranscriptCut,
    type TranscriptPlayback,
  } from "#media-engine/renderer/transcript";
  import Icon, { type IconName } from "@teamblocks.dev/chord-ui/Icon.svelte";
  import Menu from "@teamblocks.dev/chord-ui/Menu.svelte";
  import Segmented from "@teamblocks.dev/chord-ui/Segmented.svelte";
  import { pressed } from "#features/settings/renderer/shortcuts.svelte";
  import Select from "@teamblocks.dev/chord-ui/Select.svelte";
  import Slider from "@teamblocks.dev/chord-ui/Slider.svelte";

  /** A recording's transcript, to correct and to cut it by. `playback` plays the recording on its own. */
  let {
    recording,
    transcriptions,
    playback,
    onseek,
    ontoggle,
    oncut,
    onrestore,
    onrecut,
    onundo,
  }: {
    recording: Recording;
    transcriptions: Transcriptions;
    playback: TranscriptPlayback;
    onseek: (time: number) => void;
    ontoggle: () => void;
    oncut: (recordingId: string, ranges: TranscriptCut[]) => void;
    onrecut: (recordingId: string, cuts: TranscriptCut[]) => void;
    onrestore: (recordingId: string, start: number, end: number) => void;
    onundo: () => void;
  } = $props();
  let selectedTrack = $state("");
  let saving = $state(0);
  let error = $state("");
  /** Silences longer than this, in seconds, are the ones removed. */
  let silenceLimit = $state(1);
  /** How much of each removed silence is kept next to the words either side, in seconds. */
  let silencePadding = $state(SILENCE_PADDING);
  /** Padding up to half the shortest silence removed, so each one still loses something. */
  const paddingMax = $derived(silenceLimit / 2);
  const padding = $derived(Math.min(silencePadding, paddingMax));
  /** Whether the silence removal options are open, showing which silences they'd remove. */
  let removingSilences = $state(false);
  /** The words being retyped, as indexes into `targets`. */
  let editing = $state<{ from: number; to: number; draft: string } | null>(null);
  const interaction: TranscriptSelection = new TranscriptSelection({
    ready: () => playback.ready,
    cuts: () => cuts,
    duration: () => timeline?.duration ?? recording.duration,
    recordedItems: () => recordedItems,
    resetKey: () => `${recording.id}:${track ?? ""}`,
    onrecut: (draft) => onrecut(recording.id, draft),
    onactivate: (id) => {
      const item =
        targets.find((word) => word.id === id) ?? silences.find((silence) => silence.id === id);
      if (item) seekWord(item);
    },
  });
  const readSelection = interaction.read;
  const clearSelection = interaction.clear;
  const onTextPointerDown = interaction.down;
  const onTextPointerMove = interaction.move;
  const endTextPointer = interaction.end;
  const startCutDrag = interaction.startCutDrag;
  const jobState = $derived(
    recording.directory ? transcriptions.states[recording.directory] : undefined,
  );
  const busy = $derived(jobState?.phase === "queued" || jobState?.phase === "transcribing");
  const tracks = $derived([...new Set(jobState?.transcript?.cues.map((cue) => cue.trackId) ?? [])]);
  const track = $derived(tracks.includes(selectedTrack) ? selectedTrack : tracks[0]);
  const cues = $derived(jobState?.transcript?.cues.filter((cue) => cue.trackId === track) ?? []);
  const parts = $derived(playback.parts);
  const timeline = $derived(
    playback.timeline ?? parts.find((part) => part.recordingId === recording.id)?.timeline,
  );
  const ranges = $derived(
    transcriptRanges(
      interaction.cutDraft && timeline
        ? keptRanges(interaction.cutDraft, timeline.duration).map((range, index) => ({
            pieceId: `cut-preview:${index}`,
            recordingId: recording.id,
            timeline,
            start: range.start,
            end: range.end,
            offset: range.start,
          }))
        : parts,
      recording.id,
    ),
  );
  const words = $derived(transcriptWords(cues));
  const targets = $derived(
    words.map((word) => ({
      ...word,
      cut: wordCutState(word, ranges),
      occurrences: wordOccurrences(word, ranges),
    })),
  );
  /** The recording's own session time, leaving out pauses. */
  const recorded = $derived(
    timeline?.clips.map((clip) => ({ start: clip.start, end: clip.start + clip.duration })) ?? [],
  );
  const silences = $derived(
    transcriptSilences(words, recorded).map((silence) => {
      const kept = keptLength(silence, ranges);
      const cut =
        kept < 1e-6
          ? ("cut" as const)
          : kept < silence.length - 1e-6
            ? ("partial" as const)
            : ("kept" as const);
      return {
        ...silence,
        kept,
        cut,
        occurrences: wordOccurrences({ ...silence, text: "" }, ranges),
      };
    }),
  );
  /** Each silence by the index of the word before it. */
  const silenceAfter = $derived(new Map(silences.map((silence) => [silence.after, silence])));
  /** The words and silences in the order they were said. */
  const sequence = $derived.by(() => {
    const items: (
      | { kind: "word"; index: number; id: string; start: number; end: number }
      | {
          kind: "silence";
          silence: (typeof silences)[number];
          id: string;
          start: number;
          end: number;
        }
    )[] = [];
    const add = (after: number) => {
      const silence = silenceAfter.get(after);
      if (silence)
        items.push({
          kind: "silence",
          silence,
          id: silence.id,
          start: silence.start,
          end: silence.end,
        });
    };
    add(-1);
    targets.forEach((word, index) => {
      items.push({ kind: "word", index, id: word.id, start: word.start, end: word.end });
      add(index);
    });
    return items;
  });
  const cuts = $derived(interaction.cutDraft ?? recording.cuts ?? []);
  const recordedItems = $derived(
    sequence.flatMap((item) => {
      const span = transcriptRecordedSpan(item, timeline?.clips ?? []);
      return span ? [{ id: item.id, ...span }] : [];
    }),
  );
  const cutMarkers = $derived(playback.ready ? transcriptCutMarkers(cuts, recordedItems) : []);
  /** Shade the text and spaces between each pair of cut lines, including partial words. */
  const cutHighlights = $derived.by(() => {
    const items = new Map<string, string[]>();
    const gaps = new Set<number>();
    const indexes = new Map(sequence.map((item, index) => [item.id, index]));
    for (let index = 0; index < cutMarkers.length; index += 2) {
      const start = cutMarkers[index];
      const end = cutMarkers[index + 1];
      const from = indexes.get(start.id)!;
      const to = indexes.get(end.id)!;
      for (let at = from; at <= to; at++) {
        const left = (at === from ? start.progress : 0) * 100;
        const right = (at === to ? end.progress : 1) * 100;
        const id = sequence[at].id;
        const layers = items.get(id) ?? [];
        layers.push(
          `linear-gradient(to right, transparent ${left}%, rgb(0 0 0 / 45%) ${left}%, rgb(0 0 0 / 45%) ${right}%, transparent ${right}%)`,
        );
        items.set(id, layers);
        if (at < to) gaps.add(at);
      }
    }
    return { items: new Map([...items].map(([id, layers]) => [id, layers.join(", ")])), gaps };
  });
  const selected = $derived(new Set(interaction.ids));
  const longSilences = $derived(silences.filter((silence) => silence.kept > silenceLimit + 1e-6));
  /** Preview the same source ranges the removal action cuts, measured without recording pauses. */
  const silencePreviews = $derived.by(() => {
    const previews = new Map<
      string,
      { start: number; end: number; removed: number; kept: number }
    >();
    if (!removingSilences || !playback.ready || !timeline) return previews;
    for (const silence of longSilences) {
      const cut = silenceCut(silence, words.length, padding);
      const span = transcriptRecordedSpan(silence, timeline.clips);
      const removedSpan = transcriptRecordedSpan(cut, timeline.clips);
      if (!span || !removedSpan) continue;
      const removed = keptLength(cut, ranges);
      previews.set(silence.id, {
        start: (removedSpan.start - span.start) / (span.end - span.start),
        end: (removedSpan.end - span.start) / (span.end - span.start),
        removed,
        kept: Math.max(0, silence.kept - removed),
      });
    }
    return previews;
  });
  const position = $derived(
    playback.ready ? transcriptPosition(words, ranges, playback.time) : undefined,
  );
  const sessionTime = $derived(
    playback.ready ? transcriptSessionTime(ranges, playback.time) : undefined,
  );
  const currentSilence = $derived(
    sessionTime === undefined ? undefined : silenceAt(silences, sessionTime),
  );
  const currentWord = $derived(currentSilence ? undefined : position?.id);
  const estimated = $derived(words.some((word) => word.estimated));

  const selectedIndexes = $derived(
    targets.flatMap((word, index) => (interaction.ids.includes(word.id) ? [index] : [])),
  );
  const selectedWords = $derived(selectedIndexes.map((index) => targets[index]));
  const keptSelected = $derived(selectedWords.filter((word) => word.occurrences.length > 0));
  const cutSelected = $derived(selectedWords.filter((word) => word.cut !== "kept"));
  const selectedSilences = $derived(
    silences.filter((silence) => interaction.ids.includes(silence.id)),
  );
  const keptSilences = $derived(selectedSilences.filter((silence) => silence.cut !== "cut"));
  const cutSilences = $derived(selectedSilences.filter((silence) => silence.cut !== "kept"));
  const longSelected = $derived(
    selectedSilences.filter((silence) => silence.kept > silenceLimit + 1e-6),
  );
  const canCut = $derived(playback.ready && (keptSelected.length > 0 || keptSilences.length > 0));
  const canRestore = $derived(
    playback.ready &&
      (cutSelected.length > 0 || cutSilences.length > 0) &&
      parts.some((part) => part.recordingId === recording.id),
  );
  const selectionLabel = $derived(
    [
      selectedWords.length &&
        `${selectedWords.length} ${selectedWords.length === 1 ? "word" : "words"}`,
      selectedSilences.length &&
        `${selectedSilences.length} ${selectedSilences.length === 1 ? "silence" : "silences"}`,
    ]
      .filter(Boolean)
      .join(" and "),
  );

  $effect(() => {
    if (!tracks.includes(selectedTrack)) selectedTrack = tracks[0] ?? "";
  });
  const button =
    "h-8 rounded-md bg-glass-800 px-3 text-xs text-neutral-100 hover:bg-glass-700 disabled:opacity-50";
  const limits = [0.5, 1, 2, 3].map((value) => ({ value, label: `${value}s` }));
  const action =
    "flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] text-glass-300 transition hover:bg-glass-800 hover:text-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent";

  /** Cut selected words and intervening silences, keeping padding next to words at either end. */
  function cutSelection(): void {
    if (!canCut) return;
    const trimmed = keptSilences.map((silence) => silenceCut(silence, words.length));
    const cuts = keptSelected.length
      ? [
          {
            start: Math.min(
              ...keptSelected.map((word) => word.start),
              ...trimmed.map((cut) => cut.start),
            ),
            end: Math.max(
              ...keptSelected.map((word) => word.end),
              ...trimmed.map((cut) => cut.end),
            ),
          },
        ]
      : trimmed;
    clearSelection();
    oncut(recording.id, cuts);
    interaction.element?.focus({ preventScroll: true });
  }

  function removeSilences(list: TranscriptCut[]): void {
    if (!playback.ready || !list.length) return;
    clearSelection();
    oncut(recording.id, list);
    interaction.element?.focus({ preventScroll: true });
  }

  function restoreSelection(): void {
    if (!canRestore) return;
    const start = Math.min(
      ...cutSelected.map((word) => word.start),
      ...cutSilences.map((silence) => silence.start),
    );
    const end = Math.max(
      ...cutSelected.map((word) => word.end),
      ...cutSilences.map((silence) => silence.end),
    );
    clearSelection();
    onrestore(recording.id, start, end);
    interaction.element?.focus({ preventScroll: true });
  }

  /** Retype words in place. Words sharing one timing are corrected together. */
  async function startEditing(from: number, to: number): Promise<void> {
    if (busy || from < 0) return;
    const same = (a: (typeof targets)[number], b: (typeof targets)[number]) =>
      a.cueId === b.cueId && a.item === b.item;
    while (from > 0 && same(targets[from - 1], targets[from])) from--;
    while (to < targets.length - 1 && same(targets[to + 1], targets[to])) to++;
    clearSelection();
    editing = {
      from,
      to,
      draft: targets
        .slice(from, to + 1)
        .map((word) => word.text)
        .join(" "),
    };
    await tick();
    interaction.element?.querySelector<HTMLInputElement>("[data-word-editor]")?.select();
  }

  async function finishEditing(save: boolean): Promise<void> {
    const edit = editing;
    if (!edit) return;
    editing = null;
    const [first, last] = [targets[edit.from], targets[edit.to]];
    const text = edit.draft.trim().replace(/\s+/g, " ");
    interaction.element?.focus({ preventScroll: true });
    if (
      !save ||
      !text ||
      !recording.directory ||
      text ===
        targets
          .slice(edit.from, edit.to + 1)
          .map((word) => word.text)
          .join(" ")
    )
      return;
    saving++;
    error = "";
    try {
      await window.chord.desktop.transcription.replace(
        recording.directory,
        { cue: first.cueId, word: first.item },
        { cue: last.cueId, word: last.item },
        text,
      );
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      saving--;
    }
  }

  function seekWord(word: { occurrences: { start: number; end: number }[] }): void {
    // Releasing a selection also fires a click; it must not move the playhead.
    if (!playback.ready || readSelection().length) return;
    const time = wordSeekTime(word.occurrences, playback.time);
    if (time === undefined) return;
    onseek(time);
  }

  /** The word or silence an element shows. */
  function itemOf(
    element: Element | null | undefined,
  ): { occurrences: { start: number; end: number }[] } | undefined {
    if (!(element instanceof HTMLElement)) return undefined;
    const id = itemId(element);
    return targets.find((word) => word.id === id) ?? silences.find((silence) => silence.id === id);
  }

  function cutBounds(index: number, edge: "start" | "end"): { min: number; max: number } {
    return cutEdgeBounds(cuts, index, edge, timeline?.duration ?? recording.duration);
  }

  function moveCut(index: number, edge: "start" | "end", time: number): TranscriptCut[] {
    return moveCutEdge(cuts, index, edge, time, timeline?.duration ?? recording.duration);
  }

  async function onCutKey(
    event: KeyboardEvent,
    index: number,
    edge: "start" | "end",
  ): Promise<void> {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = cutBounds(index, edge);
    const step = (event.shiftKey ? 1 : 0.1) * (event.key === "ArrowLeft" ? -1 : 1);
    const time =
      event.key === "Home"
        ? bounds.min
        : event.key === "End"
          ? bounds.max
          : cuts[index][edge] + step;
    clearSelection();
    onrecut(recording.id, moveCut(index, edge, time));
    await tick();
    interaction.element
      ?.querySelector<HTMLElement>(
        `[data-transcript-cut="${index}"][data-transcript-cut-edge="${edge}"]`,
      )
      ?.focus({ preventScroll: true });
  }

  function onTextDoubleClick(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest("[data-transcript-cut-edge]"))
      return;
    const element =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>("[data-transcript-word]")
        : null;
    const index = targets.findIndex((word) => word.id === element?.dataset.transcriptWord);
    if (index !== -1) void startEditing(index, index);
  }

  function onTextKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || editing) return;
    const command = event.metaKey || event.ctrlKey;
    if (command && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      window.getSelection()?.selectAllChildren(interaction.element!);
      interaction.ids = readSelection();
    } else if (
      command &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "z" &&
      playback.canUndoCut
    ) {
      event.preventDefault();
      clearSelection();
      onundo();
    } else if (event.key === "Backspace" || event.key === "Delete") {
      interaction.ids = readSelection();
      if (!interaction.ids.length) return;
      event.preventDefault();
      cutSelection();
    } else if (event.key === "Escape") {
      event.preventDefault();
      clearSelection();
    } else if (event.key === "Enter" && selectedIndexes.length) {
      event.preventDefault();
      void startEditing(selectedIndexes[0], selectedIndexes.at(-1)!);
    } else if (pressed(event, "playPause")) {
      // Play or pause from where the playhead was just set, without leaving the transcript.
      event.preventDefault();
      if (!event.repeat && playback.ready) ontoggle();
    } else if (event.key === "Enter") {
      const item = itemOf(event.target instanceof HTMLElement ? event.target.closest(ITEM) : null);
      if (!item) return;
      event.preventDefault();
      seekWord(item);
    }
  }

  function formatSilence(seconds: number): string {
    return seconds >= 60
      ? formatDuration(seconds)
      : seconds >= 10
        ? `${Math.round(seconds)}s`
        : `${seconds.toFixed(1)}s`;
  }
</script>

<svelte:document onselectionchange={() => (interaction.ids = readSelection())} />

<!-- eslint-disable svelte/no-useless-mustaches -- Explicit spaces preserve transcript word boundaries. -->

{#snippet gap(at: number)}
  {@const next = sequence[at + 1]}
  <span
    class="transcript-gap"
    class:cut={cutHighlights.gaps.has(at)}
    class:selected={!!next && selected.has(sequence[at].id) && selected.has(next.id)}>{" "}</span
  >
{/snippet}

{#snippet markers(id: string)}
  {#each cutMarkers.filter((marker) => marker.id === id) as marker (`${marker.index}:${marker.edge}`)}
    {@const cut = cuts[marker.index]}
    {@const bounds = cutBounds(marker.index, marker.edge)}
    <span
      role="slider"
      tabindex="0"
      class="transcript-cut-marker"
      data-transcript-cut={marker.index}
      data-transcript-cut-edge={marker.edge}
      style:--cut-progress={marker.progress}
      aria-label={`Transcript cut ${marker.index + 1} ${marker.edge}`}
      aria-orientation="horizontal"
      aria-valuemin={bounds.min}
      aria-valuemax={bounds.max}
      aria-valuenow={cut[marker.edge]}
      aria-valuetext={`${cut[marker.edge].toFixed(2)} seconds`}
      title={`Cut ${marker.edge} at ${cut[marker.edge].toFixed(2)}s. Drag to adjust, or use the arrow keys.`}
      onpointerdown={(event) => startCutDrag(event, marker.index, marker.edge)}
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => void onCutKey(event, marker.index, marker.edge)}
    ></span>
  {/each}
{/snippet}

{#snippet transcriptSilence(silence: (typeof silences)[number], at: number)}
  {#if !editing || silence.after < editing.from || silence.after >= editing.to}
    {@const kept = playback.ready && silence.cut !== "cut"}
    {@const current = currentSilence?.id === silence.id}
    {@const preview = silencePreviews.get(silence.id)}
    {@const previewLabel = preview
      ? `${silence.length.toFixed(2)}s of silence: remove ${preview.removed.toFixed(2)}s, keep ${preview.kept.toFixed(2)}s`
      : undefined}
    <span class="transcript-item" style:background-image={cutHighlights.items.get(silence.id)}
      ><span
        role="button"
        tabindex={kept ? 0 : -1}
        class="transcript-silence"
        class:cut={!kept}
        class:preview={!!preview}
        class:selected={selected.has(silence.id)}
        class:current
        data-transcript-silence={silence.id}
        style:--length={Math.min(silence.length, 8)}
        data-silence-preview={preview ? "" : undefined}
        style:--remove-from={preview?.start}
        style:--remove-to={preview?.end}
        style:--progress={current
          ? (sessionTime! - silence.start) / (silence.end - silence.start)
          : undefined}
        aria-current={current ? "time" : undefined}
        aria-disabled={!kept}
        aria-label={previewLabel}
        title={previewLabel ??
          (!kept
            ? `${formatSilence(silence.length)} of silence, cut from the video`
            : `${formatSilence(silence.length)} of silence. Seek to ${formatDuration(wordSeekTime(silence.occurrences, playback.time)!)}`)}
        onclick={(event) => {
          if (event.detail === 0) seekWord(silence);
        }}
        onkeydown={onTextKeyDown}
        >{preview ? `−${formatSilence(preview.removed)}` : formatSilence(silence.length)}</span
      >{@render markers(silence.id)}</span
    >{@render gap(at)}
  {/if}
{/snippet}

{#snippet transcriptWord(index: number, at: number)}
  {@const word = targets[index]}
  {#if editing && index === editing.from}
    <input
      data-word-editor
      class="field-sizing-content min-w-8 max-w-full rounded-[3px] bg-glass-800 px-1 text-sm leading-6 text-neutral-50 outline-1 outline-primary"
      aria-label="Correct words"
      maxlength={500}
      bind:value={editing.draft}
      onkeydown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void finishEditing(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          void finishEditing(false);
        }
      }}
      onblur={() => void finishEditing(true)}
    />{" "}
  {:else if !editing || index < editing.from || index > editing.to}
    {@const kept = word.occurrences.length > 0}
    <span class="transcript-item" style:background-image={cutHighlights.items.get(word.id)}
      ><span
        role="button"
        tabindex={playback.ready && kept ? 0 : -1}
        class="transcript-word"
        class:cut={playback.ready && !kept}
        class:current={currentWord === word.id}
        class:selected={selected.has(word.id)}
        data-transcript-word={word.id}
        style:--progress={currentWord === word.id ? position!.progress : undefined}
        aria-current={currentWord === word.id ? "time" : undefined}
        aria-disabled={!playback.ready || !kept}
        title={!kept
          ? "Cut from the video"
          : `Seek to ${formatDuration(wordSeekTime(word.occurrences, playback.time)!)}`}
        onclick={(event) => {
          if (event.detail === 0) seekWord(word);
        }}
        onkeydown={onTextKeyDown}>{word.text}</span
      >{@render markers(word.id)}</span
    >{@render gap(at)}
  {/if}
{/snippet}

{#snippet selectionAction(
  icon: IconName,
  label: string,
  onclick: () => void,
  disabled = false,
  title?: string,
)}
  <button
    class={action}
    {disabled}
    {title}
    onpointerdown={(event) => event.preventDefault()}
    {onclick}
  >
    <Icon name={icon} class="size-4" /><span class="max-w-full truncate">{label}</span>
  </button>
{/snippet}

{#if recording.directory}
  {@const directory = recording.directory}
  <section class="flex flex-col gap-3 p-3" aria-label="Transcript">
    <h3 class="text-xs font-medium text-neutral-100">Transcript</h3>
    {#if busy}
      <p class="text-xs text-glass-400" role="status">
        {jobState?.phase === "queued"
          ? "Waiting"
          : `${jobState?.operation === "timing" ? "Updating timing" : "Transcribing"} ${Math.round((jobState?.progress ?? 0) * 100)}%`}
      </p>
      <button
        class={button}
        onclick={() => void window.chord.desktop.transcription.cancel(directory)}>Cancel</button
      >
    {:else if !desktop.preferences.transcriptionModel}
      <button class={button} onclick={() => settings.open("transcription")}
        >Set up in settings</button
      >
    {:else if !jobState?.transcript}
      <button class={button} disabled={!jobState} onclick={() => void transcriptions.run(directory)}
        >Transcribe</button
      >
    {/if}
    {#if jobState?.error || error}<p class="text-xs text-amber-300" role="alert">
        {error || jobState?.error}
      </p>{/if}
    {#if jobState?.transcript}
      {#if tracks.length > 1}
        <Select
          compact
          label="Microphone track"
          options={tracks.map((id) => ({ value: id, label: id }))}
          bind:value={selectedTrack}
        />
      {/if}
      {#if words.length > 0}
        <div class="flex h-5 items-center justify-between gap-2 text-[11px] text-glass-400">
          <span class="tabular-nums" aria-label="Current playback time"
            >{formatDuration(playback.time)}</span
          >
          <div class="flex items-center gap-3">
            {#if playback.canUndoCut}
              <button
                class="flex items-center gap-1 hover:text-neutral-100"
                onclick={() => {
                  clearSelection();
                  onundo();
                }}
                title="Undo the last cut or restore"><Icon name="undo" class="size-3" />Undo</button
              >
            {/if}
            <Menu align="end" side="top" class="w-64 p-3" panel bind:open={removingSilences}>
              {#snippet trigger({ toggle, open })}
                <button
                  class={[
                    "flex items-center gap-1 hover:text-neutral-100 disabled:opacity-50 disabled:hover:text-glass-400",
                    open && "text-neutral-100",
                  ]}
                  disabled={!playback.ready}
                  aria-expanded={open}
                  onclick={toggle}><Icon name="timer" class="size-3" />Remove silences</button
                >
              {/snippet}
              {#snippet children({ close })}
                <div class="flex flex-col gap-3" aria-label="Remove silences">
                  <div class="flex items-center justify-between gap-3 text-xs text-glass-400">
                    <span class="whitespace-nowrap">Longer than</span>
                    <div class="w-36 min-w-0">
                      <Segmented
                        fill
                        label="Silence length"
                        options={limits}
                        bind:value={silenceLimit}
                      />
                    </div>
                  </div>
                  <label class="flex items-center gap-3 text-xs text-glass-400"
                    ><span class="whitespace-nowrap">Keep</span>
                    <Slider
                      class="min-w-0 flex-1"
                      min={0}
                      max={paddingMax}
                      step="0.05"
                      aria-label="Silence kept at each end"
                      value={padding}
                      oninput={(event) => (silencePadding = event.currentTarget.valueAsNumber)}
                    />
                    <span class="w-10 text-right tabular-nums">{padding.toFixed(2)}s</span>
                  </label>
                  <button
                    class={button}
                    disabled={!longSilences.length}
                    onclick={() => {
                      removeSilences(
                        longSilences.map((silence) => silenceCut(silence, words.length, padding)),
                      );
                      close();
                    }}
                  >
                    {longSilences.length
                      ? `Remove ${longSilences.length} ${longSilences.length === 1 ? "silence" : "silences"}`
                      : "No long silences"}
                  </button>
                </div>
              {/snippet}
            </Menu>
          </div>
        </div>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (This selectable region needs focus for transcript editing shortcuts.) -->
        <div
          bind:this={interaction.element}
          class="transcript-text rounded-lg border border-glass-800 bg-glass-900 p-3 text-sm leading-7 text-neutral-100"
          data-transcript-text
          aria-label="Recording transcript"
          role="region"
          tabindex="0"
          onkeydown={onTextKeyDown}
          onpointerdown={onTextPointerDown}
          onpointermove={onTextPointerMove}
          onpointerup={endTextPointer}
          onpointercancel={endTextPointer}
          onlostpointercapture={endTextPointer}
          ondblclick={onTextDoubleClick}
        >
          {#each sequence as item, at (item.id)}
            {#if item.kind === "word"}{@render transcriptWord(
                item.index,
                at,
              )}{:else}{@render transcriptSilence(item.silence, at)}{/if}
          {/each}
        </div>
        {#if selectedWords.length || selectedSilences.length}
          <div
            class="sticky bottom-2 z-10 flex flex-col gap-1 rounded-xl border border-glass-800 bg-popover p-1.5 shadow-2xl shadow-black/60 backdrop-blur-2xl backdrop-saturate-150"
            aria-label="Transcript selection"
          >
            <span class="truncate px-1.5 pt-0.5 text-[11px] text-glass-400"
              >{selectionLabel} selected</span
            >
            <div class="grid auto-cols-fr grid-flow-col gap-1">
              {#if selectedWords.length}
                {@render selectionAction(
                  "pencil",
                  "Edit",
                  () => void startEditing(selectedIndexes[0], selectedIndexes.at(-1)!),
                  busy || saving > 0,
                  "Correct the text, keeping its timing (Return)",
                )}
              {/if}
              {#if canCut}{@render selectionAction(
                  "scissors",
                  "Cut",
                  cutSelection,
                  false,
                  "Cut from the video (Delete)",
                )}{/if}
              {#if playback.ready && longSelected.length}
                {@render selectionAction(
                  "timer",
                  "Trim silence",
                  () =>
                    removeSilences(
                      longSelected.map((silence) => silenceCut(silence, words.length, padding)),
                    ),
                  false,
                  `Remove silence longer than ${silenceLimit}s`,
                )}
              {/if}
              {#if cutSelected.length}{@render selectionAction(
                  "undo",
                  "Restore",
                  restoreSelection,
                  !canRestore,
                  "Put back into the video",
                )}{/if}
            </div>
          </div>
        {/if}
        {#if estimated}
          <div
            class="flex flex-col items-start gap-2 text-xs text-glass-400"
            aria-label="Word timing"
          >
            <p>Some word positions are estimated.</p>
            {#if !busy && desktop.preferences.transcriptionModel}
              <button
                class={button}
                disabled={saving > 0}
                title="Update word timings from the audio, keeping your text corrections and cuts"
                onclick={() => void transcriptions.run(directory, true)}>Update timing</button
              >
            {/if}
          </div>
        {/if}
      {:else if cues.length === 0}
        <p class="text-xs text-glass-500">No speech heard.</p>
      {/if}
      {#if !busy && desktop.preferences.transcriptionModel}
        <div class="flex items-center gap-4">
          {#if !estimated && words.length}
            <button
              class="w-fit text-xs text-glass-400 hover:text-neutral-100 disabled:opacity-50"
              disabled={saving > 0}
              title="Measure word timings from the audio again, keeping your text corrections and cuts"
              onclick={() => void transcriptions.run(directory, true)}>Update timing</button
            >
          {/if}
          <button
            class="w-fit text-xs text-glass-400 hover:text-neutral-100 disabled:opacity-50"
            disabled={saving > 0}
            onclick={() => void transcriptions.run(directory)}>Transcribe again</button
          >
        </div>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .transcript-text {
    --selection: var(--color-primary);
    overflow-wrap: anywhere;
    user-select: text;
    -webkit-user-select: text;
  }
  /* Selections are drawn over whole words and silences, not the text the pointer covers. */
  .transcript-text :not(input)::selection {
    background: transparent;
  }
  .transcript-word,
  .transcript-gap,
  .transcript-item {
    position: relative;
    display: inline;
    padding-block: 0.1875rem;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }
  .transcript-word {
    cursor: text;
    user-select: text;
    -webkit-user-select: text;
  }
  .transcript-gap.cut {
    background: rgb(0 0 0 / 45%);
  }
  /* Only fully removed words are dimmed. Partial words keep their normal text color. */
  .transcript-word.cut {
    color: var(--color-glass-500);
  }
  .transcript-cut-marker {
    position: absolute;
    z-index: 2;
    left: calc(var(--cut-progress) * 100% - 6px);
    top: 0;
    bottom: 0;
    width: 12px;
    color: rgb(255 255 255 / 40%);
    cursor: ew-resize;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    outline: none;
  }
  .transcript-cut-marker::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    pointer-events: none;
    left: 50%;
    width: 1px;
    transform: translateX(-50%);
    background: currentColor;
    transition:
      width 150ms,
      background-color 150ms;
  }
  .transcript-cut-marker:hover,
  .transcript-cut-marker:focus-visible {
    color: var(--color-primary);
  }
  .transcript-cut-marker:hover::before,
  .transcript-cut-marker:focus-visible::before {
    width: 2px;
  }
  .transcript-word.selected,
  .transcript-gap.selected,
  .transcript-silence.selected {
    background: var(--selection);
    color: white;
  }
  .transcript-silence {
    position: relative;
    display: inline-block;
    /* Longer silences are drawn longer. */
    width: calc(1.5rem + var(--length) * 0.75rem);
    max-width: 100%;
    height: 1.375rem;
    vertical-align: middle;
    border-radius: 0.375rem;
    box-shadow: inset 0 0 0 1px var(--color-glass-800);
    color: var(--color-glass-400);
    font-size: 10px;
    line-height: 1.375rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
    cursor: text;
    user-select: text;
    -webkit-user-select: text;
  }
  /* The center is removed; the lighter ends show the padding that will stay. */
  .transcript-silence.preview {
    color: var(--color-neutral-100);
    box-shadow: inset 0 0 0 1px var(--color-amber-300);
    background: linear-gradient(
      to right,
      rgb(255 255 255 / 8%) 0% calc(var(--remove-from) * 100%),
      rgb(0 0 0 / 45%) calc(var(--remove-from) * 100%) calc(var(--remove-to) * 100%),
      rgb(255 255 255 / 8%) calc(var(--remove-to) * 100%) 100%
    );
  }
  .transcript-silence.preview::after {
    content: "";
    position: absolute;
    inset-block: 1px;
    left: calc(var(--remove-from) * 100%);
    right: calc((1 - var(--remove-to)) * 100%);
    border-inline: 1px solid rgb(255 255 255 / 40%);
    pointer-events: none;
  }
  .transcript-silence.cut {
    color: var(--color-glass-500);
  }
  .transcript-silence.selected {
    box-shadow: none;
  }
  .transcript-word.current::before,
  .transcript-silence.current::before {
    content: "";
    position: absolute;
    /* Moves through the word as it's spoken, from just before its first letter to just after its last. */
    left: calc(var(--progress, 0) * (100% + 4px) - 3px);
    top: 0;
    bottom: 0;
    width: 2px;
    border-radius: 1px;
    background: var(--color-primary-hover);
    pointer-events: none;
  }
</style>
