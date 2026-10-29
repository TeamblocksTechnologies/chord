import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Manifest } from "@teamblocks.dev/chord-recorder-protocol";
import { cleanedFile, readNoise } from "./noiseFiles.ts";
import type { NoiseJob } from "./noiseProcessing.ts";
import { RecordingNoise } from "./recordingNoise.ts";
import type { NoiseEngineId, NoiseState } from "../contracts/noiseReduction.ts";

const manifest = {
  tracks: [
    { id: "screen", kind: "screen", segments: [{ file: "screen-0.mov" }] },
    {
      id: "mic-a",
      kind: "microphone",
      segments: [{ file: "mic-a-0.m4a" }, { file: "mic-a-1.m4a" }],
    },
    { id: "mic-empty", kind: "microphone", segments: [] },
    { id: "mic-b", kind: "microphone", segments: [{ file: "mic-b-0.m4a" }] },
    { id: "sys", kind: "systemAudio", segments: [{ file: "sys-0.m4a" }] },
  ],
} as unknown as Manifest;

function setup(
  options: {
    process?: (
      job: NoiseJob,
      signal: AbortSignal,
      progress: (value: number) => void,
    ) => Promise<void>;
    engine?: () => NoiseEngineId;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "chord-recording-noise-"));
  const changes: NoiseState[] = [];
  const jobs: NoiseJob[] = [];
  let engine: NoiseEngineId = "apple";
  let exists = true;
  const make = () =>
    new RecordingNoise({
      async load() {
        if (!exists) throw new Error("gone");
        return manifest;
      },
      async decoded(file) {
        return `${file}.decoded.wav`;
      },
      async engine() {
        return { id: options.engine?.() ?? engine, folder: null };
      },
      async process(job, signal, progress) {
        jobs.push(job);
        if (options.process) return options.process(job, signal, progress);
        for (const file of job.files) writeFileSync(file.output, "cleaned");
        progress(0.5);
      },
      change: (state) => changes.push(state),
    });
  const noise = make();
  const settled = async (key: string, phase: string) => {
    for (let i = 0; i < 300 && changes.at(-1)?.tracks[key]?.phase !== phase; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    return changes.at(-1)!.tracks[key]!;
  };
  return {
    directory,
    noise,
    changes,
    jobs,
    settled,
    make,
    useEngine(next: NoiseEngineId) {
      engine = next;
    },
    deleteRecording() {
      exists = false;
    },
    clean: () => rmSync(directory, { recursive: true, force: true }),
  };
}

test("a track is cleaned file by file, saved in its own folder, and found again afterwards", async () => {
  const { directory, noise, jobs, settled, changes, make, clean } = setup();
  try {
    assert.deepEqual((await noise.get(directory)).tracks, {});
    const started = await noise.start(directory, "microphone", 1);
    assert.equal(started.tracks["microphone:1"]!.phase, "queued");
    const done = await settled("microphone:1", "done");
    // Index 1 is the second microphone that recorded anything: the empty track in between doesn't count.
    assert.deepEqual(
      jobs[0]!.files.map((file) => file.source),
      [join(directory, "mic-b-0.m4a.decoded.wav")],
    );
    assert.equal(done.result!.engine, "apple");
    assert.deepEqual(Object.keys(done.result!.files), ["mic-b-0.m4a"]);
    assert.ok(changes.some((state) => state.tracks["microphone:1"]?.phase === "processing"));
    assert.equal(
      readFileSync(join(directory, done.result!.files["mic-b-0.m4a"]!), "utf8"),
      "cleaned",
    );
    assert.equal(
      cleanedFile(directory, "mic-b-0.m4a"),
      join(directory, done.result!.files["mic-b-0.m4a"]!),
    );
    assert.equal(cleanedFile(directory, "mic-a-0.m4a"), undefined, "other tracks have no copy");
    // A new instance, as after a restart, finds the saved copy.
    const reopened = await make().get(directory);
    assert.equal(reopened.tracks["microphone:1"]!.phase, "done");
    assert.equal(reopened.tracks["microphone:1"]!.result!.id, done.result!.id);
  } finally {
    clean();
  }
});

test("a track with several files cleans them all, and the tracks of other kinds are separate", async () => {
  const { directory, noise, jobs, settled, clean } = setup();
  try {
    await noise.start(directory, "microphone", 0);
    await settled("microphone:0", "done");
    await noise.start(directory, "systemAudio", 0);
    await settled("systemAudio:0", "done");
    assert.equal(jobs[0]!.files.length, 2);
    assert.deepEqual(Object.keys(readNoise(directory)!.tracks).sort(), [
      "microphone:0",
      "systemAudio:0",
    ]);
    assert.ok(noise.cleaned(directory, "microphone", 0));
    assert.equal(noise.cleaned(directory, "microphone", 1), undefined);
  } finally {
    clean();
  }
});

test("asking again with the same engine reuses the copy, and a different engine makes a new one and drops the old", async () => {
  const { directory, noise, jobs, settled, useEngine, clean } = setup();
  try {
    await noise.start(directory, "microphone", 0);
    const first = await settled("microphone:0", "done");
    const again = await noise.start(directory, "microphone", 0);
    assert.equal(again.tracks["microphone:0"]!.phase, "done");
    assert.equal(jobs.length, 1, "no second job");
    useEngine("deepfilternet3");
    const second = await noise.start(directory, "microphone", 0);
    assert.equal(second.tracks["microphone:0"]!.phase, "queued");
    for (
      let i = 0;
      i < 300 && noise.cleaned(directory, "microphone", 0)?.engine !== "deepfilternet3";
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(jobs.length, 2);
    assert.equal(noise.cleaned(directory, "microphone", 0)!.engine, "deepfilternet3");
    assert.notEqual(noise.cleaned(directory, "microphone", 0)!.id, first.result!.id);
    assert.equal(
      existsSync(join(directory, "noise", first.result!.id)),
      false,
      "the replaced copies are removed",
    );
  } finally {
    clean();
  }
});

test("a failed job keeps the earlier copy and leaves no folder behind", async () => {
  let fail = false;
  const { directory, noise, settled, useEngine, clean } = setup({
    async process(job) {
      if (fail) {
        writeFileSync(job.files[0]!.output, "half");
        throw new Error("the model fell over");
      }
      for (const file of job.files) writeFileSync(file.output, "cleaned");
    },
  });
  try {
    await noise.start(directory, "microphone", 0);
    const good = await settled("microphone:0", "done");
    fail = true;
    useEngine("deepfilternet3");
    await noise.start(directory, "microphone", 0);
    const failed = await settled("microphone:0", "failed");
    assert.match(failed.error!, /fell over/);
    assert.equal(failed.result!.id, good.result!.id, "the state still names the earlier copy");
    assert.equal(noise.cleaned(directory, "microphone", 0)!.id, good.result!.id);
    assert.deepEqual(readdirNoise(directory), [good.result!.id]);
  } finally {
    clean();
  }
});

function readdirNoise(directory: string): string[] {
  return existsSync(join(directory, "noise")) ? readdirSync(join(directory, "noise")) : [];
}

test("cancelling stops a running job and removes what it made, and takes a queued one off the queue", async () => {
  let release!: () => void;
  const started = new Promise<void>((resolve) => (release = resolve));
  const { directory, noise, jobs, settled, changes, clean } = setup({
    async process(job, signal) {
      writeFileSync(job.files[0]!.output, "partial");
      release();
      await new Promise<void>((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      );
    },
  });
  try {
    await noise.start(directory, "microphone", 0);
    await noise.start(directory, "systemAudio", 0);
    await started;
    assert.equal(changes.at(-1)!.tracks["systemAudio:0"]!.phase, "queued");
    noise.cancel(directory, "systemAudio", 0);
    noise.cancel(directory, "microphone", 0);
    assert.equal((await settled("microphone:0", "idle")).phase, "idle");
    assert.equal(changes.at(-1)!.tracks["systemAudio:0"]!.phase, "idle");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(jobs.length, 1, "the queued job never ran");
    assert.deepEqual(readdirNoise(directory), []);
    assert.equal(readNoise(directory), null);
  } finally {
    clean();
  }
});

test("one job runs at a time, in the order they were asked for", async () => {
  const order: string[] = [];
  let running = 0;
  let overlap = false;
  const { directory, noise, settled, clean } = setup({
    async process(job) {
      if (++running > 1) overlap = true;
      order.push(job.files[0]!.source);
      await new Promise((resolve) => setTimeout(resolve, 10));
      for (const file of job.files) writeFileSync(file.output, "cleaned");
      running--;
    },
  });
  try {
    await noise.start(directory, "microphone", 0);
    await noise.start(directory, "microphone", 1);
    await noise.start(directory, "systemAudio", 0);
    await settled("systemAudio:0", "done");
    assert.equal(overlap, false);
    assert.deepEqual(
      order.map((source) => source.split("/").at(-1)),
      ["mic-a-0.m4a.decoded.wav", "mic-b-0.m4a.decoded.wav", "sys-0.m4a.decoded.wav"],
    );
  } finally {
    clean();
  }
});

test("a recording deleted while its track is being cleaned is not recreated", async () => {
  const { directory, noise, settled, deleteRecording, clean } = setup({
    async process(job) {
      for (const file of job.files) writeFileSync(file.output, "cleaned");
      deleteRecording();
    },
  });
  try {
    await noise.start(directory, "microphone", 0);
    const failed = await settled("microphone:0", "failed");
    assert.match(failed.error!, /gone/);
    assert.equal(readNoise(directory), null, "nothing was saved");
    assert.deepEqual(readdirNoise(directory), []);
  } finally {
    clean();
  }
});

test("saved copies whose files are gone are dropped, a damaged file is ignored, and bad requests are refused", async () => {
  const { directory, noise, settled, make, clean } = setup();
  try {
    await noise.start(directory, "microphone", 0);
    const done = await settled("microphone:0", "done");
    rmSync(join(directory, done.result!.files["mic-a-0.m4a"]!));
    assert.deepEqual((await make().get(directory)).tracks, {}, "a missing file means no copy");
    assert.equal(
      cleanedFile(directory, "mic-a-1.m4a"),
      join(directory, done.result!.files["mic-a-1.m4a"]!),
      "files that remain can still be served",
    );
    mkdirSync(join(directory, "x"), { recursive: true });
    writeFileSync(join(directory, "noise.json"), "{not json");
    assert.equal(readNoise(directory), null);
    assert.deepEqual((await make().get(directory)).tracks, {});
    await assert.rejects(noise.start(directory, "camera", 0), /Not an audio track/);
    await assert.rejects(noise.start(directory, "microphone", -1), /Not an audio track/);
    await assert.rejects(noise.start(directory, "microphone", 1.5), /Not an audio track/);
    await assert.rejects(noise.start(directory, "microphone", 7), /no such audio track/);
  } finally {
    clean();
  }
});
