import { ProgressPublisher } from "#platform/main/progress";
import { TaskQueue, type TaskContext } from "#platform/main/tasks";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import {
  BACKGROUND_MODELS,
  isBackgroundModelId,
  type BackgroundModel,
  type BackgroundModelId,
  type BackgroundModelState,
} from "../contracts/backgroundRemoval.ts";

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/**
 * The background removal models on this computer. Each is one ONNX file named for the model in `directory`, and is
 * complete once it's there: it downloads into `<id>.onnx.partial` and moves into place once its size and checksum
 * match, so a cancelled or failed download leaves nothing behind.
 */
export class BackgroundModelLibrary {
  readonly #directory: string;
  readonly #catalog: readonly BackgroundModel[];
  readonly #fetch: Fetch;
  readonly #onChange: (models: BackgroundModelState[]) => void;
  readonly #states = new Map<BackgroundModelId, BackgroundModelState>();
  #jobs: TaskQueue<BackgroundModelId>;
  #publish = new ProgressPublisher(() => this.#onChange(this.models));

  constructor(
    directory: string,
    fetcher: Fetch,
    onChange: (models: BackgroundModelState[]) => void,
    catalog: readonly BackgroundModel[] = BACKGROUND_MODELS,
  ) {
    this.#directory = directory;
    this.#catalog = catalog;
    this.#fetch = fetcher;
    this.#onChange = onChange;
    this.#jobs = new TaskQueue({
      kind: "model-download",
      concurrency: Infinity,
      describe: (id) => ({
        key: id,
        label: `Download ${this.#catalog.find((model) => model.id === id)?.name ?? id}`,
      }),
      run: async (id, { signal, progress }) => {
        try {
          await this.#fetchModel(id, signal, progress);
          this.#set(id, { id, status: { state: "downloaded" } });
        } finally {
          if (signal.aborted) {
            rmSync(`${this.#file(id)}.partial`, { force: true });
            this.#set(id, { id, status: { state: "notDownloaded" } });
          }
        }
      },
      failed: (id, error) => {
        rmSync(`${this.#file(id)}.partial`, { force: true });
        console.error(`Could not download ${id}`, error);
        this.#set(id, {
          id,
          status: { state: "notDownloaded" },
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
    for (const { id, size } of catalog as readonly (BackgroundModel & {
      id: BackgroundModelId;
    })[]) {
      const file = this.#file(id);
      const downloaded = existsSync(file) && statSync(file).size === size;
      this.#states.set(id, { id, status: { state: downloaded ? "downloaded" : "notDownloaded" } });
    }
  }

  get models(): BackgroundModelState[] {
    return [...this.#states.values()].map((state) => structuredClone(state));
  }

  /** Starts downloading `id`, unless it's downloading or downloaded. Failures show in its state. */
  download(id: unknown): void {
    if (!isBackgroundModelId(id) || this.#states.get(id)?.status.state !== "notDownloaded") return;
    this.#set(id, { id, status: { state: "downloading", progress: 0 } });
    this.#jobs.enqueue(id);
  }

  /** Stops downloading `id`. */
  cancel(id: unknown): void {
    this.#jobs.cancel((job) => job === id);
  }

  /** Deletes a downloaded model. */
  remove(id: unknown): void {
    if (!isBackgroundModelId(id) || this.#states.get(id)?.status.state !== "downloaded") return;
    rmSync(this.#file(id), { force: true });
    this.#set(id, { id, status: { state: "notDownloaded" } });
  }

  /** Where a downloaded model's weights are, or null when it isn't downloaded. */
  file(id: BackgroundModelId): string | null {
    return this.#states.get(id)?.status.state === "downloaded" ? this.#file(id) : null;
  }

  /** Stops every download, e.g. on quit. */
  stop(): void {
    this.#jobs.cancel(() => true, false);
  }

  #file(id: BackgroundModelId): string {
    return join(this.#directory, `${id}.onnx`);
  }

  #set(id: BackgroundModelId, state: BackgroundModelState, progressOnly = false): void {
    this.#states.set(id, state);
    this.#publish.send(progressOnly);
  }

  async #fetchModel(
    id: BackgroundModelId,
    signal: AbortSignal,
    taskProgress: TaskContext["progress"],
  ): Promise<void> {
    const model = this.#catalog.find((candidate) => candidate.id === id)!;
    const response = await this.#fetch(model.url, { signal });
    if (!response.ok || !response.body) throw new Error(`Hugging Face answered ${response.status}`);
    mkdirSync(this.#directory, { recursive: true });
    const partial = `${this.#file(id)}.partial`;
    const hash = createHash("sha256");
    let received = 0;
    const count = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        hash.update(chunk);
        received += chunk.length;
        taskProgress(Math.min(1, received / model.size));
        this.#set(
          id,
          { id, status: { state: "downloading", progress: Math.min(1, received / model.size) } },
          true,
        );
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as ReadableStream),
      count,
      createWriteStream(partial),
      { signal },
    );
    if (received !== model.size || hash.digest("hex") !== model.sha256)
      throw new Error("The download was corrupted. Try again.");
    renameSync(partial, this.#file(id));
  }
}
