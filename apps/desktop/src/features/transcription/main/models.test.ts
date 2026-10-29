import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ModelLibrary, type AppleSpeech, type AppleSpeechAssets } from "./models.ts";
import type { ModelState } from "../domain/transcription.ts";

const PARAKEET = "parakeet-tdt-0.6b-v3";

/** The Parakeet repo's files, with one Chord doesn't need. */
const HUB_FILES: Record<string, string> = {
  "Preprocessor.mlmodelc/model.mil": "preprocessor",
  "Encoder.mlmodelc/weights/weight.bin": "encoder weights",
  "Decoder.mlmodelc/model.mil": "decoder",
  "JointDecisionv3.mlmodelc/model.mil": "joint",
  "parakeet_vocab.json": "{}",
  "EncoderInt4.mlmodelc/model.mil": "not needed",
};

/** Answers like Hugging Face from `files`. `fail` decides which file downloads break, and how. */
function hub(
  files = HUB_FILES,
  fail: (path: string) => "error" | "corrupt" | undefined = () => undefined,
) {
  const requested: string[] = [];
  const fetcher = async (url: string, { signal }: { signal: AbortSignal }): Promise<Response> => {
    signal.throwIfAborted();
    if (url.includes("/api/models/")) {
      const tree = Object.entries(files).map(([path, content]) => ({
        type: "file",
        path,
        size: content.length,
        ...(path.includes("weights") && {
          lfs: { oid: createHash("sha256").update(content).digest("hex"), size: content.length },
        }),
      }));
      return Response.json([{ type: "directory", path: "Encoder.mlmodelc", size: 0 }, ...tree]);
    }
    const path = decodeURIComponent(url.split("/resolve/")[1]!.split("/").slice(1).join("/"));
    requested.push(path);
    const failure = fail(path);
    if (failure === "error") return new Response("", { status: 500 });
    const content = files[path]!;
    return new Response(failure === "corrupt" ? content.replace(/./, "X") : content);
  };
  return { fetcher, requested };
}

const LOCALES = ["en-CA", "en-US", "fr-CA"];

/** macOS with English (Canada) as its language, and `installed` downloaded. `asked` has each language asked about. */
function apple(
  installed = new Set<string>(),
): AppleSpeech & { available: boolean; asked: (string | null)[]; failing?: string } {
  const assets = (locale: string | null): AppleSpeechAssets => {
    const resolved = locale ?? "en-CA";
    if (!speech.available)
      return { status: "unavailable", locale: null, locales: [], system: null };
    if (!LOCALES.includes(resolved))
      return { status: "unavailable", locale: null, locales: LOCALES, system: "en-CA" };
    return {
      status: installed.has(resolved) ? "installed" : "supported",
      locale: resolved,
      locales: LOCALES,
      system: "en-CA",
    };
  };
  const speech = {
    available: true,
    asked: [] as (string | null)[],
    failing: undefined as string | undefined,
    async assets(locale: string | null) {
      speech.asked.push(locale);
      return assets(locale);
    },
    async install(locale: string | null, onProgress: (progress: number) => void) {
      if (speech.failing === locale) throw new Error(`no model for ${locale}`);
      onProgress(0);
      onProgress(0.5);
      installed.add(locale ?? "en-CA");
      return assets(locale);
    },
  };
  return speech;
}

/** A library in a fresh folder, whose changes `until` waits on. */
function withLibrary(
  run: (setup: {
    directory: string;
    create: (
      fetcher: ReturnType<typeof hub>["fetcher"],
      speech?: AppleSpeech,
      locale?: () => string | null,
    ) => ModelLibrary;
    until: (predicate: (models: ModelState[]) => boolean) => Promise<ModelState[]>;
    changes: ModelState[][];
  }) => Promise<void>,
) {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), "chord-models-"));
    const directory = join(root, "models");
    const changes: ModelState[][] = [];
    const waiting = new Set<() => void>();
    const create = (
      fetcher: ReturnType<typeof hub>["fetcher"],
      speech: AppleSpeech = apple(),
      locale = () => null as string | null,
    ) =>
      new ModelLibrary(directory, { speech, locale }, fetcher, (models) => {
        changes.push(models);
        for (const check of waiting) check();
      });
    const until = (predicate: (models: ModelState[]) => boolean) =>
      new Promise<ModelState[]>((resolve) => {
        const check = () => {
          const latest = changes.at(-1);
          if (latest && predicate(latest)) {
            waiting.delete(check);
            resolve(latest);
          }
        };
        waiting.add(check);
        check();
      });
    try {
      await run({ directory, create, until, changes });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

const parakeet = (models: ModelState[]) => models.find((model) => model.id === PARAKEET)!;

test(
  "a Hugging Face model downloads the files it needs into its folder, with progress",
  withLibrary(async ({ directory, create, until, changes }) => {
    const { fetcher, requested } = hub();
    const library = create(fetcher);
    assert.deepEqual(parakeet(library.models).status, { state: "notDownloaded" });
    library.download(PARAKEET);
    assert.deepEqual(parakeet(library.models).status, { state: "downloading", progress: null });
    await until((models) => parakeet(models).status.state === "downloaded");

    assert.equal(requested.includes("EncoderInt4.mlmodelc/model.mil"), false);
    assert.equal(
      readFileSync(join(directory, PARAKEET, "Encoder.mlmodelc/weights/weight.bin"), "utf8"),
      "encoder weights",
    );
    assert.equal(readFileSync(join(directory, PARAKEET, "parakeet_vocab.json"), "utf8"), "{}");
    assert.equal(existsSync(join(directory, `${PARAKEET}.partial`)), false);
    const progress = changes
      .map((models) => parakeet(models).status)
      .filter((status) => status.state === "downloading");
    assert.ok(progress.length > 0);

    assert.deepEqual(
      parakeet(create(fetcher).models).status,
      { state: "downloaded" },
      "a new library finds it downloaded",
    );
    library.remove(PARAKEET);
    assert.deepEqual(parakeet(library.models).status, { state: "notDownloaded" });
    assert.equal(existsSync(join(directory, PARAKEET)), false);
  }),
);

test(
  "a failed download says why, and the next one keeps the files already done",
  withLibrary(async ({ create, until }) => {
    let broken = true;
    const { fetcher, requested } = hub(HUB_FILES, (path) =>
      broken && path === "Decoder.mlmodelc/model.mil" ? "error" : undefined,
    );
    const library = create(fetcher);
    library.download(PARAKEET);
    const failed = parakeet(await until((models) => !!parakeet(models).error));
    assert.deepEqual(failed.status, { state: "notDownloaded" });
    assert.match(failed.error!, /500/);

    broken = false;
    requested.length = 0;
    library.download(PARAKEET);
    assert.equal(parakeet(library.models).error, undefined, "a new download clears the error");
    await until((models) => parakeet(models).status.state === "downloaded");
    assert.deepEqual(requested, [
      "Decoder.mlmodelc/model.mil",
      "JointDecisionv3.mlmodelc/model.mil",
      "parakeet_vocab.json",
    ]);
  }),
);

test(
  "a file that doesn't match its checksum fails the download",
  withLibrary(async ({ directory, create, until }) => {
    const { fetcher } = hub(HUB_FILES, (path) =>
      path.includes("weights") ? "corrupt" : undefined,
    );
    const library = create(fetcher);
    library.download(PARAKEET);
    assert.match(
      parakeet(await until((models) => !!parakeet(models).error)).error!,
      /didn't download completely/,
    );
    assert.equal(
      existsSync(join(directory, `${PARAKEET}.partial`, "Encoder.mlmodelc/weights/weight.bin")),
      false,
    );
  }),
);

test(
  "a cancelled download goes back to not downloaded, without an error",
  withLibrary(async ({ create, until }) => {
    let release = () => {};
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const { fetcher } = hub();
    const library = create(async (url, init) => {
      if (url.includes("Decoder")) {
        await blocked;
        init.signal.throwIfAborted();
      }
      return fetcher(url, init);
    });
    library.download(PARAKEET);
    await until((models) => (parakeet(models).status as { progress?: number }).progress! > 0);
    library.cancel(PARAKEET);
    release();
    const cancelled = parakeet(
      await until((models) => parakeet(models).status.state === "notDownloaded"),
    );
    assert.equal(cancelled.error, undefined);
  }),
);

test(
  "Apple Speech follows macOS, installs with progress, and isn't removed",
  withLibrary(async ({ create, until }) => {
    const speech = apple();
    const library = create(hub().fetcher, speech);
    const appleState = (models: ModelState[]) =>
      models.find((model) => model.id === "apple-speech")!;
    assert.deepEqual(
      appleState(library.models).status,
      { state: "unavailable" },
      "until macOS is asked",
    );
    assert.deepEqual(appleState(await library.refresh()), {
      id: "apple-speech",
      status: { state: "notDownloaded" },
      locale: "en-CA",
      locales: { supported: LOCALES, system: "en-CA" },
    });

    library.download("apple-speech");
    library.stop(); // macOS owns this download; stopping Chord's downloads cannot cancel it.
    const installed = appleState(
      await until((models) => appleState(models).status.state === "downloaded"),
    );
    assert.equal(installed.locale, "en-CA");
    library.remove("apple-speech");
    assert.deepEqual(appleState(library.models).status, { state: "downloaded" });

    speech.available = false;
    assert.deepEqual(appleState(await library.refresh()), {
      id: "apple-speech",
      status: { state: "unavailable" },
    });
    library.download("unknown");
    library.download("apple-speech");
    assert.deepEqual(
      appleState(library.models).status,
      { state: "unavailable" },
      "an unavailable model doesn't download",
    );
  }),
);

test(
  "Apple Speech downloads and reports the chosen language, and a failure stays with its language",
  withLibrary(async ({ create, until }) => {
    const speech = apple(new Set(["en-CA"]));
    let locale: string | null = null;
    const library = create(hub().fetcher, speech, () => locale);
    const appleState = (models: ModelState[]) =>
      models.find((model) => model.id === "apple-speech")!;
    assert.deepEqual(
      appleState(await library.refresh()).status,
      { state: "downloaded" },
      "the system's language is installed",
    );

    locale = "fr-CA";
    const french = appleState(await library.refresh());
    assert.deepEqual([french.locale, french.status], ["fr-CA", { state: "notDownloaded" }]);
    speech.failing = "fr-CA";
    library.download("apple-speech");
    assert.equal(
      appleState(await until((models) => !!appleState(models).error)).error,
      "no model for fr-CA",
    );
    assert.equal(
      appleState(await library.refresh()).error,
      "no model for fr-CA",
      "the error stays while French is chosen",
    );

    locale = "en-US";
    const american = appleState(await library.refresh());
    assert.deepEqual(
      [american.locale, american.status, american.error],
      ["en-US", { state: "notDownloaded" }, undefined],
    );
    speech.failing = undefined;
    library.download("apple-speech");
    assert.equal(
      appleState(await until((models) => appleState(models).status.state === "downloaded")).locale,
      "en-US",
    );

    locale = "xx-YY";
    assert.deepEqual(appleState(await library.refresh()).status, { state: "unavailable" });
    assert.deepEqual(speech.asked, [null, "fr-CA", "fr-CA", "en-US", "xx-YY"]);
  }),
);
