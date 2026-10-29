import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import type { Manifest, ManifestTrack } from "@teamblocks.dev/chord-recorder-protocol";
import { alphaBytes, backgroundInput, maskDimensions } from "../main/backgroundInference.ts";
import { RecordingBackgrounds } from "../main/recordingBackgrounds.ts";
import {
  isCameraBackground,
  isHexColor,
  type BackgroundState,
  type CameraBackground,
} from "../contracts/backgroundRemoval.ts";

const defaults = (): CameraBackground => ({
  enabled: true,
  replacement: "blur",
  blur: 40,
  color: "#00b140",
});
const camera = (id: string, files: string[]): ManifestTrack => ({
  id,
  kind: "camera",
  source: id,
  segments: files.map((file, i) => ({ file, start: i * 3, end: i * 3 + 2 })),
});
const manifest = (tracks: ManifestTrack[]): Manifest => ({
  version: 1,
  id: "s",
  createdAt: "",
  hostTimeOrigin: 0,
  config: {} as Manifest["config"],
  tracks,
  pauses: [{ start: 2, end: 3 }],
  marks: [],
});

test("background removal supports transparent hex colors while opaque color validation stays strict", () => {
  for (const color of ["#123456", "#12345600", "#aAbBcC80", "#123456ff"]) {
    assert.equal(isCameraBackground({ ...defaults(), color }), true, color);
  }
  assert.equal(isHexColor("#12345680"), false);
  for (const color of ["#123", "#1234", "#1234567", "#123456789", "#gggggg80", "red", null]) {
    assert.equal(isCameraBackground({ ...defaults(), color }), false, String(color));
  }
});

test("camera pixels are normalized RGB tensors, with model-specific preprocessing and bounded dimensions", () => {
  const modnet = backgroundInput(new Uint8Array([0, 127, 255, 255]), 1, 1, "modnet");
  assert.equal(modnet[0], 1, "BGRA red becomes the first channel");
  assert.equal(modnet[2], -1);
  const ben2 = backgroundInput(new Uint8Array([0, 127, 255, 255]), 1, 1, "ben2");
  assert.ok(Math.abs(ben2[0]! - (1 - 0.485) / 0.229) < 1e-5);
  assert.deepEqual(maskDimensions("ben2", 1920, 1080), { width: 1024, height: 1024 });
  assert.deepEqual(maskDimensions("modnet", 1920, 1080), { width: 896, height: 512 });
  assert.deepEqual(maskDimensions("modnet", 1080, 1920), { width: 512, height: 896 });
  assert.deepEqual(maskDimensions("modnet", 8000, 1000), { width: 1024, height: 128 });
  assert.throws(() => maskDimensions("modnet", 0, 720));
  assert.deepEqual(
    alphaBytes(new Float32Array([-1, 0, 0.5, 1, 2]), 5),
    new Uint8Array([0, 0, 128, 255, 255]),
  );
  assert.throws(() => alphaBytes(new Float32Array([NaN]), 1));
  assert.equal(isCameraBackground({ ...defaults(), blur: 101 }), false);
});

test("every camera segment is processed once; settings persist without inference and survive reload", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "chord-background-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls: string[] = [];
  const states: BackgroundState[] = [];
  const source = manifest([
    camera("c1", ["a.mp4", "b.mp4"]),
    camera("c2", ["c.mp4", "a.mp4"]),
    { id: "s", kind: "screen", source: "s", segments: [{ file: "screen.mov", start: 0, end: 4 }] },
  ]);
  const dependencies = {
    load: async () => source,
    model: () => ({ id: "modnet" as const, weights: "model.onnx" }),
    defaults,
    async process(
      work: { files: { source: string; output: string }[] },
      _signal: AbortSignal,
      progress: (value: number) => void,
    ) {
      for (const file of work.files) {
        calls.push(file.source);
        writeFileSync(file.output, "mask");
      }
      progress(0.5);
    },
    change: (state: BackgroundState) => {
      states.push(state);
    },
  };
  const service = new RecordingBackgrounds(dependencies);
  context.after(() => service.dispose());
  await Promise.all([service.start(directory), service.start(directory)]);
  await waitFor(async () => (await service.get(directory)).phase === "done");
  assert.deepEqual(
    calls.map((file) => file.split("/").at(-1)),
    ["a.mp4", "b.mp4", "c.mp4"],
  );
  assert.ok(states.some((state) => state.phase === "processing" && state.progress === 0.5));
  const initial = (await service.get(directory)).result!;
  await Promise.all([
    service.update(directory, { replacement: "color", color: "#12345680" }),
    service.update(directory, { enabled: false, blur: 75 }),
  ]);
  const edited = (await service.get(directory)).result!;
  assert.deepEqual(edited.masks, initial.masks, "Settings never rewrite masks or source timing");
  assert.deepEqual(edited.settings, {
    enabled: false,
    replacement: "color",
    color: "#12345680",
    blur: 75,
  });
  assert.equal(calls.length, 3, "Changing backgrounds does not run the model again");
  const reloaded = new RecordingBackgrounds(dependencies);
  assert.deepEqual((await reloaded.get(directory)).result, edited);
  await assert.rejects(service.update(directory, { color: "red" }), /Invalid/);
  const disk = JSON.parse(readFileSync(join(directory, "background.json"), "utf8"));
  assert.deepEqual(disk, edited);
});

test("failures and cancellation keep the previous result and remove partial masks; retry recovers", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "chord-background-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  let mode = "done";
  let entered = false;
  let lastOutput = "";
  const service = new RecordingBackgrounds({
    load: async () => manifest([camera("c", ["camera.mp4"])]),
    model: () => ({ id: "modnet", weights: "model" }),
    defaults,
    async process(work, signal) {
      entered = true;
      lastOutput = work.files[0]!.output;
      writeFileSync(lastOutput, "mask");
      if (mode === "failed") throw new Error("Model inference failed");
      if (mode === "cancel")
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
    },
    change: () => {},
  });
  context.after(() => service.dispose());
  await service.start(directory);
  await waitFor(async () => (await service.get(directory)).phase === "done");
  await service.update(directory, { color: "#abcdef", replacement: "color" });
  const original = (await service.get(directory)).result!;
  mode = "failed";
  await service.start(directory);
  await waitFor(async () => (await service.get(directory)).phase === "failed");
  assert.deepEqual((await service.get(directory)).result, original);
  assert.throws(() => readFileSync(lastOutput));
  mode = "cancel";
  entered = false;
  await service.start(directory);
  await waitFor(async () => entered);
  service.cancel(directory);
  await waitFor(async () => {
    try {
      readFileSync(lastOutput);
      return false;
    } catch {
      return true;
    }
  });
  assert.deepEqual((await service.get(directory)).result, original);
  mode = "done";
  await service.start(directory);
  await waitFor(async () => (await service.get(directory)).phase === "done");
  assert.deepEqual(
    (await service.get(directory)).result!.settings,
    original.settings,
    "Reprocessing preserves this take's settings",
  );
});

test("missing models and camera-free recordings fail visibly without writing a result", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "chord-background-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  let hasCamera = true;
  const service = new RecordingBackgrounds({
    load: async () => manifest(hasCamera ? [camera("c", ["camera.mp4"])] : []),
    model: () => {
      throw new Error("Download a local model");
    },
    defaults,
    process: async () => assert.fail("Missing model must not start inference"),
    change: () => {},
  });
  context.after(() => service.dispose());
  await service.start(directory);
  await waitFor(async () => (await service.get(directory)).phase === "failed");
  assert.match((await service.get(directory)).error!, /Download/);
  hasCamera = false;
  await service.start(directory);
  await waitFor(async () => (await service.get(directory)).phase === "failed");
  assert.match((await service.get(directory)).error!, /no camera/);
});

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Background job did not settle");
}
