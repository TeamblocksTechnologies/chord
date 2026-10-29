// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/editing/tests/integration/playback-layout.ts
import { app, BrowserWindow, protocol } from "electron";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

const evaluate = (win: BrowserWindow, code: string) => win.webContents.executeJavaScript(code);
async function until(check: () => unknown | Promise<unknown>, label: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

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
    main.webContents.reload();
    await until(
      () =>
        evaluate(main, '!!document.querySelector("[data-projects] > div > button:first-child")'),
      "saved project",
    );
    await evaluate(
      main,
      `document.querySelector('[data-projects] > div > button:first-child').click()`,
    );
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
    await until(
      () =>
        evaluate(
          main,
          `Array.from(document.querySelectorAll('[data-player] video')).filter(v => v.src).every(v => v.readyState >= 2 && !v.seeking)`,
        ),
      "paused frames",
    );
    const preview = await evaluate(
      main,
      `(async () => {
      const canvas = document.querySelector('[data-player] canvas');
      const context = canvas.getContext('2d');
      const signature = (background = false) => {
        const x = background ? Math.floor(canvas.width * 0.75) : 0;
        const pixels = context.getImageData(x, 0, canvas.width - x, canvas.height).data;
        let hash = 0;
        for (let i = 0; i < pixels.length; i++) hash = (hash * 31 + pixels[i]) >>> 0;
        return hash;
      };
      const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const size = width => {
        const field = document.querySelector('[aria-label="Picture size"]');
        field.value = String(width);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const at = document.querySelector('[aria-label="Playback position"]').valueAsNumber;
      // Let late loads and corrective seeks from moving the playhead finish, so only seeks caused by
      // picture sizing are counted, and only on media that was already loaded and paused.
      const videos = () => Array.from(document.querySelectorAll('[data-player] video')).filter(v => v.src);
      const mediaState = () => videos().map(v => v.src + ':' + v.currentTime + ':' + v.seeking + ':' + v.readyState).join('|');
      for (let quiet = 0, last = '', frames = 0; quiet < 30 && frames < 600; frames++) {
        await nextFrame();
        const now = mediaState();
        quiet = now === last && videos().every(v => !v.seeking && v.readyState >= 2) ? quiet + 1 : 0;
        last = now;
      }
      const settled = new WeakSet(videos());
      const seeks = [];
      let stage = 'before the first edit';
      const onSeek = event => settled.has(event.target) && seeks.push(event.target.src.split('/').pop() + ' during ' + stage + ': at ' + event.target.currentTime + ', playhead ' + at + ', ready ' + event.target.readyState);
      document.addEventListener('seeking', onSeek, true);
      const backgrounds = [], layouts = [];
      try {
        await nextFrame();
        await nextFrame();
        const before = signature(true);
        const original = signature();
        // Saving the default layout must preserve the whole composition, including the picture.
        stage = 'the default layout save';
        size(22);
        await nextFrame();
        await nextFrame();
        const firstEditUnchanged = signature() === original;
        for (const width of [12, 40, 18, 30]) {
          stage = 'size ' + width;
          size(width);
          for (let frame = 0; frame < 3; frame++) {
            await nextFrame();
            backgrounds.push(signature(true));
          }
          layouts.push(signature());
        }
        return { seeks, watched: videos().length, firstEditUnchanged, stable: backgrounds.every(hash => hash === before), layouts,
          paused: !!document.querySelector('[aria-label="Play"]'),
          sameTime: document.querySelector('[aria-label="Playback position"]').valueAsNumber === at };
      } finally {
        document.removeEventListener('seeking', onSeek, true);
      }
    })()`,
    );
    assert.ok(preview.watched > 0, "Paused media is loaded while picture sizing is checked");
    assert.deepEqual(preview.seeks, [], "Picture sizing does not seek the paused media");
    assert.ok(
      preview.firstEditUnchanged,
      "Saving the default layout preserves the screen and picture pixels",
    );
    assert.ok(preview.stable, "The paused screen frame stays visible throughout picture sizing");
    assert.equal(new Set(preview.layouts).size, 4, "Each picture size redraws the overlay");
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
