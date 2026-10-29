import assert from "node:assert/strict";
import { test } from "node:test";
import { audioSources } from "./audioSources.ts";
import {
  isNoiseResult,
  resolveNoiseEngine,
  type NoiseEngineState,
  type NoiseState,
} from "#features/audio-processing/contracts/noiseReduction";
import { cleanedUrl } from "../contracts/playback.ts";

const URL = "chord-media://file/folder%2Fmic.m4a";
const recordings = [
  {
    id: "a",
    directory: "/rec/a",
    audio: {
      "microphone:0": { volume: 1, muted: false, denoised: true },
      "microphone:1": { volume: 1, muted: false, denoised: true },
      "systemAudio:0": { volume: 1, muted: false },
    },
  },
  {
    id: "b",
    directory: "/rec/b",
    audio: { "microphone:0": { volume: 1, muted: false, denoised: true } },
  },
  {
    id: "c",
    directory: null,
    audio: { "microphone:0": { volume: 1, muted: false, denoised: true } },
  },
];
const state = (directory: string, tracks: NoiseState["tracks"]): NoiseState => ({
  directory,
  tracks,
});
const result = (id: string) => ({
  phase: "done" as const,
  result: { id, engine: "apple" as const, files: { "mic.m4a": `noise/${id}/0.wav` } },
});

test("audio plays from its cleaned copy only when noise reduction is on and the copy exists", () => {
  const noise = {
    "/rec/a": state("/rec/a", { "microphone:0": result("one"), "systemAudio:0": result("sys") }),
    "/rec/b": state("/rec/b", { "microphone:0": { phase: "processing", progress: 0.5 } }),
  };
  const source = audioSources(recordings, noise);
  assert.equal(source("a", "microphone", 0, URL), cleanedUrl(URL, "one"));
  assert.match(source("a", "microphone", 0, URL), /\?clean=one$/);
  assert.equal(
    source("a", "systemAudio", 0, URL),
    URL,
    "a track with noise reduction off plays its file",
  );
  assert.equal(source("a", "microphone", 1, URL), URL, "a track with no copy yet plays its file");
  assert.equal(source("b", "microphone", 0, URL), URL, "and while its copy is being made");
  assert.equal(source("c", "microphone", 0, URL), URL, "a recording with no folder has none");
  assert.equal(source("nope", "microphone", 0, URL), URL);
  assert.equal(
    audioSources(recordings, {})("a", "microphone", 0, URL),
    URL,
    "and before anything is known",
  );
});

test("a failed attempt that kept an earlier copy still plays the earlier copy", () => {
  const noise = {
    "/rec/a": state("/rec/a", {
      "microphone:0": { phase: "failed", error: "no", result: result("kept").result },
    }),
  };
  assert.equal(audioSources(recordings, noise)("a", "microphone", 0, URL), cleanedUrl(URL, "kept"));
});

test("the cleaned URL carries the version so a copy made again is fetched again", () => {
  assert.notEqual(cleanedUrl(URL, "one"), cleanedUrl(URL, "two"));
  assert.equal(cleanedUrl(URL, "a b"), `${URL}?clean=a%20b`);
});

const engine = (
  id: NoiseEngineState["id"],
  state: NoiseEngineState["status"]["state"],
): NoiseEngineState => ({
  id,
  status:
    state === "unavailable"
      ? { state, reason: "no" }
      : state === "downloading"
        ? { state, progress: 0.1 }
        : { state },
});

test("the engine in use is the one chosen if it can run, otherwise Apple's, otherwise the download", () => {
  const both = [engine("apple", "ready"), engine("deepfilternet3", "ready")];
  assert.equal(resolveNoiseEngine(null, both), "apple");
  assert.equal(resolveNoiseEngine("deepfilternet3", both), "deepfilternet3");
  assert.equal(
    resolveNoiseEngine("deepfilternet3", [
      engine("apple", "ready"),
      engine("deepfilternet3", "notDownloaded"),
    ]),
    "apple",
    "a chosen engine that was removed falls back",
  );
  assert.equal(
    resolveNoiseEngine(null, [engine("apple", "unavailable"), engine("deepfilternet3", "ready")]),
    "deepfilternet3",
  );
  assert.equal(
    resolveNoiseEngine("apple", [
      engine("apple", "unavailable"),
      engine("deepfilternet3", "downloading"),
    ]),
    null,
    "nothing that can run",
  );
  assert.equal(resolveNoiseEngine(null, []), null, "and before the list is known");
});

test("a saved result is only believed if it is well formed and stays inside the session folder", () => {
  const good = {
    version: 1,
    tracks: {
      "microphone:0": { id: "abc-1", engine: "apple", files: { "mic.m4a": "noise/abc-1/0.wav" } },
    },
  };
  assert.equal(isNoiseResult(good), true);
  assert.equal(isNoiseResult(good, new Set(["mic.m4a"])), true);
  assert.equal(
    isNoiseResult(good, new Set(["other.m4a"])),
    false,
    "it names a recorded file the recording has",
  );
  const withFile = (cleaned: string) => ({
    ...good,
    tracks: { "microphone:0": { ...good.tracks["microphone:0"], files: { "mic.m4a": cleaned } } },
  });
  for (const bad of [
    "../../etc/passwd",
    "/etc/passwd",
    "noise/../x.wav",
    "noise/abc/0.mp4",
    "noise/abc/0.wav/../1.wav",
    "other/abc/0.wav",
  ])
    assert.equal(isNoiseResult(withFile(bad)), false, bad);
  assert.equal(isNoiseResult({ ...good, version: 2 }), false);
  assert.equal(
    isNoiseResult({ ...good, tracks: { "camera:0": good.tracks["microphone:0"] } }),
    false,
  );
  assert.equal(
    isNoiseResult({
      ...good,
      tracks: { "microphone:0": { ...good.tracks["microphone:0"], engine: "magic" } },
    }),
    false,
  );
  assert.equal(
    isNoiseResult({
      ...good,
      tracks: { "microphone:0": { ...good.tracks["microphone:0"], id: "../x" } },
    }),
    false,
  );
  assert.equal(
    isNoiseResult({
      ...good,
      tracks: { "microphone:0": { ...good.tracks["microphone:0"], files: {} } },
    }),
    false,
  );
  assert.equal(isNoiseResult(null), false);
});
