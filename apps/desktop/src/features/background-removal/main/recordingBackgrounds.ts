import { TaskQueue, type TaskContext } from "#platform/main/tasks";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Manifest } from "@teamblocks.dev/chord-recorder-protocol";
import {
  isBackgroundModelId,
  isCameraBackground,
  type BackgroundModelId,
  type BackgroundResult,
  type BackgroundState,
  type CameraBackground,
} from "../contracts/backgroundRemoval.ts";

interface Dependencies {
  load(directory: string): Promise<Manifest>;
  model(): { id: BackgroundModelId; weights: string };
  defaults(): CameraBackground;
  process(
    work: {
      model: BackgroundModelId;
      weights: string;
      files: { source: string; output: string }[];
    },
    signal: AbortSignal,
    progress: (value: number) => void,
  ): Promise<void>;
  change(state: BackgroundState): void;
}

/** Masks belong to source camera files; cuts and moves only change how those source files are played. */
export class RecordingBackgrounds {
  #dependencies: Dependencies;
  #states = new Map<string, BackgroundState>();
  #jobs: TaskQueue<{ directory: string }>;
  #edits: Promise<unknown> = Promise.resolve();

  constructor(dependencies: Dependencies) {
    this.#dependencies = dependencies;
    this.#jobs = new TaskQueue({
      kind: "background",
      describe: ({ directory }) => ({
        key: directory,
        label: "Remove camera background",
        resource: directory,
      }),
      run: (job, context) => this.#process(job, context),
      cancelled: ({ directory }) => {
        const { result } = this.#states.get(directory)!;
        this.#set({ directory, phase: result ? "done" : "idle", ...(result && { result }) });
      },
      failed: ({ directory }, error) => {
        this.#set({
          ...this.#states.get(directory)!,
          phase: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }

  async get(directory: string): Promise<BackgroundState> {
    const manifest = await this.#dependencies.load(directory);
    const current = this.#states.get(directory);
    if (current) return structuredClone(current);
    try {
      const saved = JSON.parse(
        readFileSync(join(directory, "background.json"), "utf8"),
      ) as BackgroundResult;
      const cameraFiles = new Set(
        manifest.tracks
          .filter((track) => track.kind === "camera")
          .flatMap((track) => track.segments.map((segment) => segment.file)),
      );
      if (
        saved.version === 1 &&
        isBackgroundModelId(saved.model) &&
        isCameraBackground(saved.settings) &&
        saved.masks &&
        typeof saved.masks === "object" &&
        Object.keys(saved.masks).length > 0 &&
        Object.entries(saved.masks).every(
          ([source, mask]) =>
            cameraFiles.has(source) &&
            typeof mask === "string" &&
            /^backgrounds\/[\w-]+\/\d+\.mp4$/.test(mask),
        )
      ) {
        if (!Object.values(saved.masks).every((file) => existsSync(join(directory, file))))
          return {
            directory,
            phase: "failed",
            error: "The foreground masks are missing. Process this recording again.",
          };
        return { directory, phase: "done", result: saved };
      }
    } catch {
      /* No background has been processed. */
    }
    return { directory, phase: "idle" };
  }

  async start(directory: string): Promise<BackgroundState> {
    if (this.#jobs.closed) throw new Error("Background processing has closed");
    await this.#edits;
    const state = await this.get(directory);
    if (["queued", "processing"].includes(this.#states.get(directory)?.phase ?? ""))
      return structuredClone(this.#states.get(directory)!);
    this.#set({ ...state, phase: "queued", error: undefined, progress: 0 });
    this.#jobs.enqueue({ directory });
    return structuredClone(this.#states.get(directory)!);
  }

  cancel(directory: string): void {
    this.#jobs.cancel((job) => job.directory === directory);
  }

  update(directory: string, patch: unknown): Promise<BackgroundState> {
    const edit = this.#edits.then(async () => {
      const state = await this.get(directory);
      if (!state.result) throw new Error("Process the camera background first");
      if (!patch || typeof patch !== "object") throw new Error("Invalid background settings");
      const settings = { ...state.result.settings };
      for (const key of ["enabled", "replacement", "blur", "color"] as const) {
        if (Object.hasOwn(patch, key))
          Object.assign(settings, { [key]: (patch as Partial<CameraBackground>)[key] });
      }
      if (!isCameraBackground(settings)) throw new Error("Invalid background settings");
      state.result.settings = settings;
      this.#save(directory, state.result);
      this.#set(state);
      return state;
    });
    this.#edits = edit.catch(() => {});
    return edit;
  }

  dispose(): void {
    this.#jobs.dispose();
  }

  #set(state: BackgroundState): void {
    this.#states.set(state.directory, structuredClone(state));
    this.#dependencies.change(structuredClone(state));
  }

  #save(directory: string, result: BackgroundResult): void {
    const path = join(directory, "background.json");
    writeFileSync(`${path}.tmp`, JSON.stringify(result));
    renameSync(`${path}.tmp`, path);
  }

  async #process(
    job: { directory: string },
    { signal, progress: report }: TaskContext,
  ): Promise<void> {
    const { directory } = job;
    let output: string | undefined;
    try {
      const manifest = await this.#dependencies.load(directory);
      const sources = [
        ...new Set(
          manifest.tracks
            .filter((track) => track.kind === "camera")
            .flatMap((track) => track.segments.map((segment) => segment.file)),
        ),
      ];
      if (!sources.length) throw new Error("This recording has no camera video to process");
      const model = this.#dependencies.model();
      const folder = `backgrounds/${randomUUID()}`;
      output = join(directory, folder);
      mkdirSync(output, { recursive: true });
      const masks = Object.fromEntries(
        sources.map((file, index) => [file, `${folder}/${index}.mp4`]),
      );
      this.#set({
        ...this.#states.get(directory)!,
        phase: "processing",
        progress: 0,
        error: undefined,
      });
      await this.#dependencies.process(
        {
          model: model.id,
          weights: model.weights,
          files: sources.map((file) => ({
            source: join(directory, file),
            output: join(directory, masks[file]!),
          })),
        },
        signal,
        (progress) =>
          report(progress, () => {
            this.#set({ ...this.#states.get(directory)!, phase: "processing", progress });
          }),
      );
      signal.throwIfAborted();
      await this.#edits;
      await this.#dependencies.load(directory); // A recording deleted while processing must not be recreated.
      signal.throwIfAborted();
      if (!Object.values(masks).every((file) => existsSync(join(directory, file))))
        throw new Error("Background processing did not produce all camera masks");
      const result: BackgroundResult = {
        version: 1,
        model: model.id,
        masks,
        settings: this.#states.get(directory)?.result?.settings ?? this.#dependencies.defaults(),
      };
      this.#save(directory, result);
      this.#set({ directory, phase: "done", result, progress: 1 });
      output = undefined; // Older masks stay usable by previews and exports already in progress.
    } finally {
      if (output) rmSync(output, { recursive: true, force: true });
    }
  }
}
