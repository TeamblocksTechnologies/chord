import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BackgroundModelLibrary } from "./backgroundModels.ts";
import { BACKGROUND_MODELS, type BackgroundModelState } from "../contracts/backgroundRemoval.ts";

const MODEL = BACKGROUND_MODELS[0];
const CONTENT = Buffer.alloc(MODEL.size, 7);
const SHA = createHash("sha256").update(CONTENT).digest("hex");

/** A library whose "download" serves `body`, with the sizes and checksum the model is held to patched in. */
function setup(body: Buffer = CONTENT, status = 200) {
  const directory = mkdtempSync(join(tmpdir(), "chord-background-"));
  const seen: BackgroundModelState[][] = [];
  const fetcher = async (_url: string, { signal }: { signal: AbortSignal }) => {
    signal.throwIfAborted();
    return new Response(status === 200 ? body : "", { status });
  };
  const library = new BackgroundModelLibrary(directory, fetcher, (models) => seen.push(models), [
    { ...MODEL, sha256: SHA },
  ]);
  const settled = async (state: string) => {
    for (
      let i = 0;
      i < 200 && library.models.find((m) => m.id === MODEL.id)?.status.state !== state;
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    return library.models.find((m) => m.id === MODEL.id)!;
  };
  return {
    directory,
    library,
    seen,
    settled,
    clean: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("a model downloads, is verified, and can be removed", async () => {
  const { directory, library, settled, clean } = setup();
  try {
    assert.equal(library.models[0]!.status.state, "notDownloaded");
    assert.equal(library.file(MODEL.id), null);
    library.download(MODEL.id);
    assert.equal(library.models[0]!.status.state, "downloading");
    assert.equal((await settled("downloaded")).status.state, "downloaded");
    assert.deepEqual(readFileSync(library.file(MODEL.id)!), CONTENT);
    assert.equal(existsSync(join(directory, `${MODEL.id}.onnx.partial`)), false);
    library.remove(MODEL.id);
    assert.equal(library.models[0]!.status.state, "notDownloaded");
    assert.equal(existsSync(join(directory, `${MODEL.id}.onnx`)), false);
  } finally {
    clean();
  }
});

test("a corrupted or failed download leaves nothing behind and says why", async () => {
  for (const [body, status] of [
    [Buffer.alloc(MODEL.size, 9), 200],
    [CONTENT, 500],
  ] as const) {
    const { directory, library, settled, clean } = setup(body, status);
    try {
      library.download(MODEL.id);
      const state = await settled("notDownloaded");
      assert.ok(state.error);
      assert.equal(existsSync(join(directory, `${MODEL.id}.onnx`)), false);
      assert.equal(existsSync(join(directory, `${MODEL.id}.onnx.partial`)), false);
    } finally {
      clean();
    }
  }
});

test("a model already on disk with the right size starts downloaded, and unknown ids are ignored", () => {
  const { directory, clean } = setup();
  try {
    writeFileSync(join(directory, `${MODEL.id}.onnx`), CONTENT);
    const library = new BackgroundModelLibrary(
      directory,
      async () => assert.fail("fetched"),
      () => {},
      [{ ...MODEL, sha256: SHA }],
    );
    assert.equal(library.models[0]!.status.state, "downloaded");
    library.download("nope");
    library.remove("nope");
  } finally {
    clean();
  }
});
