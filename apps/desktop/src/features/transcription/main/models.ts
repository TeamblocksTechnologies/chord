import { ProgressPublisher } from "#platform/main/progress";
import { TaskQueue, type TaskContext } from "#platform/main/tasks";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import {
  TRANSCRIPTION_MODELS,
  isTranscriptionModelId,
  type ModelState,
  type ModelStatus,
  type TranscriptionModelId,
} from "../domain/transcription.ts";

/** Hugging Face files of a model, at a fixed revision so every install is the same. */
interface HubModel {
  repo: string;
  revision: string;
  /** Files, or folders ending in `/`, to download; the repo has others. */
  paths: string[];
}

const HUB_MODELS: Partial<Record<TranscriptionModelId, HubModel>> = {
  // FluidAudio's Core ML build. These are what `AsrModels.loadLocal(from:version: .v3)` loads.
  "parakeet-tdt-0.6b-v3": {
    repo: "FluidInference/parakeet-tdt-0.6b-v3-coreml",
    revision: "7dd20fe6b1797d35f5e3307e8b1732d9a178edfe",
    paths: [
      "Preprocessor.mlmodelc/",
      "Encoder.mlmodelc/",
      "Decoder.mlmodelc/",
      "JointDecisionv3.mlmodelc/",
      "parakeet_vocab.json",
    ],
  },
};

/** What `speech-assets` reports about Apple's speech model for a language. */
export interface AppleSpeechAssets {
  status: "unavailable" | "supported" | "downloading" | "installed";
  /** The language the model transcribes, or null when there's none for the one asked for. */
  locale: string | null;
  /** The languages Apple has models for. */
  locales: string[];
  /** The one of `locales` closest to the system's language. */
  system: string | null;
}

/** macOS's speech models, installed by the transcriber helper. `locale` null is the system's language. */
export interface AppleSpeech {
  assets(locale: string | null): Promise<AppleSpeechAssets>;
  /** Downloads the model for `locale`, reporting progress from 0 to 1. */
  install(
    locale: string | null,
    onProgress: (progress: number) => void,
  ): Promise<AppleSpeechAssets>;
}

type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

interface HubFile {
  type: "file" | "directory";
  path: string;
  size: number;
  lfs?: { oid: string; size: number };
}

/**
 * The transcription models on this computer. Downloaded models are kept in a folder each in `directory`, named for
 * the model, and are complete once that folder exists: they download into `<id>.partial`, which keeps finished files
 * so a cancelled or failed download picks up where it stopped. Apple Speech is the system's to keep, in the language
 * `appleLocale` returns.
 */
export class ModelLibrary {
  readonly #directory: string;
  readonly #apple: AppleSpeech;
  readonly #appleLocale: () => string | null;
  readonly #fetch: Fetch;
  readonly #onChange: (models: ModelState[]) => void;
  readonly #states = new Map<TranscriptionModelId, ModelState>();
  #jobs: TaskQueue<TranscriptionModelId>;
  #publish = new ProgressPublisher(() => this.#onChange(this.models));

  constructor(
    directory: string,
    apple: { speech: AppleSpeech; locale: () => string | null },
    fetcher: Fetch,
    onChange: (models: ModelState[]) => void,
  ) {
    this.#directory = directory;
    this.#apple = apple.speech;
    this.#appleLocale = apple.locale;
    this.#fetch = fetcher;
    this.#onChange = onChange;
    this.#jobs = new TaskQueue({
      kind: "model-download",
      concurrency: Infinity,
      describe: (id) => ({
        key: id,
        label: `Download ${TRANSCRIPTION_MODELS.find((model) => model.id === id)!.name}`,
        cancellable: id !== "apple-speech",
      }),
      run: async (id, { signal, progress }) => {
        try {
          if (id === "apple-speech") await this.#installApple(progress);
          else {
            await this.#downloadHub(id, HUB_MODELS[id]!, signal, progress);
            this.#set(id, { id, status: { state: "downloaded" } });
          }
        } finally {
          if (signal.aborted) this.#set(id, { id, status: { state: "notDownloaded" } });
        }
      },
      failed: (id, error) => {
        console.error(`Could not download ${id}`, error);
        this.#set(id, {
          id,
          status: { state: "notDownloaded" },
          error: error instanceof Error ? error.message : String(error),
          ...this.#locale(id),
        });
      },
    });
    for (const { id } of TRANSCRIPTION_MODELS) {
      const status: ModelStatus =
        id === "apple-speech"
          ? { state: "unavailable" }
          : { state: existsSync(this.#folder(id)) ? "downloaded" : "notDownloaded" };
      this.#states.set(id, { id, status });
    }
  }

  get models(): ModelState[] {
    return [...this.#states.values()].map((state) => structuredClone(state));
  }

  /**
   * Asks macOS about Apple Speech again, since it can be installed or removed outside Chord, and its language
   * changes. While it's downloading, it's asked once that ends.
   */
  async refresh(): Promise<ModelState[]> {
    if (
      !this.#jobs.has("apple-speech") ||
      this.#states.get("apple-speech")?.status.state !== "downloading"
    )
      await this.#refreshApple();
    return this.models;
  }

  async #refreshApple(): Promise<void> {
    const locale = this.#appleLocale();
    try {
      const assets = await this.#apple.assets(locale);
      // A language chosen meanwhile is asked about by its own refresh.
      if (locale === this.#appleLocale()) this.#setApple(assets);
    } catch (error) {
      console.error("Could not check Apple Speech", error);
    }
  }

  /** Starts downloading `id`, unless it's downloading, downloaded, or unavailable. Failures show in its state. */
  download(id: unknown): void {
    if (!isTranscriptionModelId(id) || this.#states.get(id)?.status.state !== "notDownloaded")
      return;
    this.#set(id, { id, status: { state: "downloading", progress: null }, ...this.#locale(id) });
    this.#jobs.enqueue(id);
  }

  /** Stops downloading `id`, keeping the files it finished. Apple Speech's download, macOS's, can't be stopped. */
  cancel(id: unknown): void {
    if (id !== "apple-speech") this.#jobs.cancel((job) => job === id);
  }

  /** Deletes a downloaded model. Apple Speech is the system's and stays. */
  remove(id: unknown): void {
    if (
      !isTranscriptionModelId(id) ||
      id === "apple-speech" ||
      this.#states.get(id)?.status.state !== "downloaded"
    )
      return;
    rmSync(this.#folder(id), { recursive: true, force: true });
    this.#set(id, { id, status: { state: "notDownloaded" } });
  }

  /** Where a downloaded model's files are, or null when it isn't downloaded. Apple Speech's are macOS's, so null. */
  folder(id: TranscriptionModelId): string | null {
    return id !== "apple-speech" && this.#states.get(id)?.status.state === "downloaded"
      ? this.#folder(id)
      : null;
  }

  /** Stops downloads Chord owns, e.g. on quit. Apple Speech belongs to macOS. */
  stop(): void {
    this.#jobs.cancel((id) => id !== "apple-speech", false);
  }

  #folder(id: TranscriptionModelId): string {
    return join(this.#directory, id);
  }

  /** Apple Speech's languages, kept as its status changes. */
  #locale(id: TranscriptionModelId): Pick<ModelState, "locale" | "locales"> {
    const { locale, locales } = this.#states.get(id) ?? {};
    return { ...(locale && { locale }), ...(locales && { locales }) };
  }

  #set(id: TranscriptionModelId, state: ModelState, progressOnly = false): void {
    this.#states.set(id, state);
    this.#publish.send(progressOnly);
  }

  #setApple({ status, locale, locales, system }: AppleSpeechAssets): void {
    const statuses: Record<AppleSpeechAssets["status"], ModelStatus> = {
      unavailable: { state: "unavailable" },
      supported: { state: "notDownloaded" },
      downloading: { state: "downloading", progress: null },
      installed: { state: "downloaded" },
    };
    const next: ModelState = {
      id: "apple-speech",
      status: statuses[status],
      ...(locale && { locale }),
      ...(locales.length > 0 && { locales: { supported: locales, system } }),
    };
    // A failed download's error stays until its language is downloaded or another is chosen.
    const previous = this.#states.get("apple-speech");
    if (previous?.error && status === "supported" && previous.locale === locale)
      next.error = previous.error;
    if (JSON.stringify(next) !== JSON.stringify(this.#states.get("apple-speech")))
      this.#set("apple-speech", next);
  }

  async #installApple(taskProgress: TaskContext["progress"]): Promise<void> {
    const locale = this.#appleLocale();
    const assets = await this.#apple.install(locale, (progress) => {
      taskProgress(progress > 0 ? progress : null);
      // macOS reports 0 until it knows, so 0 shows as not known yet.
      if (progress > 0)
        this.#set(
          "apple-speech",
          {
            id: "apple-speech",
            status: { state: "downloading", progress },
            ...this.#locale("apple-speech"),
          },
          true,
        );
    });
    if (locale === this.#appleLocale()) this.#setApple(assets);
    else await this.#refreshApple();
  }

  async #downloadHub(
    id: TranscriptionModelId,
    model: HubModel,
    signal: AbortSignal,
    taskProgress: TaskContext["progress"],
  ): Promise<void> {
    const listing = await this.#fetch(
      `https://huggingface.co/api/models/${model.repo}/tree/${model.revision}?recursive=true`,
      { signal },
    );
    if (!listing.ok) throw new Error(`Hugging Face answered ${listing.status}`);
    const files = ((await listing.json()) as HubFile[]).filter(
      (file) =>
        file.type === "file" &&
        model.paths.some((path) =>
          path.endsWith("/") ? file.path.startsWith(path) : file.path === path,
        ),
    );
    if (files.length === 0) throw new Error("The model's files are missing from Hugging Face");

    const partial = `${this.#folder(id)}.partial`;
    const total = files.reduce((sum, file) => sum + file.size, 0);
    let received = 0;
    const report = () => {
      const progress = total > 0 ? received / total : null;
      taskProgress(progress);
      this.#set(id, { id, status: { state: "downloading", progress } }, true);
    };
    for (const file of files) {
      const target = join(partial, file.path);
      if (existsSync(target) && statSync(target).size === file.size) {
        received += file.size;
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      const response = await this.#fetch(
        `https://huggingface.co/${model.repo}/resolve/${model.revision}/${file.path}`,
        { signal },
      );
      if (!response.ok || !response.body)
        throw new Error(`Hugging Face answered ${response.status} for ${file.path}`);
      const hash = createHash("sha256");
      let size = 0;
      const count = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          size += chunk.length;
          received += chunk.length;
          report();
          callback(null, chunk);
        },
      });
      try {
        await pipeline(
          Readable.fromWeb(response.body as ReadableStream),
          count,
          createWriteStream(`${target}.download`),
          { signal },
        );
      } catch (error) {
        received -= size;
        throw error;
      }
      if (size !== file.size || (file.lfs && hash.digest("hex") !== file.lfs.oid)) {
        rmSync(`${target}.download`, { force: true });
        throw new Error(`${file.path} didn't download completely`);
      }
      renameSync(`${target}.download`, target);
    }
    writeFileSync(
      join(partial, "chord-model.json"),
      JSON.stringify({ repo: model.repo, revision: model.revision }),
    );
    rmSync(this.#folder(id), { recursive: true, force: true });
    renameSync(partial, this.#folder(id));
  }
}
