import assert from "node:assert/strict";
import { test } from "node:test";
import { RecordingController, type CaptureBackend } from "./recording.ts";
import type { FinishedRecording } from "#platform/contracts/desktop";
import {
  initialSetup,
  isRecordingSetup,
  upgradeScreenAppearance,
} from "#project-document/domain/recording";

test("a central session snapshots its target and rejects a second start", async (t) => {
  const recorder = new RecordingController(() => {});
  t.after(() => recorder.dispose());
  const setup = initialSetup();
  assert.equal(recorder.start(setup, { projectId: "project-1" }), true);
  setup.mode = "area";
  assert.equal(recorder.state.target?.setup.mode, "window");
  assert.equal(recorder.start(initialSetup(), { projectId: "project-2" }), false);
  assert.equal(recorder.state.target?.projectId, "project-1");
  recorder.addMark();
  recorder.pause();
  assert.equal(recorder.state.phase, "paused");
  recorder.resume();
  assert.equal(recorder.state.phase, "recording");
  const take = await recorder.stop();
  assert.equal(take?.target.projectId, "project-1");
  assert.equal(take?.markCount, 1);
  assert.equal(recorder.state.phase, "idle");
  assert.equal(await recorder.stop(), null);
});

test("countdown transitions and cancellation release the session timer", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const recorder = new RecordingController(() => {});
  t.after(() => recorder.dispose());
  recorder.start(initialSetup(), { countdown: 3 });
  assert.equal(recorder.state.countdown, 3);
  t.mock.timers.tick(2000);
  assert.equal(recorder.state.phase, "countdown");
  assert.equal(recorder.state.countdown, 1);
  t.mock.timers.tick(1000);
  assert.equal(recorder.state.phase, "recording");
  recorder.cancel();
  t.mock.timers.tick(10_000);
  assert.equal(recorder.state.phase, "idle");
  assert.equal(recorder.state.target, null);
  recorder.start(initialSetup(), { countdown: 3 });
  assert.equal(await recorder.stop(), null);
  assert.equal(recorder.state.phase, "idle");
});

test("an empty setup cannot start a session", () => {
  const recorder = new RecordingController(() => {});
  const setup = { ...initialSetup(), recordsScreen: false, systemAudio: false };
  assert.equal(recorder.start(setup), false);
  assert.equal(recorder.state.phase, "idle");
});

test("a live recording switches sources, quality, and areas, but keeps a source on", async (t) => {
  const recorder = new RecordingController(() => {});
  t.after(() => recorder.dispose());
  const setup = { ...initialSetup(), microphoneIds: ["mic"] };
  recorder.start(setup);
  const revision = recorder.revision;
  await recorder.update({ ...setup, recordsScreen: false, cameraIds: ["camera"], quality: "max" });
  assert.equal(recorder.state.target?.setup.quality, "max");
  assert.ok(recorder.revision > revision);
  await assert.rejects(
    () =>
      recorder.update({
        ...setup,
        recordsScreen: false,
        microphoneEnabled: false,
        cameraEnabled: false,
      }),
    /at least one source/,
  );
  await assert.rejects(
    () =>
      recorder.update({ ...setup, recordsScreen: true, microphoneEnabled: false, mode: "area" }),
    /at least one source/,
    "Area mode without areas records no screen",
  );
  assert.equal(
    recorder.state.target?.setup.cameraIds[0],
    "camera",
    "A rejected change leaves the recording as it was",
  );
  await recorder.update({ ...setup, cameraIds: [] });
  const take = await recorder.stop();
  assert.deepEqual(
    take?.used,
    { screen: true, camera: true, microphone: true, systemAudio: false },
    "A take records every source that was on at some point",
  );
  await assert.rejects(() => recorder.update(setup), /Not recording/);

  const area = { displayId: 1, x: 0, y: 0, width: 640, height: 360 };
  recorder.start({ ...setup, mode: "area", areas: [area] });
  await recorder.update({
    ...setup,
    mode: "area",
    areas: [area, { ...area, displayId: 2 }],
    background: "transparent",
  });
  assert.equal(recorder.state.target?.setup.areas.length, 2);
  await recorder.update({ ...setup, mode: "display", displayIds: [2] });
});

test("areas and the background are validated", () => {
  const setup = initialSetup();
  assert.deepEqual([setup.areas, setup.background], [[], "desktop"]);
  const area = { displayId: 1, x: 10, y: 20, width: 640, height: 360 };
  assert.equal(isRecordingSetup({ ...setup, areas: [area], background: "transparent" }), true);
  assert.equal(isRecordingSetup({ ...setup, areas: [{ ...area, width: 0 }] }), false);
  assert.equal(isRecordingSetup({ ...setup, areas: [{ ...area, displayId: "1" }] }), false);
  assert.equal(isRecordingSetup({ ...setup, background: "blurred" }), false);
});

test("the previewed camera defaults to none and is validated", () => {
  const setup = initialSetup();
  assert.equal(setup.primaryCameraId, null);
  assert.equal(isRecordingSetup({ ...setup, primaryCameraId: "cam" }), true);
  assert.equal(isRecordingSetup({ ...setup, primaryCameraId: 3 }), false);
});

test("the laser pointer switches on and off during a session and resets after it", async (t) => {
  const recorder = new RecordingController(() => {});
  t.after(() => recorder.dispose());
  recorder.setLaser(true);
  assert.equal(recorder.state.laser, false);
  recorder.start(initialSetup());
  recorder.setLaser(true);
  assert.equal(recorder.state.laser, true);
  recorder.setLaser(false);
  assert.equal(recorder.state.laser, false);
  recorder.setLaser(true);
  await recorder.stop();
  assert.equal(recorder.state.laser, false);
});

test("click highlights switch on and off during a session and reset after it", async (t) => {
  const recorder = new RecordingController(() => {});
  t.after(() => recorder.dispose());
  recorder.setClicks(true);
  assert.equal(recorder.state.clicks, false);
  recorder.start(initialSetup());
  recorder.setClicks(true);
  assert.equal(recorder.state.clicks, true);
  recorder.setClicks(false);
  assert.equal(recorder.state.clicks, false);
  recorder.setClicks(true);
  await recorder.stop();
  assert.equal(recorder.state.clicks, false);
});

test("keyboard shortcuts switch on and off during a session and reset after it", async (t) => {
  const recorder = new RecordingController(() => {});
  t.after(() => recorder.dispose());
  recorder.setKeys(true);
  assert.equal(recorder.state.keys, false);
  recorder.start(initialSetup());
  recorder.setKeys(true);
  assert.equal(recorder.state.keys, true);
  recorder.setKeys(false);
  assert.equal(recorder.state.keys, false);
  recorder.setKeys(true);
  await recorder.stop();
  assert.equal(recorder.state.keys, false);
});

test("desktop transparency and system UI have independent validated settings and preserve old setups", () => {
  for (const background of ["desktop", "transparent"] as const) {
    for (const showsSystemUI of [true, false]) {
      assert.equal(isRecordingSetup({ ...initialSetup(), background, showsSystemUI }), true);
      assert.equal(
        upgradeScreenAppearance({ background, showsSystemUI }).showsSystemUI,
        showsSystemUI,
      );
    }
  }
  assert.equal(upgradeScreenAppearance({ background: "transparent" }).showsSystemUI, false);
  assert.equal(upgradeScreenAppearance({ background: "desktop" }).showsSystemUI, true);
  assert.equal(upgradeScreenAppearance({}).showsSystemUI, true);
  assert.equal(isRecordingSetup({ ...initialSetup(), showsSystemUI: "yes" }), false);
});

test("page changes are noted against recorded time, and the countdown's count from the start", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const recorder = new RecordingController(() => {});
  t.after(() => recorder.dispose());
  const notes = ["Intro", "Demo", "Wrap up"].map((title, i) => ({
    id: `page-${i}`,
    title,
    body: "",
  }));
  recorder.start(initialSetup(), { projectId: "project-1", notes, countdown: 3 });
  recorder.setPage(1);
  recorder.setPage(2);
  t.mock.timers.tick(3000);
  assert.equal(recorder.state.page, 2);
  // Recorded time comes from the clock, which isn't mocked.
  recorder.state.elapsed = 7;
  recorder.setPage(0);
  recorder.setPage(5);
  assert.equal(recorder.state.page, 0);
  const take = await recorder.stop();
  assert.deepEqual(take?.target.notes, notes);
  assert.deepEqual(
    take?.pageChanges.map(({ page }) => page),
    [2, 0],
  );
  assert.equal(take?.pageChanges[0].at, 0);
  assert.ok(take!.pageChanges[1].at >= 7);
});

test("a recording without notes has no pages to turn", async (t) => {
  const recorder = new RecordingController(() => {});
  t.after(() => recorder.dispose());
  recorder.start(initialSetup());
  recorder.setPage(1);
  assert.equal(recorder.state.page, 0);
  assert.deepEqual((await recorder.stop())?.pageChanges, []);
});

test("pointer effects are noted as spans of recorded time, and ones still on run to the end", async (t) => {
  const recorder = new RecordingController(() => {});
  t.after(() => recorder.dispose());
  recorder.start(initialSetup());
  // Capture starts once the backend replies.
  await Promise.resolve();
  recorder.setLaser(true);
  recorder.state.elapsed = 2;
  recorder.setLaser(false);
  recorder.setLaser(false);
  recorder.setKeys(true);
  recorder.state.elapsed = 5;
  const take = await recorder.stop();
  // Recorded time comes from the clock, which isn't mocked.
  const rounded = (spans: { start: number; end: number }[] = []) =>
    spans.map(({ start, end }) => [Math.round(start), Math.round(end)]);
  assert.deepEqual(rounded(take?.annotations.laser), [[0, 2]]);
  assert.deepEqual(rounded(take?.annotations.keys), [[2, 5]]);
  assert.deepEqual(take?.annotations.clicks, []);
});

test("pointer effects need the screen recorded", async (t) => {
  const recorder = new RecordingController(() => {});
  t.after(() => recorder.dispose());
  recorder.start({ ...initialSetup(), recordsScreen: false, microphoneIds: ["mic"] });
  await Promise.resolve();
  recorder.setClicks(true);
  assert.equal(recorder.state.clicks, false);
  assert.deepEqual((await recorder.stop())?.annotations, { laser: [], clicks: [], keys: [] });
});

test("a second recording only keeps effects enabled during that recording", async (t) => {
  const recorder = new RecordingController(() => {});
  t.after(() => recorder.dispose());
  recorder.start(initialSetup());
  await Promise.resolve();
  recorder.setLaser(true);
  recorder.setKeys(true);
  recorder.state.elapsed = 2;
  const first = await recorder.stop();
  assert.equal(first?.annotations.laser.length, 1);
  assert.equal(first?.annotations.keys.length, 1);

  recorder.start(initialSetup());
  await Promise.resolve();
  recorder.setClicks(true);
  recorder.state.elapsed = 2;
  const second = await recorder.stop();
  assert.deepEqual(second?.annotations.laser, []);
  assert.deepEqual(second?.annotations.keys, []);
  assert.equal(second?.annotations.clicks.length, 1);
});

/** Records the calls made to it; `start` resolves with a session folder unless `failStart` is set. */
function fakeBackend(options: { failStart?: string; failUpdate?: string } = {}) {
  const calls: string[] = [];
  const backend: CaptureBackend = {
    async prepare() {
      calls.push("prepare");
    },
    async release() {
      calls.push("release");
    },
    async start(_setup, folder) {
      calls.push(`start ${folder}`);
      if (options.failStart) throw new Error(options.failStart);
      return `/recordings/${folder}/session`;
    },
    async pause() {
      calls.push("pause");
    },
    async resume() {
      calls.push("resume");
    },
    async addMark() {
      calls.push("mark");
    },
    async update() {
      calls.push("update");
      if (options.failUpdate) throw new Error(options.failUpdate);
    },
    async stop() {
      calls.push("stop");
    },
    async discard(directory) {
      calls.push(`discard ${directory}`);
    },
  };
  return { backend, calls };
}

test("the backend records each session in order and the take keeps its folder", async (t) => {
  const { backend, calls } = fakeBackend();
  const recorder = new RecordingController(() => {}, backend);
  t.after(() => recorder.dispose());
  recorder.start(initialSetup(), { projectId: "project-1", folder: "Demo" });
  // Acted on before the session has started, then sent in order once it has.
  recorder.pause();
  recorder.resume();
  recorder.addMark();
  await recorder.update({ ...initialSetup(), systemAudio: true });
  const take = await recorder.stop();
  assert.deepEqual(calls, ["start Demo", "pause", "resume", "mark", "update", "stop"]);
  assert.equal(take?.directory, "/recordings/Demo/session");
  assert.equal(take?.used.systemAudio, true);
});

test("the countdown readies the devices before capture starts, and cancelling releases them", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { backend, calls } = fakeBackend();
  const recorder = new RecordingController(() => {}, backend);
  t.after(() => recorder.dispose());
  recorder.start(initialSetup(), { countdown: 2, folder: "Demo" });
  await recorder.update({ ...initialSetup(), systemAudio: true });
  t.mock.timers.tick(2000);
  await recorder.stop();
  assert.deepEqual(calls, ["prepare", "prepare", "start Demo", "stop"]);

  calls.length = 0;
  recorder.start(initialSetup(), { countdown: 2 });
  recorder.cancel();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["prepare", "release"]);
});

test("a quick recording's folder is named for its project", async (t) => {
  const { backend, calls } = fakeBackend();
  const recorder = new RecordingController(() => {}, backend);
  t.after(() => recorder.dispose());
  recorder.start(initialSetup());
  await recorder.stop();
  assert.match(calls[0], /^start Recording /);
});

test("discarding a recording removes its session folder", async (t) => {
  const { backend, calls } = fakeBackend();
  const recorder = new RecordingController(() => {}, backend);
  t.after(() => recorder.dispose());
  recorder.start(initialSetup(), { folder: "Demo" });
  recorder.cancel();
  assert.equal(recorder.state.phase, "idle");
  await recorder.update(initialSetup()).catch(() => {});
  // The discard is queued; wait for it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["start Demo", "stop", "discard /recordings/Demo/session"]);
});

test("a session that can't start ends and reports why", async (t) => {
  const { backend } = fakeBackend({ failStart: "Chord needs microphone access." });
  const failures: [string, unknown][] = [];
  const recorder = new RecordingController(
    () => {},
    backend,
    (message, take) => failures.push([message, take]),
  );
  t.after(() => recorder.dispose());
  recorder.start(initialSetup());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(recorder.state.phase, "idle");
  assert.deepEqual(failures, [["Chord needs microphone access.", null]]);
});

test("a change the backend rejects goes back to the setup it last accepted", async (t) => {
  const { backend } = fakeBackend({ failUpdate: "window 7 is not open" });
  const recorder = new RecordingController(() => {}, backend);
  t.after(() => recorder.dispose());
  const setup = initialSetup();
  recorder.start(setup);
  await assert.rejects(
    () => recorder.update({ ...setup, mode: "display" }),
    /window 7 is not open/,
  );
  assert.equal(recorder.state.target?.setup.mode, "window");
});

test("a session that ends by itself keeps what was recorded", async (t) => {
  const { backend } = fakeBackend();
  const failures: [string, unknown][] = [];
  const recorder = new RecordingController(
    () => {},
    backend,
    (message, take) => failures.push([message, take]),
  );
  t.after(() => recorder.dispose());
  recorder.interrupted("The disk is full.");
  recorder.start(initialSetup(), { folder: "Demo" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  recorder.interrupted("The disk is full.");
  assert.equal(recorder.state.phase, "idle");
  assert.equal(failures.length, 1);
  assert.equal((failures[0][1] as FinishedRecording).directory, "/recordings/Demo/session");
});
