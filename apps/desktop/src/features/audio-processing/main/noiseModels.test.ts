import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { NoiseModelLibrary } from "./noiseModels.ts";
import {
  DEEP_FILTER_DOWNLOAD,
  type NoiseDownload,
  type NoiseEngineState,
} from "../contracts/noiseReduction.ts";

function entry(name: string, contents: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write(contents.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.write("0", 156, "ascii");
  return Buffer.concat([header, contents, Buffer.alloc((512 - (contents.length % 512)) % 512)]);
}

const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const NETWORKS = {
  "enc.onnx": Buffer.alloc(900, 1),
  "erb_dec.onnx": Buffer.alloc(1100, 2),
  "df_dec.onnx": Buffer.alloc(700, 3),
};

/** A download of three small networks in a tar.gz, described the way the real one is. */
function release(networks: Record<string, Buffer> = NETWORKS): {
  archive: Buffer;
  download: NoiseDownload;
} {
  const archive = gzipSync(
    Buffer.concat([
      ...Object.entries(networks).map(([name, contents]) => entry(`tmp/export/${name}`, contents)),
      Buffer.alloc(1024),
    ]),
  );
  return {
    archive,
    download: {
      url: "https://example.test/release.tar.gz",
      size: archive.length,
      sha256: sha(archive),
      files: Object.entries(NETWORKS).map(([name, contents]) => ({
        name,
        size: contents.length,
        sha256: sha(contents),
      })),
    },
  };
}

function setup(body: Buffer, download: NoiseDownload, apple: "ready" | "none" = "ready") {
  const directory = mkdtempSync(join(tmpdir(), "chord-noise-"));
  const seen: NoiseEngineState[][] = [];
  const fetcher = async (_url: string, { signal }: { signal: AbortSignal }) => {
    signal.throwIfAborted();
    return new Response(body.length ? body : "", { status: body.length ? 200 : 500 });
  };
  const library = new NoiseModelLibrary(
    directory,
    fetcher,
    (engines) => seen.push(engines),
    async () =>
      apple === "ready" ? { state: "ready" } : { state: "unavailable", reason: "Needs macOS 13" },
    download,
  );
  const settled = async (state: string) => {
    for (let i = 0; i < 300 && library.engines[1]!.status.state !== state; i++)
      await new Promise((r) => setTimeout(r, 10));
    return library.engines[1]!;
  };
  return {
    directory,
    library,
    seen,
    settled,
    clean: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("the networks download, are verified and unpacked, and can be removed", async () => {
  const { archive, download } = release();
  const { directory, library, settled, seen, clean } = setup(archive, download);
  try {
    assert.equal(library.engines[1]!.status.state, "notDownloaded");
    assert.equal(library.folder(), null);
    library.download("deepfilternet3");
    assert.equal(library.engines[1]!.status.state, "downloading");
    assert.equal((await settled("ready")).status.state, "ready");
    for (const [name, contents] of Object.entries(NETWORKS))
      assert.deepEqual(readFileSync(join(library.folder()!, name)), contents);
    assert.equal(existsSync(join(directory, "deepfilternet3.partial")), false);
    assert.ok(seen.some((engines) => engines[1]!.status.state === "downloading"));
    library.remove("deepfilternet3");
    assert.equal(library.engines[1]!.status.state, "notDownloaded");
    assert.equal(existsSync(join(directory, "deepfilternet3")), false);
  } finally {
    clean();
  }
});

test("a corrupted, incomplete or failed download leaves nothing behind and says why", async () => {
  const good = release();
  const wrongNetwork = release({ ...NETWORKS, "enc.onnx": Buffer.alloc(900, 9) });
  const missing = release({
    "enc.onnx": NETWORKS["enc.onnx"],
    "erb_dec.onnx": NETWORKS["erb_dec.onnx"],
  });
  const cases: [Buffer, NoiseDownload][] = [
    [Buffer.alloc(good.archive.length, 5), good.download],
    [
      wrongNetwork.archive,
      { ...good.download, size: wrongNetwork.archive.length, sha256: sha(wrongNetwork.archive) },
    ],
    [
      missing.archive,
      { ...good.download, size: missing.archive.length, sha256: sha(missing.archive) },
    ],
    [Buffer.alloc(0), good.download],
  ];
  for (const [body, download] of cases) {
    const { directory, library, settled, clean } = setup(body, download);
    try {
      library.download("deepfilternet3");
      const state = await settled("notDownloaded");
      assert.ok(state.error, "says why");
      assert.equal(existsSync(join(directory, "deepfilternet3")), false);
      assert.equal(existsSync(join(directory, "deepfilternet3.partial")), false);
    } finally {
      clean();
    }
  }
});

test("a download can be cancelled, and starts again afterwards", async () => {
  const { archive, download } = release();
  const { library, settled, clean } = setup(archive, download);
  try {
    library.download("deepfilternet3");
    library.cancel("deepfilternet3");
    const state = await settled("notDownloaded");
    assert.equal(state.error, undefined, "cancelling is not a failure");
    library.download("deepfilternet3");
    assert.equal((await settled("ready")).status.state, "ready");
  } finally {
    clean();
  }
});

test("networks already on disk start ready, and unknown ids and repeats are ignored", () => {
  const { archive, download } = release();
  const { directory, clean } = setup(archive, download);
  try {
    mkdirSync(join(directory, "deepfilternet3"));
    for (const [name, contents] of Object.entries(NETWORKS))
      writeFileSync(join(directory, "deepfilternet3", name), contents);
    const library = new NoiseModelLibrary(
      directory,
      async () => assert.fail("fetched"),
      () => {},
      async () => ({ state: "ready" }),
      download,
    );
    assert.equal(library.engines[1]!.status.state, "ready");
    library.download("deepfilternet3");
    library.download("nope");
    library.remove("nope");
    // A network that is the wrong size means the folder isn't trusted.
    writeFileSync(join(directory, "deepfilternet3", "enc.onnx"), "short");
    assert.equal(
      new NoiseModelLibrary(
        directory,
        async () => assert.fail("fetched"),
        () => {},
        async () => ({ state: "ready" }),
        download,
      ).engines[1]!.status.state,
      "notDownloaded",
    );
  } finally {
    clean();
  }
});

test("Apple's engine reports whether it can run, and a failed check says it can't", async () => {
  const { archive, download } = release();
  const ready = setup(archive, download, "ready");
  const none = setup(archive, download, "none");
  try {
    assert.deepEqual((await ready.library.list())[0], { id: "apple", status: { state: "ready" } });
    assert.deepEqual((await none.library.list())[0], {
      id: "apple",
      status: { state: "unavailable", reason: "Needs macOS 13" },
    });
    const broken = new NoiseModelLibrary(
      ready.directory,
      async () => assert.fail("fetched"),
      () => {},
      async () => {
        throw new Error("no helper");
      },
      download,
    );
    assert.equal((await broken.list())[0]!.status.state, "unavailable");
  } finally {
    ready.clean();
    none.clean();
  }
});

test("the real release is pinned to a commit, with a size and checksum for each of its three networks", () => {
  assert.equal(DEEP_FILTER_DOWNLOAD.files.length, 3);
  assert.match(
    DEEP_FILTER_DOWNLOAD.url,
    /raw\.githubusercontent\.com\/Rikorose\/DeepFilterNet\/[0-9a-f]{40}\//,
  );
  assert.ok(
    DEEP_FILTER_DOWNLOAD.files.every(
      (file) => /^[0-9a-f]{64}$/.test(file.sha256) && file.size > 1_000_000,
    ),
  );
});
