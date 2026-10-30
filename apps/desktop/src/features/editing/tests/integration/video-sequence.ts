// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/editing/tests/integration/video-sequence.ts
import { app, BrowserWindow, protocol } from "electron";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  animationsDone,
  click,
  evaluate as evaluateIn,
  nextFrame,
  reload,
  settle,
  screenshot,
  until,
} from "../../../../../tests/support/integration.ts";

const data = mkdtempSync(join(tmpdir(), "chord-video-sequence-"));
app.setPath("userData", data);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "chord-media",
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
app.on("quit", () =>
  rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
);
const helper = join(data, "helper.cjs");
writeFileSync(
  helper,
  `#!/usr/bin/env node
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  const result = request.method === 'listSources' ? {displays:[],applications:[],windows:[],microphones:[],cameras:[]}
    : ['setScreenPreview','setAudioPreview'].includes(request.method) ? {failures:[]}
    : request.method === 'getPermissions' ? {screen:'granted',microphone:'granted',camera:'granted',accessibility:'granted'} : null;
  process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:request.id, result}) + '\\n');
});
`,
  { mode: 0o755 },
);
process.env.CHORD_RECORDER_HELPER = helper;
process.env.CHORD_RECORDINGS_FOLDER = join(data, "recordings");

/** A recording with optional microphone or system audio, including an audio-only take. */
function session(
  name: string,
  duration: number,
  audioKind?: "microphone" | "systemAudio",
  screen = true,
) {
  const directory = join(process.env.CHORD_RECORDINGS_FOLDER!, "Sequence", name);
  mkdirSync(directory, { recursive: true });
  const tracks = [];
  if (screen) {
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=320x200:rate=10:duration=${duration}`,
      "-pix_fmt",
      "yuv420p",
      join(directory, "screen.mov"),
    ]);
    tracks.push({
      id: "screen-1",
      kind: "screen",
      source: "display:1",
      display: { id: 1, frame: { x: 0, y: 0, width: 320, height: 200 }, scale: 1 },
      segments: [{ file: "screen.mov", start: 0, end: duration }],
    });
  }
  if (audioKind) {
    // The microphone starts late and stays silent until 2.5s on the recording's timeline.
    const start = audioKind === "microphone" ? 0.5 : 0;
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `aevalsrc=sin(2*PI*440*t)*if(lt(t\\,${2.5 - start})\\,0\\,0.6):s=24000:d=${duration - start}`,
      join(directory, "audio.wav"),
    ]);
    tracks.push({
      id: "audio-1",
      kind: audioKind,
      source: "audio",
      segments: [{ file: "audio.wav", start, end: duration }],
    });
  }
  writeFileSync(
    join(directory, "session.json"),
    JSON.stringify({
      version: 1,
      id: name,
      createdAt: new Date().toISOString(),
      hostTimeOrigin: 0,
      config: {},
      pauses: [],
      marks: [],
      stoppedAt: duration,
      tracks,
    }),
  );
  return directory;
}
const first = session("first", 6, "microphone");
const second = session("second", 4, "systemAudio", false);
const third = session("third", 2);

app.whenReady().then(async () => {
  try {
    await import(
      pathToFileURL(resolve(import.meta.dirname, "../../../../../out/main/index.js")).href
    );
    let main!: BrowserWindow;
    await until(
      () =>
        (main = BrowserWindow.getAllWindows().find((win: BrowserWindow) =>
          win.webContents.getURL().includes("surface=main"),
        )!),
      "the main window",
    );
    const evaluate = (expression: string) => evaluateIn(main, expression);
    await until(() => evaluate('!!document.querySelector("[aria-label=Settings]")'), "home");
    const setup = await evaluate("window.chord.desktop.getState().then(state => state.defaults)");
    const now = new Date().toISOString();
    const recording = (
      id: string,
      duration: number,
      directory: string,
      hasMicrophone = false,
      hasSystemAudio = false,
      mode: string | null = "display",
    ) => ({
      id,
      createdAt: now,
      duration,
      mode,
      hasMicrophone,
      hasCamera: false,
      hasSystemAudio,
      markCount: 0,
      pageChanges: [],
      directory,
    });
    const project = {
      id: "sequence",
      name: "Sequence",
      createdAt: now,
      updatedAt: now,
      notes: [],
      setup,
      recordings: [
        recording("one", 6, first, true),
        recording("two", 4, second, false, true, null),
        recording("three", 2, third),
      ],
      // Saved when pieces could be placed anywhere: overlapping, out of order, with a gap.
      pieces: [
        { id: "b", recordingId: "two", offset: 7, start: 0, end: 4 },
        { id: "a", recordingId: "one", offset: 0, start: 0, end: 6 },
      ],
    };
    const saved = () =>
      evaluate(
        `window.chord.desktop.projects.load().then(ps => ps.find(p => p.id === 'sequence').pieces)`,
      );
    const clipIds = () =>
      evaluate(
        `[...document.querySelectorAll('[data-clip]')].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(c => c.dataset.clip)`,
      );
    const close = (actual: number, expected: number) =>
      assert.ok(Math.abs(actual - expected) < 0.05, `${actual} should be near ${expected}`);
    /** Where clip `id` is on screen. */
    const pointIn = (id: string) =>
      evaluate(`(() => {
      const clip = document.querySelector('[data-clip="${id}"]');
      const track = document.querySelector('[data-sequence-track]').getBoundingClientRect();
      const r = clip.getBoundingClientRect();
      return { left: r.left, width: r.width, y: Math.round(r.top + r.height / 2), track: track.left };
    })()`);
    const clickPoint = (x: number, y: number, count = 1) => {
      main.webContents.sendInputEvent({ type: "mouseMove", x, y });
      main.webContents.sendInputEvent({
        type: "mouseDown",
        x,
        y,
        button: "left",
        clickCount: count,
      });
      main.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: count });
    };

    await evaluate(
      `window.chord.desktop.projects.load().then(() => window.chord.desktop.projects.put([${JSON.stringify(project)}]))`,
    );
    await reload(main);
    await until(
      () => evaluate(`!!document.querySelector('[data-projects] > div > button:first-child')`),
      "the project card",
    );
    await click(main, `document.querySelector('[data-projects] > div > button:first-child')`);
    await until(
      () =>
        evaluate(
          `document.querySelectorAll('[data-clip]').length === 2 && !document.querySelector('[aria-label=Play]').disabled`,
        ),
      "the clips",
    );

    // Placed pieces play in the order they did, one after another on one track.
    assert.deepEqual(await clipIds(), ["a", "b"]);
    assert.equal(
      await evaluate(`document.querySelectorAll('[data-sequence-track]').length`),
      1,
      "The video is one track",
    );
    assert.equal(
      await evaluate(
        `!!document.querySelector('[data-layer], [aria-expanded][aria-label^=Expand]')`,
      ),
      false,
      "No recording layers in the video",
    );
    const [a, b] = await Promise.all([pointIn("a"), pointIn("b")]);
    assert.ok(Math.abs(a.left + a.width + 2 - b.left) < 1.5, "Clips sit end to end");

    await until(
      () => evaluate(`document.querySelectorAll('[data-clip] [data-waveform]').length === 2`),
      "microphone and audio-only waveforms",
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[data-clip="a"] [data-waveform]').classList.contains('text-sky-600/50')`,
      ),
      true,
      "Microphone waveform matches the sky clip",
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[data-clip="b"] [data-waveform]').classList.contains('text-violet-600/50')`,
      ),
      true,
      "System waveform matches the violet clip",
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[data-clip="a"] [data-peaks]').getAttribute('d').length > 0`,
      ),
      true,
      "Recorded audio has visible peaks",
    );
    await screenshot(main, "video-waveforms");

    // Pressing a clip selects it before the pointer's up, and cuts nothing.
    main.webContents.sendInputEvent({
      type: "mouseMove",
      x: Math.round(a.left + a.width / 3),
      y: a.y,
    });
    main.webContents.sendInputEvent({
      type: "mouseDown",
      x: Math.round(a.left + a.width / 3),
      y: a.y,
      button: "left",
      clickCount: 1,
    });
    await until(
      () => evaluate(`!!document.querySelector('[data-clip="a"].ring-2')`),
      "the pressed clip selected",
    );
    main.webContents.sendInputEvent({
      type: "mouseUp",
      x: Math.round(a.left + a.width / 3),
      y: a.y,
      button: "left",
      clickCount: 1,
    });
    await settle();
    assert.equal((await saved()).length, 2, "Clicking a clip cuts nothing");
    assert.equal(
      await evaluate(`!!document.querySelector('[data-split], [data-blade]')`),
      false,
      "No split tool",
    );

    // Opening the inspector preserves the scale; fit the clips into the narrower viewport before using coordinates.
    // The inspector opens as the clip is selected, narrowing the viewport, perhaps after a zoom; so zoom out until
    // both fit.
    await until(
      () =>
        evaluate(
          `(() => { const clip = document.querySelector('[data-clip="b"]').getBoundingClientRect(); const viewport = document.querySelector('[data-sequence] > div'); if (clip.right <= viewport.getBoundingClientRect().right) return true; viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 1000, ctrlKey: true, bubbles: true, cancelable: true })); return false; })()`,
        ),
      "both clips in view",
    );

    // A clip's menu splits it at the playhead, but only when the playhead's over it.
    const menuLabels = () =>
      evaluate(
        `document.querySelector('[role=menu]') && [...document.querySelectorAll('[role=menu] [data-menu-label]')].map(label => label.textContent)`,
      );
    const chooseItem = (label: string) =>
      evaluate(
        `[...document.querySelectorAll('[role=menu] [role=menuitem]')].find(item => item.querySelector('[data-menu-label]')?.textContent === ${JSON.stringify(label)}).click()`,
      );
    const dismissMenu = async () => {
      main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      main.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until(() => evaluate(`!document.querySelector('[role=menu]')`), "the menu closed");
    };
    const rightClick = (x: number, y: number) => {
      main.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "right", clickCount: 1 });
      main.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "right", clickCount: 1 });
    };
    const ruler = await evaluate(
      `(() => { const r = document.querySelector('[aria-label="Track position"]').getBoundingClientRect(); return Math.round(r.top + r.height / 2); })()`,
    );
    const [a2, b2] = await Promise.all([pointIn("a"), pointIn("b")]);
    clickPoint(Math.round(a2.track + (a2.width + 2) / 3), ruler);
    await until(
      () =>
        evaluate(
          `Math.abs(document.querySelector('[aria-label="Playback position"]').valueAsNumber - 2) < 0.1`,
        ),
      "the playhead at 2s",
    );
    rightClick(Math.round(b2.left + b2.width / 2), b2.y);
    await until(menuLabels, "the menu of the clip the playhead is not over");
    assert.ok(
      !(await menuLabels()).includes("Split at playhead"),
      "No split away from the playhead",
    );
    assert.equal(
      await evaluate(`!!document.querySelector('[data-clip="b"].ring-2')`),
      true,
      "Right-clicking selects the clip, like Finder",
    );
    await dismissMenu();
    rightClick(Math.round(a2.left + a2.width * 0.8), a2.y);
    await until(
      async () => (await menuLabels())?.includes("Split at playhead"),
      "the menu of the clip under the playhead",
    );
    await chooseItem("Split at playhead");
    await until(async () => (await saved()).length === 3, "the cut to save");
    let pieces = await saved();
    assert.ok(
      pieces.every((piece: { offset?: number }) => piece.offset === undefined),
      "Pieces are saved in order, without positions",
    );
    assert.deepEqual(
      pieces.map(
        (p: { id: string; recordingId: string; start: number; end: number }) => p.recordingId,
      ),
      ["one", "one", "two"],
    );
    close(pieces[0].end, 2);
    close(pieces[1].start, 2);
    await until(
      () => evaluate(`document.querySelectorAll('[data-clip] [data-waveform]').length === 3`),
      "waveforms on both split pieces",
    );
    assert.equal(
      await evaluate(`document.querySelector('[data-clip="a"] [data-peaks]').getAttribute('d')`),
      "",
      "The silent split keeps a flat waveform",
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[data-clip="${pieces[1].id}"] [data-peaks]').getAttribute('d').length > 0`,
      ),
      true,
      "The later split reads its own source audio",
    );

    // Dragging a clip moves it in the order.
    const last = await pointIn("b");
    const start = { x: Math.round(last.left + last.width / 2), y: last.y };
    main.webContents.sendInputEvent({ type: "mouseDown", ...start, button: "left", clickCount: 1 });
    for (const x of [start.x - 10, a.left + 5, a.left + 2] as const)
      main.webContents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(x),
        y: start.y,
        button: "left",
        modifiers: ["leftbuttondown"],
      });
    main.webContents.sendInputEvent({
      type: "mouseUp",
      x: Math.round(a.left + 2),
      y: start.y,
      button: "left",
      clickCount: 1,
    });
    await until(async () => (await saved())[0].id === "b", "the moved clip to save first");
    pieces = await saved();
    assert.equal(pieces.length, 3, "Moving a clip cuts nothing");
    await until(async () => (await clipIds())[0] === "b", "the moved clip shown first");
    // Settled once nothing moves from one drawn frame to the next, however far apart the frames are.
    await animationsDone(main);
    await until(async () => {
      const before = JSON.stringify(await pointIn("a"));
      await nextFrame(main);
      return before === JSON.stringify(await pointIn("a"));
    }, "the clips to settle");

    // Double-clicking edits the recording there, without leaving a cut.
    const target = await pointIn("a");
    clickPoint(Math.round(target.left + target.width / 2), target.y, 1);
    clickPoint(Math.round(target.left + target.width / 2), target.y, 2);
    await until(
      () => evaluate(`!!document.querySelector('[data-back-to-video]')`),
      "the recording on its own",
    );
    assert.equal((await saved()).length, 3, "The double-click leaves no cut");
    await click(main, `document.querySelector('[data-back-to-video]')`);
    await until(
      () => evaluate(`document.querySelectorAll('[data-clip]').length === 3`),
      "back to the video",
    );

    // Trimming a clip moves the one after it with the pointer, without sliding to catch up.
    const [trimmed, next] = await clipIds();
    const before = await pointIn(trimmed);
    const edge = { x: Math.round(before.left + before.width - 2), y: before.y };
    main.webContents.sendInputEvent({ type: "mouseMove", ...edge });
    await until(
      () =>
        evaluate(
          `!!document.querySelector('[data-clip="${trimmed}"] [data-edge=end][data-edge-active]')`,
        ),
      "the hovered end lit",
    );
    assert.equal(
      await evaluate(`document.querySelectorAll('[data-edge-active]').length`),
      1,
      "Only the end that would trim is lit",
    );
    main.webContents.sendInputEvent({ type: "mouseDown", ...edge, button: "left", clickCount: 1 });
    for (const x of [edge.x - 10, edge.x - 30] as const)
      main.webContents.sendInputEvent({
        type: "mouseMove",
        x,
        y: edge.y,
        button: "left",
        modifiers: ["leftbuttondown"],
      });
    await until(async () => (await pointIn(trimmed)).width < before.width - 20, "the trim");
    const [shorter, following] = await Promise.all([pointIn(trimmed), pointIn(next)]);
    assert.ok(
      Math.abs(shorter.left + shorter.width + 2 - following.left) < 1.5,
      "The next clip follows the trim at once",
    );
    main.webContents.sendInputEvent({
      type: "mouseUp",
      x: edge.x - 30,
      y: edge.y,
      button: "left",
      clickCount: 1,
    });
    await until(
      async () =>
        (await saved()).length === 3 &&
        (await saved()).some(
          (p: { id: string; recordingId: string; start: number; end: number }) =>
            p.id === trimmed && p.end - p.start < 4,
        ),
      "the trim to save",
    );

    // Clicking a clip selects it without cutting, and Backspace removes it.
    const pressed = await pointIn(trimmed);
    clickPoint(Math.round(pressed.left + pressed.width / 2), pressed.y);
    await until(
      () => evaluate(`!!document.querySelector('[data-clip="${trimmed}"].ring-2')`),
      "the clip selected",
    );
    assert.equal((await saved()).length, 3, "Selecting a clip cuts nothing");
    main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Backspace" });
    main.webContents.sendInputEvent({ type: "keyUp", keyCode: "Backspace" });
    await until(async () => (await saved()).length === 2, "the selected clip removed");
    assert.ok(
      !(await saved()).some(
        (p: { id: string; recordingId: string; start: number; end: number }) => p.id === trimmed,
      ),
    );

    // Every clip can go, leaving an empty track to add recordings to.
    for (const id of await clipIds()) {
      const at = await pointIn(id);
      rightClick(Math.round(at.left + at.width / 2), at.y);
      await until(
        async () => (await menuLabels())?.includes("Remove from video"),
        `clip ${id} menu`,
      );
      await chooseItem("Remove from video");
      await until(
        async () =>
          !(await saved()).some(
            (p: { id: string; recordingId: string; start: number; end: number }) => p.id === id,
          ),
        `clip ${id} removed from its menu`,
      );
    }
    await until(
      () => evaluate(`!!document.querySelector('[data-sequence-empty]')`),
      "the empty track",
    );
    assert.deepEqual(await saved(), []);
    await click(main, `document.querySelector('[aria-label="Add recording 2 to the video"]')`);
    await until(async () => (await saved()).length === 1, "the added recording");
    assert.equal((await saved())[0].recordingId, "two");

    // A recording dragged from the sidebar goes in where it's dropped.
    await until(
      () => evaluate(`document.querySelectorAll('[data-clip]').length === 1`),
      "the added clip",
    );
    await evaluate(`(() => {
      const transfer = new DataTransfer();
      transfer.setData('application/x-chord-recording', 'one');
      const clip = document.querySelector('[data-clip]').getBoundingClientRect();
      const at = { clientX: clip.left + 2, clientY: clip.top + clip.height / 2, bubbles: true, cancelable: true, dataTransfer: transfer };
      const track = document.querySelector('[data-sequence-track]');
      track.dispatchEvent(new DragEvent('dragover', at));
      track.dispatchEvent(new DragEvent('drop', at));
    })()`);
    await until(async () => (await saved()).length === 2, "the dropped recording");
    assert.deepEqual(
      (await saved()).map(
        (p: { id: string; recordingId: string; start: number; end: number }) => p.recordingId,
      ),
      ["one", "two"],
      "Dropped before the clip it lands on",
    );

    // Recordings without audio keep their plain clip body.
    await click(
      main,
      `[...document.querySelectorAll('[data-track-footer] button')].find(button => button.textContent.includes('Add recording'))`,
    );
    await until(
      () =>
        evaluate(
          `!![...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent.includes('Recording 3'))`,
        ),
      "the recording menu",
    );
    await click(
      main,
      `[...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent.includes('Recording 3'))`,
    );
    await until(
      () => evaluate(`!!document.querySelector('[data-clip][data-recording=three]')`),
      "the screen-only clip",
    );
    assert.equal(
      await evaluate(
        `document.querySelectorAll('[data-clip][data-recording=three] [data-waveform]').length`,
      ),
      0,
      "No waveform without an audio track",
    );

    console.log(
      "PASS: clip-colored waveforms follow split source audio; silent recordings stay plain; presses select, menus split, trims push, drags reorder, double-clicks open and recordings go back in",
    );
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
