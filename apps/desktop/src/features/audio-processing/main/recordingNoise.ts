import { TaskQueue, type TaskContext } from "#platform/main/tasks";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Manifest } from "@teamblocks.dev/chord-recorder-protocol";
import type {
  NoiseEngineId,
  NoiseResult,
  NoiseState,
  NoiseTrackResult,
  NoiseTrackState,
} from "../contracts/noiseReduction.ts";
import { readNoise, writeNoise } from "./noiseFiles.ts";
import type { NoiseJob } from "./noiseProcessing.ts";

interface Dependencies {
  load(directory: string): Promise<Manifest>;
  /** A WAV the recorded file can be read from, which may be the file itself. */
  decoded(file: string): Promise<string>;
  /** The engine new work uses, and where its networks are; throws when none can run. */
  engine(): Promise<{ id: NoiseEngineId; folder: string | null }>;
  process(job: NoiseJob, signal: AbortSignal, progress: (value: number) => void): Promise<void>;
  change(state: NoiseState): void;
}

interface Job {
  directory: string;
  key: string;
  kind: "microphone" | "systemAudio";
  index: number;
}

const KINDS = ["microphone", "systemAudio"] as const;

/**
 * Cleaned copies of recorded audio. A copy belongs to one recorded file of one track and keeps its time, so cuts,
 * trims and moves play it as they play the original. Copies are made one track at a time, outside capture, in a
 * folder of their own; a copy that fails or is cancelled leaves the earlier one in place.
 */
export class RecordingNoise {
  #dependencies: Dependencies;
  #states = new Map<string, NoiseState>();
  #jobs: TaskQueue<Job>;
  #edits: Promise<unknown> = Promise.resolve();

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
    this.#jobs = new TaskQueue({
      kind: "noise",
      describe: ({ directory, key }) => ({
        key: JSON.stringify([directory, key]),
        label: "Reduce audio noise",
        resource: directory,
      }),
      run: (job, context) => this.#process(job, context),
      cancelled: ({ directory, key }) => {
        const state = this.#states.get(directory);
        const track = state?.tracks[key];
        if (state && track) {
          state.tracks[key] = track.result
            ? { phase: "done", result: track.result }
            : { phase: "idle" };
          this.#publish(state);
        }
      },
      failed: ({ directory, key }, error) => {
        const state = this.#states.get(directory);
        if (state) {
          const result = state.tracks[key]?.result;
          state.tracks[key] = {
            phase: "failed",
            error: error instanceof Error ? error.message : String(error),
            ...(result && { result }),
          };
          this.#publish(state);
        }
      },
    });
  }

  async get(directory: string): Promise<NoiseState> {
    const manifest = await this.#dependencies.load(directory);
    return structuredClone(this.#state(directory, manifest));
  }

  /** Cleans the `index`th `kind` track with the engine now in use, unless a copy made with it is already there. */
  async start(directory: string, kind: unknown, index: unknown): Promise<NoiseState> {
    if (this.#jobs.closed) throw new Error("Noise reduction has closed");
    if (
      !KINDS.includes(kind as (typeof KINDS)[number]) ||
      !Number.isInteger(index) ||
      (index as number) < 0
    )
      throw new Error("Not an audio track");
    const manifest = await this.#dependencies.load(directory);
    const [trackKind, trackIndex] = [kind as (typeof KINDS)[number], index as number];
    const track = tracksOf(manifest, trackKind)[trackIndex];
    if (!track) throw new Error("This recording has no such audio track");
    const key = `${trackKind}:${trackIndex}`;
    const state = this.#state(directory, manifest);
    const current = state.tracks[key];
    if (current?.phase === "queued" || current?.phase === "processing")
      return structuredClone(state);
    const engine = await this.#dependencies.engine();
    // A copy made with the engine in use is as good as a new one, and instant.
    if (
      current?.result?.engine === engine.id &&
      Object.values(current.result.files).every((file) => existsSync(join(directory, file)))
    ) {
      state.tracks[key] = { phase: "done", result: current.result };
      this.#publish(state);
      return structuredClone(state);
    }
    state.tracks[key] = { ...current, phase: "queued", progress: 0, error: undefined };
    this.#publish(state);
    this.#jobs.enqueue({ directory, key, kind: trackKind, index: trackIndex });
    return structuredClone(state);
  }

  /** Stops the track's job, or takes it off the queue. A copy made earlier stays. */
  cancel(directory: string, kind: unknown, index: unknown): void {
    const key = `${String(kind)}:${String(index)}`;
    this.#jobs.cancel((job) => job.directory === directory && job.key === key);
  }

  /** Stops everything for a recording, e.g. when it is deleted. */
  cancelAll(directory: string): void {
    for (const key of Object.keys(this.#states.get(directory)?.tracks ?? {})) {
      const [kind, index] = key.split(":");
      this.cancel(directory, kind, Number(index));
    }
  }

  /** The cleaned copies of the `kind` track with the recorded files `files`, or undefined unless it has them all. */
  cleaned(directory: string, kind: string, index: number): NoiseTrackResult | undefined {
    const track = readNoise(directory)?.tracks[`${kind}:${index}`];
    return track && Object.values(track.files).every((file) => existsSync(join(directory, file)))
      ? track
      : undefined;
  }

  dispose(): void {
    this.#jobs.dispose();
  }

  #state(directory: string, manifest: Manifest): NoiseState {
    const known = this.#states.get(directory);
    if (known) return known;
    const files = new Set(
      manifest.tracks.flatMap((track) => track.segments.map((segment) => segment.file)),
    );
    const tracks: Record<string, NoiseTrackState> = {};
    const saved = readNoise(directory);
    if (saved) {
      for (const [key, result] of Object.entries(saved.tracks)) {
        const valid =
          Object.keys(result.files).every((file) => files.has(file)) &&
          Object.values(result.files).every((file) => existsSync(join(directory, file)));
        if (valid) tracks[key] = { phase: "done", result };
      }
    }
    const state: NoiseState = { directory, tracks };
    this.#states.set(directory, state);
    return state;
  }

  #publish(state: NoiseState): void {
    this.#dependencies.change(structuredClone(state));
  }

  async #process(job: Job, { signal, progress: report }: TaskContext): Promise<void> {
    const { directory, key } = job;
    let output: string | undefined;
    try {
      const manifest = await this.#dependencies.load(directory);
      const state = this.#state(directory, manifest);
      const track = tracksOf(manifest, job.kind)[job.index];
      if (!track) throw new Error("This recording has no such audio track");
      const sources = [...new Set(track.segments.map((segment) => segment.file))];
      const engine = await this.#dependencies.engine();
      const decoded = await Promise.all(
        sources.map((file) => this.#dependencies.decoded(join(directory, file))),
      );
      signal.throwIfAborted();
      const id = randomUUID();
      const folder = `noise/${id}`;
      output = join(directory, folder);
      mkdirSync(output, { recursive: true });
      const files = Object.fromEntries(sources.map((file, i) => [file, `${folder}/${i}.wav`]));
      state.tracks[key] = {
        ...state.tracks[key],
        phase: "processing",
        progress: 0,
        error: undefined,
      };
      this.#publish(state);
      await this.#dependencies.process(
        {
          engine: engine.id,
          folder: engine.folder,
          files: sources.map((file, i) => ({
            source: decoded[i]!,
            output: join(directory, files[file]!),
          })),
        },
        signal,
        (progress) =>
          report(progress, () => {
            state.tracks[key] = { ...state.tracks[key]!, phase: "processing", progress };
            this.#publish(state);
          }),
      );
      signal.throwIfAborted();
      await this.#edits;
      await this.#dependencies.load(directory); // A recording deleted while processing must not be recreated.
      signal.throwIfAborted();
      if (!Object.values(files).every((file) => existsSync(join(directory, file))))
        throw new Error("Noise reduction did not produce every file");
      const previous = state.tracks[key]?.result;
      const result: NoiseTrackResult = { id, engine: engine.id, files };
      const saved: NoiseResult = {
        version: 1,
        tracks: { ...(readNoise(directory)?.tracks ?? {}), [key]: result },
      };
      writeNoise(directory, saved);
      state.tracks[key] = { phase: "done", result, progress: 1 };
      this.#publish(state);
      output = undefined;
      // The copies this one replaces are no longer named by anything; ones already open stay readable until closed.
      if (previous)
        for (const folderOf of new Set(Object.values(previous.files).map((file) => dirname(file))))
          rmSync(join(directory, folderOf), { recursive: true, force: true });
    } finally {
      if (output) rmSync(output, { recursive: true, force: true });
    }
  }
}

/** A recording's `kind` tracks that recorded anything, in order: the way playback and leveling count them. */
function tracksOf(manifest: Manifest, kind: "microphone" | "systemAudio") {
  return manifest.tracks.filter((track) => track.kind === kind && track.segments.length > 0);
}
