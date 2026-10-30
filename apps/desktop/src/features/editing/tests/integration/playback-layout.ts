// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/editing/tests/integration/playback-layout.ts
import { app, BrowserWindow, protocol } from "electron";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { click, evaluate, reload, until } from "../../../../../tests/support/integration.ts";

const data = mkdtempSync(join(tmpdir(), "chord-playback-layout-test-"));
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
const directory = join(
  process.env.CHORD_RECORDINGS_FOLDER!,
  "Layout project",
  "20261020-120000-abcd",
);
mkdirSync(directory, { recursive: true });
for (const [file, source] of [
  ["screen.mov", "testsrc=size=640x360:rate=30:duration=3"],
  ["camera.mp4", "color=c=green:size=160x120:rate=30:duration=3"],
] as const)
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    source,
    "-pix_fmt",
    "yuv420p",
    join(directory, file),
  ]);
writeFileSync(
  join(directory, "session.json"),
  JSON.stringify({
    version: 1,
    id: "20261020-120000-abcd",
    createdAt: "2026-10-20T16:00:00Z",
    hostTimeOrigin: 0,
    config: {},
    pauses: [],
    marks: [],
    stoppedAt: 3,
    stopReason: "requested",
    tracks: [
      {
        id: "screen-1",
        kind: "screen",
        source: "display:1",
        display: { id: 1, frame: { x: 0, y: 0, width: 640, height: 360 }, scale: 1 },
        segments: [{ file: "screen.mov", start: 0, end: 3, screenMode: { type: "display" } }],
      },
      {
        id: "camera-1",
        kind: "camera",
        source: "cam",
        segments: [{ file: "camera.mp4", start: 0, end: 3 }],
      },
    ],
  }),
);

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
      "main window",
    );
    await until(() => evaluate(main, '!!document.querySelector("[aria-label=Settings]")'), "home");
    await evaluate(
      main,
      `window.chord.desktop.projects.load().then(() => window.chord.desktop.projects.put([{
      id:'layout', name:'Layout project', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), notes:[], setup:{},
      recordings:[{id:'take', createdAt:new Date().toISOString(), duration:3, mode:'display', hasMicrophone:false, hasCamera:true,
        hasSystemAudio:false, markCount:0, pageChanges:[], directory:${JSON.stringify(directory)}}],
      pieces:[{id:'clip', recordingId:'take', start:0, end:null, cameraLayout:{position:'top-left', width:0.22}}]
    }]))`,
    );
    await reload(main);
    await until(
      () =>
        evaluate(main, '!!document.querySelector("[data-projects] > div > button:first-child")'),
      "saved project",
    );
    await click(main, `document.querySelector('[data-projects] > div > button:first-child')`);
    await until(
      () =>
        evaluate(
          main,
          `!!document.querySelector('[aria-label="Play"]') && !document.querySelector('[aria-label="Play"]').disabled`,
        ),
      "loaded player",
    );
    const point = await evaluate(
      main,
      `(() => {
      const clip = document.querySelector('[data-clip="clip"]').getBoundingClientRect();
      return {x:Math.round(clip.left + clip.width / 2), y:Math.round(clip.top + clip.height / 2)};
    })()`,
    );
    main.focus();
    // Right-clicking a clip selects it; its menu closes without an action.
    main.webContents.sendInputEvent({
      type: "mouseDown",
      ...point,
      button: "right",
      clickCount: 1,
    });
    main.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "right", clickCount: 1 });
    await until(() => evaluate(main, `!!document.querySelector('[role=menu]')`), "clip menu");
    main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    main.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await until(
      () => evaluate(main, `!!document.querySelector('[aria-label="Picture size"]')`),
      "clip inspector",
    );
    assert.equal(
      await evaluate(
        main,
        `document.querySelector('[aria-label="Playback position"]').valueAsNumber`,
      ),
      0,
      "Selecting a recording clip opens its inspector without moving the playhead",
    );
    await evaluate(
      main,
      `(() => {
      const field = document.querySelector('[aria-label="Playback position"]');
      field.value = '0.75';
      field.dispatchEvent(new Event('input', {bubbles:true}));
      field.dispatchEvent(new Event('change', {bubbles:true}));
    })()`,
    );
    // Both files start with the recording, so each shows the frame at the playhead once it's drawn there.
    await until(
      () =>
        evaluate(
          main,
          `Array.from(document.querySelectorAll('[data-player] video')).filter(v => v.src).every(v => v.readyState >= 2 && !v.seeking && Math.abs(v.currentTime - 0.75) < 0.02)`,
        ),
      "paused frames at the playhead",
    );
    // Pixels are compared by what they show, not exactly: decoded video and canvas readback can differ by a bit from
    // one draw to the next. That saving the old placement's own size keeps the clip's layout is a unit test of
    // the layout (clipLayout.test.ts).
    const preview = await evaluate(
      main,
      `(async () => {
      const canvas = document.querySelector('[data-player] canvas');
      const context = canvas.getContext('2d');
      // The camera is solid green, in the top-left corner: its picture's width, along a row through every size.
      const pictureWidth = () => {
        const y = Math.floor(canvas.height * 0.1);
        const row = context.getImageData(0, y, canvas.width, 1).data;
        const green = x => row[x * 4 + 1] > 90 && row[x * 4] < 60 && row[x * 4 + 2] < 60;
        let x = 0;
        while (x < canvas.width * 0.1 && !green(x)) x++;
        let width = 0;
        while (x + width < canvas.width && green(x + width)) width++;
        return width;
      };
      // The screen shows a test pattern, so where it's showing the right side of the canvas isn't flat.
      const screenShown = () => {
        const x = Math.floor(canvas.width * 0.75);
        const pixels = context.getImageData(x, 0, canvas.width - x, canvas.height).data;
        let sum = 0, squares = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const light = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
          sum += light;
          squares += light * light;
        }
        const n = pixels.length / 4;
        return Math.sqrt(squares / n - (sum / n) ** 2) > 20;
      };
      const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const size = width => {
        const field = document.querySelector('[aria-label="Picture size"]');
        field.value = String(width);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const at = document.querySelector('[aria-label="Playback position"]').valueAsNumber;
      // Only media loaded and paused at the playhead is watched. Picture sizing mustn't move it or load it again.
      // The browser can shift a paused video's reported time by part of a frame, which the player puts back on
      // its next draw; a seek back to where it was isn't counted.
      const videos = () => Array.from(document.querySelectorAll('[data-player] video')).filter(v => v.src);
      const settled = new Map(videos().map(v => [v, v.currentTime]));
      const seeks = [];
      let stage = 'before the first edit';
      const describe = (video, what) => video.src.split('/').pop() + ' ' + what + ' during ' + stage + ', playhead ' + at;
      const onSeek = event => settled.has(event.target) && Math.abs(event.target.currentTime - settled.get(event.target)) > 0.01 &&
        seeks.push(describe(event.target, 'seeked from ' + settled.get(event.target) + ' to ' + event.target.currentTime));
      const onLoad = event => settled.has(event.target) && seeks.push(describe(event.target, 'loaded again'));
      document.addEventListener('seeking', onSeek, true);
      document.addEventListener('emptied', onLoad, true);
      const hidden = [], widths = {};
      try {
        // The paused frame is drawn on a coming frame too; this only gives up if it never is.
        for (let frame = 0; frame < 600 && !(pictureWidth() > 0 && screenShown()); frame++) await nextFrame();
        let width = pictureWidth();
        const before = width;
        // The old placement's own size first, which saves the layout, then sizes either side of it.
        for (const percent of [22, 12, 40, 18, 30]) {
          stage = 'size ' + percent;
          size(percent);
          // Drawn on a coming frame, and the same on the next; frames come however slow the machine is, so this
          // only gives up if it never is.
          for (let frame = 0, last = -1; frame < 600; frame++) {
            await nextFrame();
            if (!screenShown()) hidden.push(stage);
            const now = pictureWidth();
            if (now > 0 && now === last && (percent === 22 || now !== width)) break;
            last = now;
          }
          widths[percent] = width = pictureWidth();
        }
        return { seeks, watched: videos().length, before, widths, hidden,
          paused: !!document.querySelector('[aria-label="Play"]'),
          sameTime: document.querySelector('[aria-label="Playback position"]').valueAsNumber === at };
      } finally {
        document.removeEventListener('seeking', onSeek, true);
        document.removeEventListener('emptied', onLoad, true);
      }
    })()`,
    );
    assert.ok(preview.watched > 0, "Paused media is loaded while picture sizing is checked");
    assert.deepEqual(preview.seeks, [], "Picture sizing does not seek the paused media");
    assert.deepEqual(
      preview.hidden,
      [],
      "The paused screen frame stays visible throughout picture sizing",
    );
    const { widths } = preview;
    assert.ok(
      preview.before > 0,
      `The picture is drawn before sizing (${JSON.stringify(preview)})`,
    );
    assert.ok(
      Math.abs(widths[22] - preview.before) <= 2,
      `Saving the old placement's own size keeps the picture (${preview.before} then ${widths[22]})`,
    );
    assert.ok(
      widths[12] < widths[18] &&
        widths[18] < widths[22] &&
        widths[22] < widths[30] &&
        widths[30] < widths[40],
      `Each picture size redraws the picture at that size (${JSON.stringify(widths)})`,
    );
    assert.ok(
      Math.abs(widths[40] / widths[12] - 40 / 12) < 0.4,
      `The picture's width follows its size (${JSON.stringify(widths)})`,
    );
    const piece = (await evaluate(main, "window.chord.desktop.projects.load()"))[0].pieces[0];
    assert.equal(
      piece.layout?.pip.position,
      "top-left",
      "The saved layout keeps the old placement",
    );
    assert.ok(
      preview.paused && preview.sameTime,
      "Picture sizing preserves pause and playback position",
    );
    console.log(
      "PASS: picture sizing redraws the overlay while keeping the paused screen frame and media position",
    );
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
