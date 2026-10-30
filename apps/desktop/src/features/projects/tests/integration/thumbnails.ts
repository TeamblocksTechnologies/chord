import type { ThumbnailManifest } from "#features/projects/contracts/thumbnails";
// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/projects/tests/integration/thumbnails.ts
import { app, BrowserWindow, nativeImage, protocol } from "electron";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  click,
  evaluate,
  reload,
  screenshot,
  settle,
  until,
} from "../../../../../tests/support/integration.ts";
const data = mkdtempSync(join(tmpdir(), "chord-thumbnails-test-"));
app.setPath("userData", data);
// The app registers this when it starts before Electron is ready; here it's loaded after.
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
const fixture = join(data, "helper.cjs");
writeFileSync(
  fixture,
  `#!/usr/bin/env node
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  const result = request.method === 'listSources' ? {displays:[],applications:[],windows:[],microphones:[],cameras:[]}
    : request.method === 'getPermissions' ? {screen:'granted',microphone:'granted',camera:'granted',accessibility:'granted'}
    : request.method === 'setScreenPreview' || request.method === 'setAudioPreview' ? {failures:[]}
    : null;
  process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:request.id, result}) + '\\n');
});
`,
  { mode: 0o755 },
);
process.env.CHORD_RECORDER_HELPER = fixture;
process.env.CHORD_RECORDINGS_FOLDER = join(data, "recordings");

// Ten seconds of a whole display, with a camera, a microphone and a transcript: a word a second.
const folder = join(data, "recordings", "Thumbnail project");
const session = join(folder, "20261024-120000-abcd");
mkdirSync(session, { recursive: true });
const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "testsrc=size=864x558:rate=30:duration=10",
  "-pix_fmt",
  "yuv420p",
  join(session, "screen-1-001.mov"),
);
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=320x240:rate=30:duration=10",
  "-pix_fmt",
  "yuv420p",
  join(session, "camera-1-001.mp4"),
);
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000:duration=10",
  "-c:a",
  "alac",
  "-movflags",
  "frag_keyframe+empty_moov",
  join(session, "mic-1-001.m4a"),
);
writeFileSync(
  join(session, "session.json"),
  JSON.stringify({
    version: 1,
    id: "20261024-120000-abcd",
    createdAt: "2026-10-24T16:00:00Z",
    hostTimeOrigin: 0,
    config: {},
    pauses: [],
    marks: [],
    stoppedAt: 10,
    stopReason: "requested",
    tracks: [
      {
        id: "screen-1",
        kind: "screen",
        source: "display:1",
        display: { id: 1, frame: { x: 0, y: 0, width: 1728, height: 1116 }, scale: 0.5 },
        segments: [
          {
            file: "screen-1-001.mov",
            start: 0,
            end: 10,
            endReason: "stopped",
            screenMode: { type: "display" },
          },
        ],
      },
      {
        id: "mic-1",
        kind: "microphone",
        source: "mic",
        segments: [{ file: "mic-1-001.m4a", start: 0, end: 10 }],
      },
      {
        id: "camera-1",
        kind: "camera",
        source: "cam",
        segments: [{ file: "camera-1-001.mp4", start: 0, end: 10 }],
      },
    ],
  }),
);
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
writeFileSync(
  join(session, "transcript.json"),
  JSON.stringify({
    version: 1,
    model: "test",
    cues: [
      {
        id: "cue",
        trackId: "mic-1",
        start: 0,
        end: 10,
        text: WORDS.join(" "),
        words: WORDS.map((text: string, i) => ({ text, start: i, end: i + 0.9 })),
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
    );
    main.setSize(1100, 800);
    main.webContents.on("console-message", (event) => {
      if (event.level === "error" || /^Uncaught/.test(event.message))
        console.error("Renderer:", event.message);
    });
    await until(() => evaluate(main, '!!document.querySelector("[aria-label=Settings]")'));
    const now = new Date().toISOString();
    const setup = await evaluate(
      main,
      `window.chord.desktop.getState().then(state => state.defaults)`,
    );
    const thumbnailsFolder = join(folder, "Thumbnails");
    assert.ok(!existsSync(thumbnailsFolder));

    // A new recording in a project renders its thumbnails without being asked.
    await evaluate(
      main,
      `window.chord.desktop.projects.load().then(() => window.chord.desktop.projects.put([{
      id:'thumbs', name:'Thumbnail project', createdAt:'${now}', updatedAt:'${now}', notes:[], setup:${JSON.stringify(setup ?? {})},
      captions:{style:'highlight', length:'medium'},
      recordings:[{id:'take', createdAt:'${now}', duration:10, mode:'display', hasMicrophone:true, hasCamera:true,
        hasSystemAudio:false, markCount:0, pageChanges:[], directory:${JSON.stringify(session)},
        annotations:{laser:[], clicks:[], keys:[]}}],
    }]))`,
    );
    const manifestPath = join(thumbnailsFolder, "thumbnails.json");
    await until(
      () => existsSync(manifestPath) && !existsSync(join(thumbnailsFolder, ".lock")),
      "the thumbnails to render",
    );
    const manifest: ThumbnailManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.deepEqual(
      readdirSync(thumbnailsFolder).sort(),
      [
        "10.jpg",
        "20.jpg",
        "30.jpg",
        "40.jpg",
        "50.jpg",
        "60.jpg",
        "70.jpg",
        "80.jpg",
        "90.jpg",
        "thumbnails.json",
      ],
      "Nine frames and the manifest, with no lock or partial files left",
    );
    assert.equal(manifest.duration, 10);
    assert.deepEqual(
      manifest.frames.map((frame) => frame.time),
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => (manifest.duration * t) / 10),
    );
    assert.equal(manifest.captionStyle, "highlight");
    assert.deepEqual(
      manifest.captions.flatMap((line) => line.words.map((word) => word.text)),
      WORDS,
      "The captions are kept apart from the frames",
    );

    // Each frame is the whole display at its own shape, drawn at most 960 by 540; frames differ over time.
    const images = manifest.frames.map((frame) =>
      nativeImage.createFromBuffer(readFileSync(join(thumbnailsFolder, frame.file))),
    );
    assert.deepEqual(images[0].getSize(), { width: 836, height: 540 });
    assert.ok(
      Math.abs(manifest.aspect - 864 / 558) < 0.01,
      `The display's shape (${manifest.aspect})`,
    );
    const bitmaps = images.map((image) => image.resize({ width: 64, height: 41 }).toBitmap());
    const difference = (a: Buffer, b: Buffer) =>
      a.reduce((sum, value: number, i) => sum + Math.abs(value - b[i]), 0) / a.length;
    assert.ok(
      difference(bitmaps[0], bitmaps[8]) > 2,
      "The first and last frames show different moments",
    );
    const brightness =
      bitmaps[0].reduce((sum, value: number) => sum + value, 0) / bitmaps[0].length;
    assert.ok(brightness > 40, `The frame shows the recording (${brightness})`);

    // The grid shows the cover, and the caption at its time. The window doesn't hear of its own changes, so it reloads.
    await reload(main);
    const card = `document.querySelector('[data-projects] > div > button')`;
    await until(
      () =>
        evaluate(
          main,
          `${card}?.querySelector('img')?.complete && ${card}.querySelector('img').naturalWidth > 0`,
        ),
      "the cover to load",
    );
    assert.match(
      await evaluate(main, `${card}.querySelector('img').src`),
      /^chord-media:\/\/thumbnail\/thumbs\/10\.jpg\?v=/,
    );
    const captionInk = `(() => { const canvas = ${card}.querySelector('canvas'); const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let ink = 0; for (let i = 3; i < pixels.length; i += 4) ink += pixels[i] > 0; return ink; })()`;
    await until(async () => (await evaluate(main, captionInk)) > 0, "the cover caption");
    await screenshot(main, "thumbnails-grid");

    // Hovering near the bottom scrubs through the video; the nearest frame shows, with the caption at that moment.
    const rect = await evaluate(
      main,
      `(() => { const r = ${card}.firstElementChild.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
    );
    const move = (x: number, y: number) =>
      main.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(x), y: Math.round(y) });
    const shownFrame = `[...${card}.querySelectorAll('img')].find(img => !img.classList.contains('invisible'))?.src.match(/\\/(\\d+)\\.jpg/)?.[1]`;
    move(rect.x + rect.width / 2, rect.y + rect.height / 3);
    await until(
      () => evaluate(main, `${card}.querySelectorAll('img').length === 9`),
      "the other frames to load on hover",
    );
    assert.equal(
      await evaluate(main, shownFrame),
      "10",
      "Hovering above the scrub zone keeps the cover",
    );
    move(rect.x + rect.width * 0.72, rect.y + rect.height - 6);
    await until(
      async () => (await evaluate(main, shownFrame)) === "70",
      "the frame nearest the pointer",
    );
    assert.equal(
      await evaluate(main, `${card}.querySelector('.tabular-nums').textContent.trim()`),
      "0:07",
    );
    await screenshot(main, "thumbnails-scrub");
    move(rect.x + rect.width * 0.02, rect.y + rect.height - 6);
    await until(
      async () => (await evaluate(main, shownFrame)) === "10",
      "the first frame near the start",
    );
    move(rect.x + rect.width / 2, rect.y - 40);
    await until(
      async () => (await evaluate(main, shownFrame)) === "10",
      "the cover once the pointer leaves",
    );

    // Clicking a highlighted time opens the edited video there, with playback paused.
    const position = () =>
      evaluate(main, `Number(document.querySelector('[aria-label="Playback position"]')?.value)`);
    const back = async () => {
      await click(main, `document.querySelector('[aria-label="Projects"]')`);
      await until(
        () => evaluate(main, `${card}?.querySelector('img')?.complete`),
        "the project card",
      );
    };
    const openAt = async (fraction: number) => {
      const bounds = await evaluate(
        main,
        `(() => { const r = ${card}.firstElementChild.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
      );
      const point = {
        x: Math.round(bounds.x + bounds.width * fraction),
        y: Math.round(bounds.y + bounds.height - 6),
      };
      // An exact zero needs the fractional left edge, which native mouse events round to pixels.
      if (fraction === 0)
        await evaluate(
          main,
          `(() => { const thumbnail = ${card}.firstElementChild; const r = thumbnail.getBoundingClientRect(); thumbnail.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left, clientY: r.bottom - 6 })); })()`,
        );
      else move(point.x, point.y);
      await until(
        () =>
          evaluate(main, `${card}.querySelector('.tabular-nums').textContent.trim() !== '0:10'`),
        "the highlighted time",
      );
      if (fraction === 0) await click(main, `${card}`);
      else {
        main.webContents.sendInputEvent({
          type: "mouseDown",
          ...point,
          button: "left",
          clickCount: 1,
        });
        main.webContents.sendInputEvent({
          type: "mouseUp",
          ...point,
          button: "left",
          clickCount: 1,
        });
      }
      await until(
        () => evaluate(main, `document.querySelector('[aria-label="Play"]')?.disabled === false`),
        "the player",
      );
    };
    await openAt(0.72);
    assert.ok(
      Math.abs((await position()) - 7.2) < 0.05,
      "The playhead opens at the highlighted time",
    );
    assert.equal(
      await evaluate(main, `document.querySelector('[data-video]').getAttribute('aria-pressed')`),
      "true",
      "The project video opens",
    );
    await back();
    await openAt(0);
    assert.equal(await position(), 0, "The start of the scrub zone opens at zero");
    await back();
    move(rect.x + rect.width / 2, rect.y + rect.height / 3);
    await until(
      () => evaluate(main, `${card}.querySelector('.tabular-nums').textContent.trim() === '0:10'`),
      "the card without a highlighted time",
    );
    await click(main, `${card}`);
    await until(
      () => evaluate(main, `document.querySelector('[aria-label="Play"]')?.disabled === false`),
      "the player without a highlighted time",
    );
    assert.equal(await position(), 0, "A regular card click opens at the beginning");
    await back();

    // Rendered again too soon, nothing changes: the manifest is the same file. This gives the library's check, two
    // seconds after a change, time to run. It only holds within the two minute threshold, which a very slow machine
    // could pass by now, so it's only checked within it.
    const renderedAt = manifest.renderedAt;
    await evaluate(
      main,
      `window.chord.desktop.projects.load().then(projects => window.chord.desktop.projects.put([{ ...projects.find(p => p.id === 'thumbs'), captions: { style: 'word', length: 'short' } }]))`,
    );
    await settle(4000);
    if (Date.now() - Date.parse(renderedAt) < 110_000)
      assert.equal(
        JSON.parse(readFileSync(manifestPath, "utf8")).renderedAt,
        renderedAt,
        "Within the threshold, the last render stands",
      );
    else console.log("Skipped the threshold check: the render is older than the threshold now");

    // Deleted from Finder, they render again.
    rmSync(thumbnailsFolder, { recursive: true, force: true });
    await evaluate(
      main,
      `window.chord.desktop.projects.load().then(projects => window.chord.desktop.projects.put([{ ...projects.find(p => p.id === 'thumbs'), updatedAt: new Date().toISOString() }]))`,
    );
    await until(
      () => existsSync(manifestPath) && !existsSync(join(thumbnailsFolder, ".lock")),
      "the thumbnails to render again",
    );
    assert.equal(
      JSON.parse(readFileSync(manifestPath, "utf8")).captionStyle,
      "word",
      "The latest captions are kept",
    );

    console.log("Thumbnail checks passed");
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
