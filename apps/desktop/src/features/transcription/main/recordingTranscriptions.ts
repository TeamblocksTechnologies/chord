import { TaskQueue, type TaskContext } from "#platform/main/tasks";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest } from "@teamblocks.dev/chord-recorder-protocol";
import { leadClips } from "#media-engine/main/recordingClips";
import {
  captionFiles,
  captionGroups,
  isTimedText,
  onRecording,
  refreshWordTimings,
  replaceWords,
  type RecordingTranscript,
  type TranscriptionState,
  type TimedText,
  type WordAddress,
} from "../domain/captions.ts";

interface Dependencies<Model> {
  load(directory: string): Promise<Manifest>;
  model(): Promise<{ id: string; model: Model }>;
  transcribe(file: string, model: Model, signal: AbortSignal): Promise<{ words: TimedText[] }>;
  duration(file: string, signal?: AbortSignal): Promise<number>;
  /** The file to transcribe for a recorded microphone file, e.g. its cleaned copy; by default the recorded file. */
  source?(directory: string, file: string, microphone: number): string;
  change(state: TranscriptionState): void;
}

/** A recording's saved transcript, or undefined when it has none or the file isn't one. */
export function readTranscript(directory: string): RecordingTranscript | undefined {
  try {
    const saved = JSON.parse(
      readFileSync(join(directory, "transcript.json"), "utf8"),
    ) as RecordingTranscript;
    if (
      saved.version === 1 &&
      typeof saved.model === "string" &&
      Array.isArray(saved.cues) &&
      saved.cues.every(
        (cue) =>
          isTimedText(cue) &&
          typeof cue.id === "string" &&
          typeof cue.trackId === "string" &&
          (cue.words === undefined || (Array.isArray(cue.words) && cue.words.every(isTimedText))),
      )
    )
      return saved;
  } catch {
    /* No transcript yet. */
  }
  return undefined;
}

/** One local inference at a time, owned by main so navigating away never interrupts it. */
export class RecordingTranscriptions<Model> {
  #dependencies: Dependencies<Model>;
  #states = new Map<string, TranscriptionState>();
  #jobs: TaskQueue<{ directory: string; timingOnly: boolean }>;
  #corrections: Promise<unknown> = Promise.resolve();

  constructor(dependencies: Dependencies<Model>) {
    this.#dependencies = dependencies;
    this.#jobs = new TaskQueue({
      kind: "transcription",
      describe: ({ directory, timingOnly }) => ({
        key: directory,
        label: timingOnly ? "Update transcript timings" : "Transcribe recording",
        resource: directory,
      }),
      run: (job, context) => this.#process(job, context),
      cancelled: ({ directory }) => {
        const { transcript } = this.#states.get(directory)!;
        this.#set({ directory, phase: transcript ? "done" : "idle", transcript });
      },
      failed: ({ directory }, error) => {
        this.#set({
          ...this.#states.get(directory)!,
          phase: "failed",
          progress: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }

  async get(directory: string): Promise<TranscriptionState> {
    await this.#dependencies.load(directory);
    const state = this.#states.get(directory);
    if (state) return structuredClone(state);
    const transcript = readTranscript(directory);
    return { directory, phase: transcript ? "done" : "idle", ...(transcript && { transcript }) };
  }

  async start(directory: string, timingOnly = false): Promise<TranscriptionState> {
    if (this.#jobs.closed) throw new Error("Transcription has closed");
    await this.#corrections;
    const previous = await this.get(directory);
    if (timingOnly && !previous.transcript)
      throw new Error("Transcribe this recording before updating its word timing");
    if (["queued", "transcribing"].includes(this.#states.get(directory)?.phase ?? ""))
      return this.#states.get(directory)!;
    this.#set({
      ...previous,
      phase: "queued",
      operation: timingOnly ? "timing" : undefined,
      progress: 0,
      error: undefined,
    });
    this.#jobs.enqueue({ directory, timingOnly });
    return this.#states.get(directory)!;
  }

  cancel(directory: string): void {
    this.#jobs.cancel((job) => job.directory === directory);
  }

  correct(directory: string, id: string, text: string): Promise<TranscriptionState> {
    const correction = this.#corrections.then(() => this.#correct(directory, id, text));
    this.#corrections = correction.catch(() => {});
    return correction;
  }

  async #correct(directory: string, id: string, text: string): Promise<TranscriptionState> {
    const state = await this.get(directory);
    if (!state.transcript || ["queued", "transcribing"].includes(state.phase))
      throw new Error("Wait for transcription to finish before correcting text");
    const cue = state.transcript.cues.find((cue) => cue.id === id);
    if (!cue) throw new Error("Caption no longer exists");
    // A correction can change word boundaries; keep the cue anchors but stop using stale word timings.
    if (cue.text !== text) delete cue.words;
    cue.text = text;
    await this.#save(directory, state.transcript);
    this.#set(state);
    return state;
  }

  replace(
    directory: string,
    from: WordAddress,
    to: WordAddress,
    text: string,
  ): Promise<TranscriptionState> {
    const correction = this.#corrections.then(async () => {
      const state = await this.get(directory);
      if (!state.transcript || ["queued", "transcribing"].includes(state.phase))
        throw new Error("Wait for transcription to finish before correcting text");
      state.transcript = replaceWords(state.transcript, from, to, text);
      await this.#save(directory, state.transcript);
      this.#set(state);
      return state;
    });
    this.#corrections = correction.catch(() => {});
    return correction;
  }

  dispose(): void {
    this.#jobs.dispose();
  }

  #set(state: TranscriptionState): void {
    this.#states.set(state.directory, structuredClone(state));
    this.#dependencies.change(structuredClone(state));
  }

  async #process(
    job: { directory: string; timingOnly: boolean },
    { signal, progress: report }: TaskContext,
  ): Promise<void> {
    const { directory } = job;
    const previous = this.#states.get(directory)!;
    const manifest = await this.#dependencies.load(directory);
    const segments = manifest.tracks
      .filter((track) => track.kind === "microphone")
      .flatMap((track) => track.segments.map((segment) => ({ track, segment })));
    if (!segments.length) throw new Error("This recording has no microphone audio to transcribe");
    const { id, model } = await this.#dependencies.model();
    const microphones = manifest.tracks.filter(
      (track) => track.kind === "microphone" && track.segments.length > 0,
    );
    const transcript: RecordingTranscript = { version: 1, model: id, cues: [] };
    for (const [index, { track, segment }] of segments.entries()) {
      signal.throwIfAborted();
      report(index / segments.length);
      this.#set({
        ...previous,
        phase: "transcribing",
        progress: index / segments.length,
        error: undefined,
      });
      const input =
        this.#dependencies.source?.(directory, segment.file, microphones.indexOf(track)) ??
        join(directory, segment.file);
      const result = await this.#dependencies.transcribe(input, model, signal);
      const duration =
        segment.end !== undefined
          ? segment.end - segment.start
          : await this.#dependencies.duration(join(directory, segment.file), signal);
      for (const [nth, cue] of captionGroups(result.words).entries()) {
        const end = Math.min(cue.end, duration);
        if (end > cue.start)
          transcript.cues.push({
            id: `${track.id}:${index}:${nth}`,
            trackId: track.id,
            text: cue.text,
            start: segment.start + cue.start,
            end: segment.start + end,
            words: result.words
              .filter(
                (word) =>
                  isTimedText(word) &&
                  word.text.trim() &&
                  word.start >= cue.start &&
                  word.end <= cue.end &&
                  word.start < end,
              )
              .map((word) => ({
                text: word.text.trim(),
                start: segment.start + word.start,
                end: segment.start + Math.min(word.end, end),
              })),
          });
      }
    }
    transcript.cues.sort((a, b) => a.start - b.start || a.trackId.localeCompare(b.trackId));
    signal.throwIfAborted();
    const refreshed = job.timingOnly
      ? refreshWordTimings(previous.transcript!, transcript)
      : undefined;
    if (refreshed?.updated === 0)
      throw new Error("No matching word timings were found. Your transcript has been kept.");
    const result = refreshed?.transcript ?? transcript;
    await this.#save(directory, result, signal);
    signal.throwIfAborted();
    this.#set({ directory, phase: "done", transcript: result, progress: 1 });
  }

  async #save(
    directory: string,
    transcript: RecordingTranscript,
    signal?: AbortSignal,
  ): Promise<void> {
    const manifest = await this.#dependencies.load(directory);
    const clips = await leadClips(manifest, (file) =>
      this.#dependencies.duration(join(directory, file), signal),
    );
    signal?.throwIfAborted();
    if (!existsSync(directory)) throw new Error("This recording has been deleted");
    // Stage every file before replacing any, so a full disk doesn't overwrite the previous corrected transcript.
    // JSON, the authoritative copy reloaded on launch, is replaced last.
    const files = {
      ...captionFiles(onRecording(transcript.cues, clips)),
      json: JSON.stringify(transcript),
    };
    try {
      for (const [extension, contents] of Object.entries(files))
        writeFileSync(join(directory, `transcript.${extension}.tmp`), contents);
      for (const extension of Object.keys(files)) {
        const path = join(directory, `transcript.${extension}`);
        renameSync(`${path}.tmp`, path);
      }
    } finally {
      for (const extension of Object.keys(files))
        rmSync(join(directory, `transcript.${extension}.tmp`), { force: true });
    }
  }
}
