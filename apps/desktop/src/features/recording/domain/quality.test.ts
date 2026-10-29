import assert from "node:assert/strict";
import { test } from "node:test";
import type { CameraSource } from "@teamblocks.dev/chord-recorder-protocol";
import {
  cameraConfig,
  cameraOrientations,
  cameraPreset,
  formatFor,
  formatsIn,
  formatSize,
  frameRates,
  sizeName,
  resolveCamera,
  resolveScreen,
} from "./quality.ts";
import { initialSetup, isRecordingSetup, upgradeQuality } from "#project-document/domain/recording";

// As a MacBook's FaceTime HD camera lists them.
const facetime: CameraSource = {
  id: "facetime",
  name: "FaceTime HD Camera",
  isDefault: true,
  formats: [
    { width: 1552, height: 1552, maxFps: 30 },
    { width: 1760, height: 1328, maxFps: 30 },
    { width: 1328, height: 1760, maxFps: 30 },
    { width: 1080, height: 1920, maxFps: 30 },
    { width: 1920, height: 1080, maxFps: 30 },
    { width: 1280, height: 720, maxFps: 30 },
    { width: 640, height: 480, maxFps: 30 },
  ],
};

const webcam: CameraSource = {
  id: "webcam",
  name: "Webcam",
  isDefault: false,
  formats: [
    { width: 3840, height: 2160, maxFps: 30 },
    { width: 1920, height: 1080, maxFps: 60 },
    { width: 1280, height: 720, maxFps: 60 },
  ],
};

test("camera presets pick the largest landscape size within their cap", () => {
  assert.deepEqual(cameraPreset(facetime, "standard"), { width: 1280, height: 720, fps: 30 });
  assert.deepEqual(cameraPreset(facetime, "high"), { width: 1920, height: 1080, fps: 30 });
  assert.deepEqual(cameraPreset(facetime, "max"), { width: 1760, height: 1328, fps: 30 });
  assert.deepEqual(cameraPreset(webcam, "high"), { width: 1920, height: 1080, fps: 30 });
  assert.deepEqual(cameraPreset(webcam, "max"), { width: 3840, height: 2160, fps: 30 });
  const tiny = { ...webcam, formats: [{ width: 3840, height: 2160, maxFps: 30 }] };
  assert.deepEqual(cameraPreset(tiny, "standard"), { width: 3840, height: 2160, fps: 30 });
  assert.equal(cameraPreset({ ...webcam, formats: [] }, "high"), undefined);
  assert.deepEqual(cameraOrientations(facetime), ["landscape", "portrait", "square"]);
  assert.deepEqual(cameraOrientations(webcam), ["landscape"]);
  assert.deepEqual(
    formatsIn(facetime, "portrait").map((f) => `${f.width}x${f.height}`),
    ["1328x1760", "1080x1920"],
  );
  assert.deepEqual(formatFor(facetime, { width: 1920, height: 1080, fps: 30 }, "portrait"), {
    width: 1080,
    height: 1920,
    maxFps: 30,
  });
  assert.deepEqual(formatFor(facetime, { width: 1280, height: 720, fps: 30 }, "portrait"), {
    width: 1328,
    height: 1760,
    maxFps: 30,
  });
  assert.deepEqual(formatFor(facetime, { width: 1920, height: 1080, fps: 30 }, "square"), {
    width: 1552,
    height: 1552,
    maxFps: 30,
  });
});

test("a camera's own settings apply while it still lists that size", () => {
  assert.deepEqual(resolveCamera(webcam, "standard", { width: 1920, height: 1080, fps: 60 }), {
    width: 1920,
    height: 1080,
    fps: 60,
  });
  assert.deepEqual(resolveCamera(webcam, "standard", { width: 3840, height: 2160, fps: 60 }), {
    width: 3840,
    height: 2160,
    fps: 30,
  });
  assert.deepEqual(resolveCamera(webcam, "standard", { width: 800, height: 600, fps: 30 }), {
    width: 1280,
    height: 720,
    fps: 30,
  });
  assert.deepEqual(cameraConfig(webcam, "high", undefined), {
    deviceId: "webcam",
    format: { width: 1920, height: 1080 },
    fps: 30,
  });
  assert.deepEqual(cameraConfig({ ...webcam, formats: [] }, "high", undefined), {
    deviceId: "webcam",
  });
});

test("frame rates and sizes read as people expect", () => {
  assert.deepEqual(frameRates({ width: 1, height: 1, maxFps: 60 }), [24, 30, 60]);
  assert.deepEqual(frameRates({ width: 1, height: 1, maxFps: 15 }), [15]);
  assert.equal(formatSize({ width: 1920, height: 1080 }), "1920×1080");
  assert.equal(sizeName({ width: 1920, height: 1080 }), "1080p");
  assert.equal(sizeName({ width: 1080, height: 1920 }), "1080p");
  assert.equal(sizeName({ width: 3840, height: 2160 }), "4K");
  assert.equal(sizeName({ width: 640, height: 480 }), "480p");
  assert.equal(sizeName({ width: 1760, height: 1328 }), undefined);
  const shuffled = { ...webcam, formats: [...webcam.formats].reverse() };
  assert.deepEqual(
    formatsIn(shuffled, "landscape").map((f) => f.width),
    [3840, 1920, 1280],
  );
  assert.deepEqual(resolveScreen("standard", null), { fps: 30, scale: 0.5, hdr: false });
  assert.deepEqual(resolveScreen("standard", { fps: 60, scale: 1, hdr: true }), {
    fps: 60,
    scale: 1,
    hdr: true,
  });
});

test("old frame rate and resolution settings become presets or the screen's own settings", () => {
  const { quality: _q, screenQuality: _s, cameraQuality: _c, ...old } = initialSetup();
  const upgrade = (fps: number, scale: number) => ({
    ...initialSetup(),
    ...upgradeQuality({ ...old, fps, scale }),
  });
  assert.equal(upgrade(30, 1).screenQuality, null);
  assert.deepEqual(upgrade(60, 0.5).screenQuality, { fps: 60, scale: 0.5, hdr: false });
  assert.equal("fps" in upgrade(60, 1), false);
  assert.equal(isRecordingSetup(upgrade(60, 1)), true);
  assert.equal(isRecordingSetup({ ...old, fps: 30, scale: 1 }), false);
  assert.equal(
    isRecordingSetup({ ...initialSetup(), cameraQuality: { a: { width: 0, height: 1, fps: 30 } } }),
    false,
  );
});
