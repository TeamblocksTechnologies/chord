import { projectEdits } from "#features/editing/renderer/edits";
import { cutsOutside, keptRanges, normalizeCuts, type Cut } from "../../domain/cuts.ts";

import type { Project } from "#project-document/domain/recording";
import type { Player } from "#media-engine/renderer/player.svelte";
import type { Part } from "#media-engine/renderer/timeline";
import {
  cutTranscriptRanges,
  restoreTranscriptRange,
  type TranscriptCut,
} from "#media-engine/renderer/transcript";

interface Options {
  project(): Project;
  player(): Player | null;
  recordingId(): string | undefined;
}

/** Recording cleanup commands and their undo history, shared by the transcript and timeline. */
export class CutEditor {
  #options: Options;
  // Use stable ids: persistence can replace a project object without invalidating its undo history.
  #histories = new Map<string, { recordingId: string; before: Cut[]; after: Cut[] }[]>();
  #revision = $state(0);

  constructor(options: Options) {
    this.#options = options;
  }

  get #history() {
    void this.#revision;
    return this.#histories.get(this.#options.project().id) ?? [];
  }
  get #recording() {
    return this.#options
      .project()
      .recordings.find((recording) => recording.id === this.#options.recordingId());
  }

  readonly canUndo = $derived.by(() => {
    const last = this.#history.at(-1);
    const recording = this.#recording;
    return (
      !!last &&
      last.recordingId === recording?.id &&
      JSON.stringify(recording.cuts ?? []) === JSON.stringify(last.after)
    );
  });

  /** Kept ranges stay at recorded time so transcript selections map back to the original audio. */
  readonly keptParts = $derived.by((): Part[] => {
    const recording = this.#recording;
    const part = this.#options.player()?.parts[0];
    if (!recording || !part || part.recordingId !== recording.id) return [];
    return keptRanges(recording.cuts ?? [], part.timeline.duration).map((range, index) => ({
      ...part,
      pieceId: `${part.pieceId}:${index}`,
      offset: range.start,
      start: range.start,
      end: range.end,
    }));
  });

  #durationOf = (recordingId: string): number =>
    this.#options.player()?.timeline(recordingId)?.duration ??
    this.#options.project().recordings.find((recording) => recording.id === recordingId)
      ?.duration ??
    0;

  #remember(history: { recordingId: string; before: Cut[]; after: Cut[] }[]): void {
    this.#histories.set(this.#options.project().id, history);
    this.#revision++;
  }

  cut(recordingId: string, ranges: TranscriptCut[]): void {
    const player = this.#options.player();
    if (!player || player.loading || this.#recording?.id !== recordingId) return;
    const result = cutTranscriptRanges(this.keptParts, recordingId, ranges, player.time, () =>
      crypto.randomUUID(),
    );
    if (result.changed) this.#keepOnly(recordingId, result.parts);
  }

  restore(recordingId: string, start: number, end: number): void {
    const player = this.#options.player();
    if (!player || player.loading || this.#recording?.id !== recordingId) return;
    const result = restoreTranscriptRange(this.keptParts, recordingId, start, end, () =>
      crypto.randomUUID(),
    );
    if (result.inserts.length) this.#keepOnly(recordingId, result.parts);
  }

  #keepOnly(recordingId: string, parts: Part[]): void {
    const timeline = this.#options.player()?.timeline(recordingId);
    if (timeline)
      this.recut(
        recordingId,
        cutsOutside(
          parts.filter((part) => part.recordingId === recordingId),
          timeline.duration,
        ),
      );
  }

  recut(recordingId: string, cuts: Cut[]): void {
    const project = this.#options.project();
    const recording = project.recordings.find((recording) => recording.id === recordingId);
    if (!this.#options.player() || !recording) return;
    const after = normalizeCuts(cuts);
    const before = $state.snapshot(recording.cuts ?? []);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.#remember([...this.#history, { recordingId, before, after }]);
    projectEdits.setCuts(project, recordingId, after, this.#durationOf);
  }

  undo(): void {
    const player = this.#options.player();
    const last = this.#history.at(-1);
    const recording = this.#recording;
    if (!player || player.loading || !last || !this.canUndo || !recording) return;
    this.#remember(this.#history.slice(0, -1));
    projectEdits.setCuts(this.#options.project(), recording.id, last.before, this.#durationOf);
  }
}
