import { ProgressPublisher } from "#platform/main/progress";
import { TaskQueue, type TaskContext } from "#platform/main/tasks";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import {
  DEEP_FILTER_DOWNLOAD,
  type NoiseDownload,
  type NoiseEngineState,
  type NoiseEngineStatus,
} from "../contracts/noiseReduction.ts";
import { extractTarGz } from "#shared/main/tar";

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

const FOLDER = "deepfilternet3";

/**
 * The noise reduction engines on this computer. Apple's is part of macOS, so only whether it can run is asked.
 * DeepFilterNet3 downloads as one archive, which is checked, unpacked into `deepfilternet3.partial`, and moved to
 * `deepfilternet3` once every network in it matches its size and checksum, so a cancelled or failed download leaves
 * nothing behind.
 */
export class NoiseModelLibrary {
  readonly #directory: string;
  readonly #fetch: Fetch;
  readonly #onChange: (engines: NoiseEngineState[]) => void;
  readonly #apple: () => Promise<NoiseEngineStatus>;
  readonly #download: NoiseDownload;
  #appleStatus: NoiseEngineStatus = { state: "unavailable", reason: "Checking" };
  #downloader: NoiseEngineState = { id: "deepfilternet3", status: { state: "notDownloaded" } };
  #jobs: TaskQueue<"deepfilternet3">;
  #publish = new ProgressPublisher(() => this.#onChange(this.engines));

  constructor(
    directory: string,
    fetcher: Fetch,
    onChange: (engines: NoiseEngineState[]) => void,
    apple: () => Promise<NoiseEngineStatus>,
    download: NoiseDownload = DEEP_FILTER_DOWNLOAD,
  ) {
    this.#directory = directory;
    this.#fetch = fetcher;
    this.#onChange = onChange;
    this.#apple = apple;
    this.#download = download;
    this.#downloader = {
      id: "deepfilternet3",
      status: { state: this.#onDisk() ? "ready" : "notDownloaded" },
    };
    this.#jobs = new TaskQueue({
      kind: "model-download",
      concurrency: Infinity,
      describe: (id) => ({ key: id, label: "Download DeepFilterNet3" }),
      run: async (id, { signal, progress }) => {
        try {
          await this.#fetchModel(signal, progress);
          this.#set({ id, status: { state: "ready" } });
        } finally {
          if (signal.aborted) {
            rmSync(this.#path(`${FOLDER}.partial`), { recursive: true, force: true });
            this.#set({ id, status: { state: "notDownloaded" } });
          }
        }
      },
      failed: (id, error) => {
        rmSync(this.#path(`${FOLDER}.partial`), { recursive: true, force: true });
        console.error("Could not download DeepFilterNet3", error);
        this.#set({
          id,
          status: { state: "notDownloaded" },
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }

  get engines(): NoiseEngineState[] {
    return [{ id: "apple", status: this.#appleStatus }, structuredClone(this.#downloader)];
  }

  /** Every engine and its state, asking again whether Apple's can run. */
  async list(): Promise<NoiseEngineState[]> {
    this.#appleStatus = await this.#apple().catch((): NoiseEngineStatus => ({
      state: "unavailable",
      reason: "Apple Sound Isolation couldn't be started",
    }));
    return this.engines;
  }

  /** Starts downloading DeepFilterNet3, unless it's downloading or ready. Failures show in its state. */
  download(id: unknown): void {
    if (id !== "deepfilternet3" || this.#downloader.status.state !== "notDownloaded") return;
    this.#set({ id, status: { state: "downloading", progress: 0 } });
    this.#jobs.enqueue(id);
  }

  /** Stops downloading. */
  cancel(id: unknown): void {
    this.#jobs.cancel((job) => job === id);
  }

  /** Deletes the downloaded networks. */
  remove(id: unknown): void {
    if (id !== "deepfilternet3" || this.#downloader.status.state !== "ready") return;
    rmSync(this.#path(FOLDER), { recursive: true, force: true });
    this.#set({ id: "deepfilternet3", status: { state: "notDownloaded" } });
  }

  /** Where the downloaded networks are, or null when they aren't downloaded. */
  folder(): string | null {
    return this.#downloader.status.state === "ready" ? this.#path(FOLDER) : null;
  }

  /** Stops the download, e.g. on quit. */
  stop(): void {
    this.#jobs.cancel(() => true, false);
  }

  #path(name: string): string {
    return join(this.#directory, name);
  }

  #onDisk(): boolean {
    return this.#download.files.every(
      (file) =>
        existsSync(join(this.#path(FOLDER), file.name)) &&
        statSync(join(this.#path(FOLDER), file.name)).size === file.size,
    );
  }

  #set(state: NoiseEngineState, progressOnly = false): void {
    this.#downloader = state;
    this.#publish.send(progressOnly);
  }

  async #fetchModel(signal: AbortSignal, taskProgress: TaskContext["progress"]): Promise<void> {
    const response = await this.#fetch(this.#download.url, { signal });
    if (!response.ok || !response.body)
      throw new Error(`The download server answered ${response.status}`);
    const hash = createHash("sha256");
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const chunk of Readable.fromWeb(
      response.body as ReadableStream,
    ) as AsyncIterable<Buffer>) {
      signal.throwIfAborted();
      hash.update(chunk);
      chunks.push(chunk);
      received += chunk.length;
      taskProgress(Math.min(1, received / this.#download.size));
      this.#set(
        {
          id: "deepfilternet3",
          status: { state: "downloading", progress: Math.min(1, received / this.#download.size) },
        },
        true,
      );
    }
    if (received !== this.#download.size || hash.digest("hex") !== this.#download.sha256)
      throw new Error("The download was corrupted. Try again.");
    const files = extractTarGz(
      Buffer.concat(chunks),
      this.#download.files.map((file) => file.name),
    );
    mkdirSync(this.#directory, { recursive: true });
    const partial = this.#path(`${FOLDER}.partial`);
    rmSync(partial, { recursive: true, force: true });
    mkdirSync(partial);
    for (const file of this.#download.files) {
      const contents = files.get(file.name);
      if (
        !contents ||
        contents.length !== file.size ||
        createHash("sha256").update(contents).digest("hex") !== file.sha256
      )
        throw new Error("The download was corrupted. Try again.");
      writeFileSync(join(partial, file.name), contents);
    }
    signal.throwIfAborted();
    rmSync(this.#path(FOLDER), { recursive: true, force: true });
    renameSync(partial, this.#path(FOLDER));
  }
}
