// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/editing/tests/integration/recording-editor.ts
// Transcript cuts only: add CHORD_TEST_TRANSCRIPT_ONLY=1 to the environment.
import { app, BrowserWindow, protocol } from "electron";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, copyFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  click,
  evaluate,
  nextFrame,
  reload,
  screenshot,
  until,
} from "../../../../../tests/support/integration.ts";
const data = mkdtempSync(join(tmpdir(), "chord-playback-test-"));
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
    : request.method === 'setScreenPreview' || request.method === 'setAudioPreview' ? {failures:[]} : null;
  process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:request.id, result}) + '\\n');
});
`,
  { mode: 0o755 },
);
process.env.CHORD_RECORDER_HELPER = fixture;
const recordings = join(data, "recordings");
process.env.CHORD_RECORDINGS_FOLDER = recordings;

// A session paused once: a whole-display segment, then one following a window, with a camera and microphone.
const session = join(recordings, "Playback project", "20261020-120000-abcd");
mkdirSync(session, { recursive: true });
const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "color=blue:size=864x558:rate=30:duration=2",
  "-pix_fmt",
  "yuv420p",
  join(session, "screen-1-001.mov"),
);
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=864x558:rate=30:duration=2",
  "-pix_fmt",
  "yuv420p",
  join(session, "screen-1-002.mov"),
);
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "color=lime:size=320x240:rate=30:duration=5",
  "-pix_fmt",
  "yuv420p",
  join(session, "camera-1-001.mp4"),
);
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "aevalsrc=sin(2*PI*440*t)*if(lt(t\\,0.8)\\,0.6\\,if(lt(t\\,2.8)\\,0\\,0.15)):s=48000:d=5",
  "-c:a",
  "alac",
  "-movflags",
  "frag_keyframe+empty_moov",
  join(session, "mic-1-001.m4a"),
);
copyFileSync(join(session, "mic-1-001.m4a"), join(session, "mic-2-001.m4a"));
const display = { id: 1, frame: { x: 0, y: 0, width: 1728, height: 1116 }, scale: 0.5 };
writeFileSync(
  join(session, "screen-1-bounds.jsonl"),
  `${JSON.stringify({ time: 3, window: 7, frame: { x: 200, y: 150, width: 900, height: 600 } })}\n`,
);
// The mouse sweeping across, a click, and ⌘C, written as the helper writes them: a key once it's released.
const input = [];
for (let time = 0.2; time < 5; time += 0.05)
  input.push({ type: "move", time: Math.round(time * 1000) / 1000, x: 1600, y: 920 });
input.push(
  { type: "down", time: 1, button: "left", x: 550, y: 400 },
  { type: "up", time: 1.3, button: "left", x: 625, y: 400 },
);
input.push({ type: "key", time: 1.1, key: 8, modifiers: ["command"], duration: 0.2 });
writeFileSync(
  join(session, "input.jsonl"),
  input.map((event) => JSON.stringify(event)).join("\n") + "\n",
);
writeFileSync(
  join(session, "session.json"),
  JSON.stringify({
    version: 1,
    id: "20261020-120000-abcd",
    createdAt: "2026-10-20T16:00:00Z",
    hostTimeOrigin: 0,
    config: {},
    pauses: [{ start: 2.2, end: 3 }],
    marks: [],
    stoppedAt: 5.1,
    stopReason: "requested",
    input: "input.jsonl",
    tracks: [
      {
        id: "screen-1",
        kind: "screen",
        source: "display:1",
        display,
        bounds: "screen-1-bounds.jsonl",
        segments: [
          {
            file: "screen-1-001.mov",
            start: 0.2,
            end: 2.2,
            endReason: "paused",
            screenMode: { type: "display" },
          },
          {
            file: "screen-1-002.mov",
            start: 3,
            end: 5,
            endReason: "stopped",
            screenMode: { type: "focusedWindow" },
          },
        ],
      },
      {
        id: "mic-1",
        kind: "microphone",
        source: "mic",
        segments: [{ file: "mic-1-001.m4a", start: 0.1, end: 5.1 }],
      },
      {
        id: "mic-2",
        kind: "microphone",
        source: "mic2",
        segments: [{ file: "mic-2-001.m4a", start: 0.1, end: 5.1 }],
      },
      {
        id: "camera-1",
        kind: "camera",
        source: "cam",
        segments: [{ file: "camera-1-001.mp4", start: 0.3, end: 5.1 }],
      },
    ],
  }),
);

// A second take led by a camera, with stereo system audio starting slightly later.
const second = join(recordings, "Playback project", "20261020-121000-ef01");
mkdirSync(second, { recursive: true });
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=320x240:rate=30:duration=2",
  "-pix_fmt",
  "yuv420p",
  join(second, "camera-1-001.mp4"),
);
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=660:sample_rate=48000:duration=1.85",
  "-ac",
  "2",
  "-c:a",
  "alac",
  "-movflags",
  "frag_keyframe+empty_moov",
  join(second, "system-1-001.m4a"),
);
writeFileSync(
  join(second, "session.json"),
  JSON.stringify({
    version: 1,
    id: "20261020-121000-ef01",
    createdAt: "2026-10-20T16:10:00Z",
    hostTimeOrigin: 0,
    config: {},
    pauses: [],
    marks: [],
    stoppedAt: 2,
    stopReason: "requested",
    tracks: [
      {
        id: "camera-1",
        kind: "camera",
        source: "cam",
        segments: [{ file: "camera-1-001.mp4", start: 0, end: 2 }],
      },
      {
        id: "system-1",
        kind: "systemAudio",
        source: "system",
        segments: [{ file: "system-1-001.m4a", start: 0.15, end: 2 }],
      },
    ],
  }),
);

writeFileSync(
  join(session, "transcript.json"),
  JSON.stringify({
    version: 1,
    model: "test",
    cues: [
      {
        id: "c1",
        trackId: "mic-1",
        start: 0.3,
        end: 1.8,
        text: "hello um this is",
        words: [
          { start: 0.3, end: 0.6, text: "hello" },
          { start: 0.7, end: 1.0, text: "um" },
          { start: 1.2, end: 1.5, text: "this" },
          { start: 1.6, end: 1.8, text: "is" },
        ],
      },
      {
        id: "c2",
        trackId: "mic-1",
        start: 3.2,
        end: 4.0,
        text: "after pause",
        words: [
          { start: 3.2, end: 3.5, text: "after" },
          { start: 3.6, end: 4.0, text: "pause" },
        ],
      },
    ],
  }),
);

const rendererErrors: string[] = [];
app.on("browser-window-created", (_event, win: BrowserWindow) =>
  win.webContents.on("console-message", (event) => {
    if (/^Uncaught|Error/.test(event.message)) {
      console.error("Renderer:", event.message, event.sourceId, event.lineNumber);
      rendererErrors.push(event.message);
    }
  }),
);
async function clickAt(win: BrowserWindow, selector: string, count = 1) {
  const box = await evaluate(
    win,
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
  );
  for (let i = 1; i <= count; i++) {
    win.webContents.sendInputEvent({
      type: "mouseDown",
      x: Math.round(box.x),
      y: Math.round(box.y),
      button: "left",
      clickCount: i,
    });
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: Math.round(box.x),
      y: Math.round(box.y),
      button: "left",
      clickCount: i,
    });
  }
}
const stored = (win: BrowserWindow) =>
  evaluate(
    win,
    `window.chord.desktop.projects.load().then(list => list.find(p => p.id === 'playback'))`,
  );
/** The open context menu: its commands and notes with whether they can be chosen, and its separators in place. */
async function readContextMenu(main: BrowserWindow) {
  const entries: [string, boolean][] = await main.webContents
    .executeJavaScript(`[...document.querySelector('[role=menu]').children].map(entry =>
    entry.getAttribute('role') === 'separator' ? ['separator', false]
      : entry.matches('[role=menuitem]') ? [entry.querySelector('[data-menu-label]').textContent, !entry.disabled]
      : [entry.textContent.trim(), false])`);
  const choose = async (label: string) => {
    await main.webContents.executeJavaScript(
      `[...document.querySelectorAll('[role=menu] [role=menuitem]')].find(item => item.querySelector('[data-menu-label]')?.textContent === ${JSON.stringify(label)}).click()`,
    );
  };
  const dismiss = async () => {
    main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    main.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await until(
      () => evaluate(main, `!document.querySelector('[role=menu]')`),
      "the menu to close",
    );
  };
  const items = entries.filter(([label]) => label !== "separator");
  return {
    structure: entries.map(([label]) => label),
    items,
    labels: items.map(([label]) => label),
    enabled: (label: string) => items.find(([item]) => item === label)?.[1],
    choose,
    dismiss,
  };
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
    );
    main.setSize(1400, 900);
    await until(() => evaluate(main, '!!document.querySelector("[aria-label=Settings]")'));
    const now = new Date().toISOString();
    const setup = await evaluate(
      main,
      `window.chord.desktop.getState().then(state => state.defaults)`,
    );
    await evaluate(
      main,
      `window.chord.desktop.projects.load().then(() => window.chord.desktop.projects.put([{
      id:'playback', name:'Playback project', createdAt:'${now}', updatedAt:'${now}', notes:[], setup:${JSON.stringify(setup ?? {})},
      recordings:[{id:'take', createdAt:'${now}', duration:4, mode:'display', hasMicrophone:true, hasCamera:true,
        hasSystemAudio:false, markCount:0, pageChanges:[], directory:${JSON.stringify(session)},
        annotations:{laser:[{start:0.5,end:1.8}], clicks:[{start:0,end:2}], keys:[]}},
        {id:'second', createdAt:'${now}', duration:2, mode:null, hasMicrophone:false, hasCamera:true,
        hasSystemAudio:true, markCount:0, pageChanges:[], directory:${JSON.stringify(second)}, annotations:{laser:[],clicks:[],keys:[]}}],
      pieces:[{id:'clip', recordingId:'take', start:0, end:null, offset:0}, {id:'two', recordingId:'second', start:0, end:null, offset:4}],
    }]))`,
    );
    await reload(main);
    await until(() =>
      evaluate(main, '!!document.querySelector("[data-projects] > div > button:first-child")'),
    );
    await evaluate(
      main,
      `(() => {
      window.testAudio = [];
      const Audio = window.Audio;
      window.Audio = function (...args) { const element = new Audio(...args); window.testAudio.push(element); return element; };
    })()`,
    );
    await click(main, `document.querySelector('[data-projects] > div > button:first-child')`);
    const max = () =>
      evaluate(main, `Number(document.querySelector('[aria-label="Playback position"]')?.max)`);
    await until(async () => (await max()) === 6, "the video");
    await until(
      () => evaluate(main, `!document.querySelector('[aria-label=Play]').disabled`),
      "the player to load",
    );
    assert.equal(
      await evaluate(main, `document.querySelector('[data-video]').getAttribute('aria-pressed')`),
      "true",
    );
    assert.equal(await evaluate(main, `document.querySelectorAll('[data-clip]').length`), 2);
    assert.equal(
      await evaluate(main, `document.querySelectorAll('[data-layer]').length`),
      0,
      "The video shows clips, not their recordings' tracks",
    );
    assert.equal(await evaluate(main, `!!document.querySelector('[data-inspector]')`), false);
    await screenshot(main, "1-video");

    // Right-clicking a clip selects it and opens its menu.
    const clip = await evaluate(
      main,
      `(() => { const r = document.querySelector('[data-clip="clip"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
    );
    main.webContents.sendInputEvent({ type: "mouseDown", ...clip, button: "right", clickCount: 1 });
    main.webContents.sendInputEvent({ type: "mouseUp", ...clip, button: "right", clickCount: 1 });
    await until(
      () => evaluate(main, `!!document.querySelector('[role=menu] [role=menuitem]')`),
      "the clip menu",
    );
    const clipMenu = await readContextMenu(main);
    assert.deepEqual(clipMenu.structure.slice(0, 3), [
      "Edit recording",
      "separator",
      "Remove from video",
    ]);
    await clipMenu.dismiss();
    assert.equal(
      await evaluate(main, `!!document.querySelector('[data-inspector]')`),
      true,
      "Right-clicking selects the clip, like Finder",
    );
    main.webContents.sendInputEvent({ type: "mouseDown", ...clip, button: "left", clickCount: 1 });
    main.webContents.sendInputEvent({ type: "mouseUp", ...clip, button: "left", clickCount: 1 });
    await until(
      () => evaluate(main, `!!document.querySelector('[data-inspector]')`),
      "the clip inspector",
    );
    await screenshot(main, "2-clip");

    // Open the recording on its own.
    await click(main, `document.querySelector('[aria-label="Edit recording 1"]')`);
    await until(async () => (await max()) === 4, "the recording on its own");
    await until(
      () => evaluate(main, `!!document.querySelector('[data-transcript-word]')`),
      "the transcript",
    );
    assert.equal(
      await evaluate(main, `document.querySelectorAll('[data-effect]').length`),
      2,
      "Effects edit with the recording",
    );
    assert.equal(
      await evaluate(main, `!!document.querySelector('[data-clip]')`),
      false,
      "No clips in a recording on its own",
    );
    assert.equal(
      await evaluate(main, `!!document.querySelector('[data-inspector] [role=tablist]')`),
      false,
      "The recording inspector has no tabs",
    );
    assert.equal(
      await evaluate(
        main,
        `document.querySelector('[data-inspector] [data-panel-title]').textContent`,
      ),
      "Microphone",
      "The inspector names what it shows",
    );
    assert.match(
      await evaluate(
        main,
        `document.querySelector('[data-inspector] [data-panel-detail]').textContent`,
      ),
      /^mic-1-001\./,
      "and the file it plays",
    );
    assert.equal(
      await evaluate(
        main,
        `document.querySelector('[data-layer-label=microphone]').getAttribute('aria-pressed')`,
      ),
      "true",
    );
    let savedLayerIds!: string[], duplicateId: string, duplicateStart!: number;
    if (!process.env.CHORD_TEST_TRANSCRIPT_ONLY) {
      await click(main, `document.querySelector('[data-layer-label=screen]')`);
      await until(
        () =>
          evaluate(
            main,
            `document.querySelector('[data-inspector] [data-panel-title]')?.textContent === 'Screen'`,
          ),
        "screen inspector from its track",
      );
      await clickAt(main, "[data-layer=camera]");
      await until(
        () =>
          evaluate(
            main,
            `!!document.querySelector('[data-inspector] [aria-label="Camera background"]')`,
          ),
        "camera settings from its media track",
      );
      await click(main, `document.querySelector('[data-layer-label=microphone]')`);
      await until(
        () => evaluate(main, `!!document.querySelector('[data-transcript-word]')`),
        "transcript from the microphone track",
      );
      const setInput = async (label: string, value: number, event = "input") => {
        await until(
          () => evaluate(main, `!!document.querySelector('[aria-label="${label}"]')`),
          label,
        );
        await evaluate(
          main,
          `(() => { const input = document.querySelector('[aria-label="${label}"]'); input.value = ${value}; input.dispatchEvent(new Event('${event}', { bubbles: true })); })()`,
        );
      };
      // Span timing is edited by dragging an edge on the timeline.
      const dragSpanEdge = async (span: string, edge: string, dx: number) => {
        const from = await evaluate(
          main,
          `(() => { const handle = document.querySelector(${JSON.stringify(`${span} [data-edge=${edge}]`)}); handle.scrollIntoView({block:'center', inline:'nearest'}); const r = handle.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
        );
        main.webContents.sendInputEvent({
          type: "mouseDown",
          ...from,
          button: "left",
          clickCount: 1,
        });
        for (let i = 1; i <= 8; i++) {
          main.webContents.sendInputEvent({
            type: "mouseMove",
            x: from.x + Math.round((dx * i) / 8),
            y: from.y,
            button: "left",
            modifiers: ["leftbuttondown"],
          });
          await nextFrame(main);
        }
        main.webContents.sendInputEvent({
          type: "mouseUp",
          x: from.x + dx,
          y: from.y,
          button: "left",
          clickCount: 1,
        });
      };
      await setInput("Microphone volume", 45);
      await until(
        async () => (await stored(main)).recordings[0].audio?.["microphone:0"]?.volume === 0.45,
        "the microphone level to save",
      );
      await until(
        () =>
          evaluate(
            main,
            `window.testAudio.some(a => a.dataset.url?.includes('mic-1-001') && Math.abs(a.volume - 0.45) < 0.01)`,
          ),
        "microphone preview volume",
      );
      await click(
        main,
        `document.querySelector('[data-layer-label=microphone][data-layer-index="1"]')`,
      );
      await until(
        () => evaluate(main, `!!document.querySelector('[aria-label="Microphone 2 volume"]')`),
        "the second microphone controls",
      );
      await setInput("Microphone 2 volume", 80);
      await click(main, `document.querySelector('[aria-label="Mute microphone 2"]')`);
      await until(
        () =>
          evaluate(
            main,
            `window.testAudio.some(a => a.dataset.url?.includes('mic-2-001') && a.volume === 0) && window.testAudio.some(a => a.dataset.url?.includes('mic-1-001') && Math.abs(a.volume - 0.45) < 0.01)`,
          ),
        "muting only the second microphone",
      );
      await click(main, `document.querySelector('[aria-label="Mute microphone 2"]')`);
      await until(
        () =>
          evaluate(
            main,
            `window.testAudio.some(a => a.dataset.url?.includes('mic-2-001') && Math.abs(a.volume - 0.8) < 0.01)`,
          ),
        "restoring the second microphone level",
      );

      // Every annotation label and span opens that annotation's own controls.
      for (const [kind, label] of [
        ["laser", "Laser pointer"],
        ["clicks", "Click highlights"],
      ] as const) {
        await click(main, `document.querySelector('[data-effect-label=${kind}]')`);
        await until(
          () =>
            evaluate(
              main,
              `!!document.querySelector('[data-inspector] [aria-label="${label} controls"]')`,
            ),
          `the ${label} controls`,
        );
        assert.equal(
          await evaluate(
            main,
            `document.querySelector('[data-effect-label=${kind}]').getAttribute('aria-pressed')`,
          ),
          "true",
        );
      }
      await clickAt(main, "[data-effect=laser] [data-span]");
      await until(
        () =>
          evaluate(
            main,
            `document.querySelector('[data-effect=laser] [data-span] > div').classList.contains('ring-1')`,
          ),
        "the laser span to be selected",
      );
      // A selected span can be removed from the inspector's actions.
      await click(
        main,
        `document.querySelector('[data-inspector] [aria-label="Laser pointer actions"]')`,
      );
      await until(
        () =>
          evaluate(
            main,
            `[...document.querySelectorAll('[role=menu] [role=menuitem]')].some(item => item.querySelector('[data-menu-label]')?.textContent === 'Remove span')`,
          ),
        "the selected laser span",
      );
      await (await readContextMenu(main)).dismiss();
      await screenshot(main, "laser-controls");
      assert.deepEqual(
        await evaluate(
          main,
          `[...document.querySelectorAll('[data-track-section-label]')].map(section => section.dataset.trackSectionLabel)`,
        ),
        ["screen", "camera", "microphone"],
      );
      assert.deepEqual(
        await evaluate(
          main,
          `[...document.querySelectorAll('[data-track-section=screen] [data-visual-layer]')].map(row => row.dataset.layer ?? row.dataset.effect)`,
        ),
        ["screen", "laser", "clicks"],
      );
      assert.deepEqual(
        await evaluate(
          main,
          `[...document.querySelectorAll('[data-track-section=microphone] [data-layer]')].map(row => row.dataset.layer)`,
        ),
        ["microphone", "microphone"],
      );

      // Source grouping keeps a fixed camera-over-annotations composition.
      await setInput("Playback position", 0.9);
      await until(
        () =>
          evaluate(
            main,
            `Math.abs(document.querySelector('[data-player] video').currentTime - 0.9) < 0.02 && !document.querySelector('[data-player] video').seeking`,
          ),
        "the layer overlap frame",
      );
      const bubbleColors = () =>
        evaluate(
          main,
          `(() => {
        const canvas = document.querySelector('[data-player] canvas');
        const ctx = canvas.getContext('2d');
        const region = ctx.getImageData(Math.round(canvas.width * 0.8), Math.round(canvas.height * 0.73), Math.round(canvas.width * 0.12), Math.round(canvas.height * 0.18)).data;
        let red = 0, green = 0, blue = 0;
        for (let i = 0; i < region.length; i += 4) { if (region[i] > 140 && region[i+1] < 100 && region[i+2] < 100) red++; if (region[i+1] > 180 && region[i] < 70 && region[i+2] < 70) green++; if (region[i+2] > 180 && region[i] < 70 && region[i+1] < 70) blue++; }
        return { red, green, blue };
      })()`,
        );
      await until(
        async () => (await bubbleColors()).green > 100,
        "the camera over the blue screen",
      );
      assert.equal((await bubbleColors()).red, 0, "The camera covers the laser");
      assert.equal(
        await evaluate(main, `document.querySelectorAll('[data-layer-reorder]').length`),
        0,
        "Tracks have no layer reorder controls",
      );
      await click(main, `document.querySelector('[data-effect-label=laser]')`);

      const openTrackMenu = async (selector?: string) => {
        await until(
          () => evaluate(main, `!document.querySelector('[role=menu]')`),
          "the previous menu to close",
        );
        const point = await evaluate(
          main,
          `(() => { const r = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : `document.querySelector('[data-playhead]').parentElement`}.getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.8), y: Math.round(${selector ? "r.top + r.height / 2" : "r.bottom - 12"}) }; })()`,
        );
        main.webContents.sendInputEvent({
          type: "mouseDown",
          ...point,
          button: "right",
          clickCount: 1,
        });
        main.webContents.sendInputEvent({
          type: "mouseUp",
          ...point,
          button: "right",
          clickCount: 1,
        });
        await until(
          () => evaluate(main, `!!document.querySelector('[role=menu] > *')`),
          "the track menu",
        );
        assert.equal(
          await evaluate(main, `!!document.querySelector('[data-tracks] [role=menu]')`),
          false,
          "The context menu is the shared one, not a tracks dropdown",
        );
        return readContextMenu(main);
      };
      // Audio row and label menus address only the clicked source and preserve its saved volume.
      const micMuted = await openTrackMenu(
        '[data-layer=microphone][data-layer-index="1"] [data-file]',
      );
      assert.deepEqual(micMuted.labels, ["Mute", "Show in folder"]);
      await micMuted.choose(micMuted.labels[0]);
      await until(
        async () => (await stored(main)).recordings[0].audio["microphone:1"].muted,
        "muting the clicked microphone",
      );
      assert.deepEqual(
        (await stored(main)).recordings[0].audio["microphone:0"],
        { volume: 0.45, muted: false },
        "The other microphone stays unchanged",
      );
      await until(
        () =>
          evaluate(
            main,
            `window.testAudio.some(a => a.dataset.url?.includes('mic-2-001') && a.volume === 0)`,
          ),
        "context-menu mute in preview",
      );
      const micUnmuted = await openTrackMenu('[data-layer-label=microphone][data-layer-index="1"]');
      assert.deepEqual(micUnmuted.labels, ["Unmute", "Show in folder"]);
      await micUnmuted.choose(micUnmuted.labels[0]);
      await until(
        () =>
          evaluate(
            main,
            `window.testAudio.some(a => a.dataset.url?.includes('mic-2-001') && Math.abs(a.volume - 0.8) < 0.01)`,
          ),
        "restoring the clicked microphone volume",
      );
      assert.equal(
        await evaluate(
          main,
          `document.querySelector('[aria-label="Playback position"]').valueAsNumber`,
        ),
        0.9,
        "Track context actions do not seek",
      );

      // Copies have independent identities, names and span controls.
      const effectMenu = await openTrackMenu("[data-effect-label=laser]");
      assert.deepEqual(effectMenu.structure, [
        "Duplicate track",
        "Enable throughout recording",
        "separator",
        "Remove track",
        "separator",
        "Show in folder",
      ]);
      await effectMenu.choose("Duplicate track");
      await until(
        () => evaluate(main, `!!document.querySelector('[aria-label="Laser pointer 2 controls"]')`),
        "the duplicate layer inspector",
      );
      duplicateId = (await stored(main)).recordings[0].visualLayers.find(
        (layer: { id: string; name?: string }) => layer.name === "Laser pointer 2",
      ).id;
      assert.notEqual(duplicateId, "laser:0");
      await dragSpanEdge(
        `[data-effect=laser][data-effect-layer="${duplicateId}"] [data-span]`,
        "start",
        60,
      );
      await until(
        async () =>
          (await stored(main)).recordings[0].visualLayers.find(
            (layer: { id: string; name?: string }) => layer.id === duplicateId,
          ).spans[0].start > 0.6,
        "independent copy timing",
      );
      assert.equal(
        (await stored(main)).recordings[0].visualLayers.find(
          (layer: { id: string; name?: string }) => layer.id === "laser:0",
        ).spans[0].start,
        0.5,
        "The original span is unchanged",
      );
      duplicateStart = (await stored(main)).recordings[0].visualLayers.find(
        (layer: { id: string; name?: string }) => layer.id === duplicateId,
      ).spans[0].start;
      assert.equal(
        await evaluate(main, `document.querySelectorAll('[data-effect=laser]').length`),
        2,
      );
      await screenshot(main, "source-sections");

      savedLayerIds = (await stored(main)).recordings[0].visualLayers
        .map((layer: { id: string; name?: string }) => layer.id)
        .sort();

      const dismissed = await openTrackMenu();
      assert.deepEqual(
        dismissed.labels,
        ["Shortcuts", "Cursor"],
        "Only missing tracks are offered",
      );
      await dismissed.dismiss();
      assert.equal(
        await evaluate(main, `!!document.querySelector('[data-effect=keys]')`),
        false,
        "Dismissing adds no track",
      );

      const openAddMenu = async (context: boolean) => {
        if (context) {
          const native = await openTrackMenu();
          assert.deepEqual(native.items, [
            ["Shortcuts", true],
            ["Cursor", true],
          ]);
          await native.choose(native.labels[0]);
        } else {
          await click(
            main,
            `[...document.querySelectorAll('[data-track-footer] button')].find(b => b.textContent.includes('Add track'))`,
          );
          await until(
            () => evaluate(main, `!!document.querySelector('[data-tracks] [role=menu]')`),
            "the add-track button menu",
          );
          assert.deepEqual(
            await evaluate(
              main,
              `[...document.querySelectorAll('[data-tracks] [role=menuitem]')].map(b => b.textContent.trim())`,
            ),
            ["Shortcuts", "Cursor"],
            "Only missing tracks are offered",
          );
          await screenshot(main, "button-add-track");
          await click(main, `document.querySelector('[data-tracks] [role=menuitem]')`);
        }
        await until(
          () =>
            evaluate(
              main,
              `!!document.querySelector('[data-effect=keys]') && !!document.querySelector('[aria-label="Shortcuts controls"]')`,
            ),
          "adding and selecting Shortcuts",
        );
        assert.equal(
          await evaluate(main, `document.querySelectorAll('[data-effect=keys]').length`),
          1,
          "Adding a track does not duplicate it",
        );
      };
      const removeShortcuts = async (context = false) => {
        if (context) {
          const native = await openTrackMenu("[data-effect=keys]");
          assert.equal(
            native.labels.includes("Remove span"),
            false,
            "The track menu does not target a previous span selection",
          );
          await native.choose("Remove track");
          await until(
            () => evaluate(main, `!document.querySelector('[data-effect=keys]')`),
            "removing the clicked effect track",
          );
          return;
        }
        await click(main, `document.querySelector('[aria-label="Shortcuts actions"]')`);
        await until(
          () =>
            evaluate(
              main,
              `[...document.querySelectorAll('[data-inspector] [role=menuitem]')].some(b => b.textContent === 'Remove track')`,
            ),
          "effect actions",
        );
        await click(
          main,
          `[...document.querySelectorAll('[data-inspector] [role=menuitem]')].find(b => b.textContent === 'Remove track')`,
        );
        await until(
          () => evaluate(main, `!document.querySelector('[data-effect=keys]')`),
          "removing the effect track",
        );
      };
      await openAddMenu(true);
      const complete = await openTrackMenu();
      assert.deepEqual(complete.items, [["Cursor", true]], "An added track leaves the menu");
      await complete.dismiss();
      const enable = await openTrackMenu("[data-effect-label=keys]");
      assert.equal(enable.enabled("Enable throughout recording"), true);
      await enable.choose("Enable throughout recording");
      await until(
        async () => (await stored(main)).recordings[0].annotations.keys[0]?.end === 4,
        "enabling Shortcuts throughout",
      );
      const enabled = await openTrackMenu("[data-effect=keys]");
      assert.equal(
        enabled.enabled("Enable throughout recording"),
        false,
        "Already enabled throughout",
      );
      await enabled.dismiss();
      await dragSpanEdge("[data-effect=keys] [data-span]", "end", -80);
      await until(
        async () => (await stored(main)).recordings[0].annotations.keys[0]?.end < 3.8,
        "editing Shortcuts timing",
      );
      const removeSpan = await openTrackMenu("[data-effect=keys] [data-span]");
      assert.equal(removeSpan.enabled("Remove span"), true);
      await removeSpan.choose("Remove span");
      await until(
        async () => (await stored(main)).recordings[0].annotations.keys.length === 0,
        "removing the span",
      );
      assert.equal(
        await evaluate(main, `!!document.querySelector('[data-effect=keys]')`),
        true,
        "Removing the last span keeps its editable track",
      );
      await removeShortcuts(true);
      await openAddMenu(false);
      await removeShortcuts();

      await click(main, `document.querySelector('[aria-label="Edit recording 2"]')`);
      await until(
        () => evaluate(main, `!!document.querySelector('[data-layer-label=systemAudio]')`),
        "the system audio track",
      );
      const unavailable = await openTrackMenu();
      assert.deepEqual(
        unavailable.items,
        [
          ["Laser pointer", false],
          ["Click highlights", false],
          ["Shortcuts", false],
          ["Cursor", false],
        ],
        "Effects without screen input stay disabled",
      );
      await unavailable.dismiss();
      await clickAt(main, "[data-layer=systemAudio]");
      await until(
        () => evaluate(main, `!!document.querySelector('[aria-label="System audio volume"]')`),
        "system audio controls from its track",
      );
      await setInput("System audio volume", 30);
      await screenshot(main, "system-audio-controls");
      await until(
        () =>
          evaluate(
            main,
            `window.testAudio.some(a => a.dataset.url?.includes('system-1-001') && Math.abs(a.volume - 0.3) < 0.01)`,
          ),
        "system audio preview level",
      );
      const systemMenu = await openTrackMenu("[data-layer=systemAudio] [data-file]");
      assert.deepEqual(systemMenu.labels, ["Mute", "Show in folder"]);
      await systemMenu.choose(systemMenu.labels[0]);
      await until(
        () =>
          evaluate(
            main,
            `window.testAudio.some(a => a.dataset.url?.includes('system-1-001') && a.volume === 0)`,
          ),
        "system audio mute",
      );
      const systemUnmute = await openTrackMenu("[data-layer-label=systemAudio]");
      assert.deepEqual(systemUnmute.labels, ["Unmute", "Show in folder"]);
      await systemUnmute.choose(systemUnmute.labels[0]);
      await click(main, `document.querySelector('[aria-label="Edit recording 1"]')`);
      await click(main, `document.querySelector('[data-layer-label=microphone]')`);
      await until(
        () => evaluate(main, `!!document.querySelector('[data-transcript-word]')`),
        "returning to the transcript",
      );
      await screenshot(main, "3-recording");
    }

    // Cut "um" from the transcript.
    const um = await evaluate(
      main,
      `[...document.querySelectorAll('[data-transcript-word]')].find(w => w.textContent === 'um').dataset.transcriptWord`,
    );
    await clickAt(main, `[data-transcript-word="${um}"]`);
    await until(
      () => evaluate(main, `!!document.querySelector('[aria-label="Transcript selection"]')`),
      "the selection",
    );
    main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Delete" });
    await until(
      async () => (await stored(main))?.recordings[0].cuts?.length === 1,
      "the cut to be saved on the recording",
    );
    assert.equal(await max(), 4, "The recording keeps its length");
    const saved = await stored(main);
    assert.equal(
      saved.pieces[1].offset,
      undefined,
      "The clip after it follows on, with no position to move",
    );
    assert.equal(
      await evaluate(main, `document.querySelectorAll('[data-cut-edge]').length`),
      2,
      "Both ends of the cut can be dragged",
    );
    await screenshot(main, "4-cut");

    const seekTo = async (time: number) => {
      await evaluate(
        main,
        `(() => { const s = document.querySelector('[aria-label="Playback position"]'); s.value = ${time}; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); })()`,
      );
      await until(
        () =>
          evaluate(
            main,
            `Math.abs(document.querySelector('[data-player] video').currentTime - ${time}) < 0.02 && !document.querySelector('[data-player] video').seeking`,
          ),
        "seeking the media",
      );
    };
    // Plays until the playhead reaches `to`, sampling it each frame, and returns the samples and the forward jumps
    // the media made, which is how the player skips a cut. Frames can be far apart on a slow machine, so whether a
    // cut was skipped is told by the jumps, not by which frames were seen.
    const sample = async (
      to: number,
      { play = true } = {},
    ): Promise<{ times: number[]; jumps: [number, number][] }> => {
      app.focus({ steal: true });
      main.focus();
      await until(() => main.isFocused(), "window focus before playback sampling");
      const sampled = await evaluate(
        main,
        `new Promise(resolve => {
        const times = [], jumps = [];
        const position = () => document.querySelector('[aria-label="Playback position"]').valueAsNumber;
        const last = new Map();
        const media = () => document.querySelectorAll('[data-player] video, [data-player] audio');
        const onSeek = event => {
          const from = last.get(event.target);
          if (from !== undefined && event.target.currentTime - from > 0.15) jumps.push([from, event.target.currentTime]);
        };
        document.addEventListener('seeking', onSeek, true);
        const deadline = performance.now() + 60000;
        if (${play}) document.querySelector('[aria-label=Play]').click();
        function frame(now) {
          for (const element of media()) if (!element.seeking) last.set(element, element.currentTime);
          times.push(position());
          if (times.at(-1) < ${to} && now < deadline) requestAnimationFrame(frame);
          else {
            document.removeEventListener('seeking', onSeek, true);
            document.querySelector('[aria-label=Pause]')?.click();
            resolve({ times, jumps });
          }
        }
        requestAnimationFrame(frame);
      })`,
      );
      assert.ok(sampled.times.at(-1) >= to, `Playback reaches ${to} (${sampled.times.at(-1)})`);
      return sampled;
    };
    const format = ({ times, jumps }: { times: number[]; jumps: [number, number][] }) =>
      `${times.map((t) => t.toFixed(2)).join(" ")}; jumps ${JSON.stringify(jumps)}`;
    // Playing skips the cut (0.5–0.8)...
    await seekTo(0.2);
    let played = await sample(0.9);
    console.log("skipping", format(played));
    assert.ok(!played.times.some((t) => t > 0.56 && t < 0.78), "Playing skips what is cut");
    assert.ok(
      played.jumps.some(([from, to]) => from < 0.56 && to >= 0.78),
      `Playing jumps over the cut (${format(played)})`,
    );
    // ...but the playhead put inside it plays on through it.
    await seekTo(0.55);
    played = await sample(0.85);
    console.log("through", format(played));
    assert.deepEqual(played.jumps, [], "Put inside a cut, playing goes through it");

    const undo = async (check: (cuts: { start: number; end: number }[]) => boolean) => {
      await evaluate(main, `document.querySelector('[data-transcript-text]').focus()`);
      main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Z", modifiers: ["meta"] });
      await until(async () => check((await stored(main)).recordings[0].cuts), "undoing a cut edit");
    };
    const drag = async (from: Electron.Point, to: Electron.Point) => {
      main.webContents.sendInputEvent({
        type: "mouseDown",
        ...from,
        button: "left",
        clickCount: 1,
      });
      for (let i = 1; i <= 12; i++) {
        main.webContents.sendInputEvent({
          type: "mouseMove",
          x: Math.round(from.x + ((to.x - from.x) * i) / 12),
          y: Math.round(from.y + ((to.y - from.y) * i) / 12),
          button: "left",
          modifiers: ["leftbuttondown"],
        });
        await nextFrame(main);
      }
      main.webContents.sendInputEvent({ type: "mouseUp", ...to, button: "left", clickCount: 1 });
    };
    const edgePoint = (edge: string, fraction: number) =>
      evaluate(
        main,
        `(() => { const r = document.querySelector('[data-cut-edge="${edge}"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * ${fraction}) }; })()`,
      );

    // Transcript brackets edit the same cut as the timeline, including positions within a word.
    const transcriptEdge = (edge: string) =>
      `[data-transcript-cut="0"][data-transcript-cut-edge="${edge}"]`;
    assert.equal(
      await evaluate(main, `document.querySelectorAll('[data-transcript-cut-edge]').length`),
      2,
      "The transcript brackets both ends of the cut",
    );
    assert.equal(
      await evaluate(
        main,
        `getComputedStyle(document.querySelector('[data-transcript-word="${um}"]')).textDecorationLine`,
      ),
      "none",
      "Cut words have no strikethrough",
    );
    assert.equal(
      await evaluate(
        main,
        `document.querySelector('[data-transcript-word="${um}"]').classList.contains('cut')`,
      ),
      true,
      "Fully cut words are dimmed",
    );
    const originalCut = (cuts: { start: number; end: number }[]) =>
      Math.abs(cuts?.[0].start - 0.5) < 1e-6 && Math.abs(cuts?.[0].end - 0.8) < 1e-6;
    const undoTranscriptEdit = async () => {
      await undo(originalCut);
      await until(
        () =>
          evaluate(
            main,
            `Math.abs(Number(document.querySelector('${transcriptEdge("start")}')?.getAttribute('aria-valuenow')) - 0.5) < 1e-6 && Math.abs(Number(document.querySelector('${transcriptEdge("end")}')?.getAttribute('aria-valuenow')) - 0.8) < 1e-6`,
          ),
        "the restored brackets",
      );
    };
    for (const [edge, key, expected] of [
      ["end", "Left", 0.7],
      ["start", "Right", 0.6],
    ] as const) {
      await evaluate(main, `document.querySelector('${transcriptEdge(edge)}').focus()`);
      main.webContents.sendInputEvent({ type: "keyDown", keyCode: key });
      await until(
        async () => Math.abs((await stored(main)).recordings[0].cuts[0][edge] - expected) < 1e-6,
        "keyboard adjustment of a transcript bracket",
      );
      assert.equal(
        await evaluate(
          main,
          `document.querySelector('[data-transcript-word="${um}"]').classList.contains('cut')`,
        ),
        false,
        "Partially cut words keep full opacity",
      );
      assert.equal(
        await evaluate(
          main,
          `getComputedStyle(document.querySelector('[data-transcript-word="${um}"]')).color === getComputedStyle(document.querySelector('[data-transcript-word]')).color`,
        ),
        true,
        "Partial words use the normal text color",
      );
      const progress = await evaluate(
        main,
        `Number(document.querySelector('${transcriptEdge(edge)}').style.getPropertyValue('--cut-progress'))`,
      );
      assert.ok(progress > 0 && progress < 1, "The bracket sits inside the partially cut word");
      await screenshot(main, `4-transcript-partial-${edge}`);
      await undoTranscriptEdit();
    }
    for (const [edge, word] of [
      ["end", "this"],
      ["start", "hello"],
    ] as const) {
      const points = await evaluate(
        main,
        `(() => {
        const a = document.querySelector('${transcriptEdge(edge)}').getBoundingClientRect();
        const b = [...document.querySelectorAll('[data-transcript-word]')].find(w => w.textContent === '${word}').getBoundingClientRect();
        return { from: { x: Math.round(a.left + a.width / 2), y: Math.round(a.top + a.height / 2) }, to: { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } };
      })()`,
      );
      await drag(points.from, points.to);
      await until(async () => {
        const cut = (await stored(main)).recordings[0].cuts[0];
        return edge === "end"
          ? cut.end > 1.05 && cut.end < 1.25
          : cut.start > 0.15 && cut.start < 0.35;
      }, "dragging a transcript bracket into another word");
      assert.equal(
        await evaluate(
          main,
          `document.querySelector('${transcriptEdge(edge)}').parentElement.querySelector('[data-transcript-word]').textContent`,
        ),
        word,
        "The bracket follows the pointer into another word",
      );
      assert.equal(await max(), 4, "Transcript bracket edits keep the original recording timeline");
      await screenshot(main, `4-transcript-drag-${edge}`);
      await undoTranscriptEdit();
    }

    // Either bracket can collapse the cut, and a fully cut recording retains its editable markers.
    const bracketKey = async (edge: string, keyCode: string) => {
      await evaluate(main, `document.querySelector('${transcriptEdge(edge)}').focus()`);
      main.webContents.sendInputEvent({ type: "keyDown", keyCode });
    };
    for (const [edge, key] of [
      ["start", "End"],
      ["end", "Home"],
    ] as const) {
      await bracketKey(edge, key);
      await until(
        async () => !(await stored(main)).recordings[0].cuts?.length,
        "collapsing a transcript cut",
      );
      await until(() =>
        evaluate(main, `document.querySelectorAll('[data-transcript-cut-edge]').length === 0`),
      );
      await undoTranscriptEdit();
    }
    await bracketKey("end", "End");
    await until(
      async () => (await stored(main)).recordings[0].cuts[0].end === 4,
      "extending the cut to the recording end",
    );
    await bracketKey("start", "Home");
    await until(
      async () => (await stored(main)).recordings[0].cuts[0].start === 0,
      "cutting the full recording",
    );
    await until(
      () =>
        evaluate(
          main,
          `document.querySelectorAll('[data-transcript-word].cut').length === 6 && document.querySelectorAll('[data-transcript-cut-edge]').length === 2`,
        ),
      "markers remain when no audio is kept",
    );
    await screenshot(main, "4-transcript-fully-cut");
    await bracketKey("end", "Left");
    await until(
      async () => Math.abs((await stored(main)).recordings[0].cuts[0].end - 3.9) < 1e-6,
      "shortening a fully removed recording",
    );
    await undo((cuts) => cuts?.[0].start === 0 && cuts?.[0].end === 4);
    await undo((cuts) => Math.abs(cuts?.[0].start - 0.5) < 1e-6 && cuts?.[0].end === 4);
    await undoTranscriptEdit();

    // The Keep slider previews removal inside each eligible pill without changing saved cuts.
    const openSilences = () =>
      evaluate(
        main,
        `[...document.querySelectorAll('[aria-label="Transcript"] button')].find(b => b.textContent.trim() === 'Remove silences').click()`,
      );
    const setPadding = (value: number) =>
      evaluate(
        main,
        `(() => { const input = document.querySelector('[aria-label="Silence kept at each end"]'); input.value = ${value}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
      );
    const previewPill = `document.querySelector('[data-transcript-silence][data-silence-preview]')`;
    await openSilences();
    await until(() =>
      evaluate(main, `!!document.querySelector('[aria-label="Silence kept at each end"]')`),
    );
    await click(
      main,
      `[...document.querySelectorAll('[aria-label="Silence length"] [role=radio]')].find(b => b.textContent.trim() === '0.5s')`,
    );
    await setPadding(0.05);
    await until(
      () => evaluate(main, `${previewPill}?.textContent === '−0.5s'`),
      "a live preview of removed silence",
    );
    const wider = await evaluate(
      main,
      `Number(${previewPill}.style.getPropertyValue('--remove-to')) - Number(${previewPill}.style.getPropertyValue('--remove-from'))`,
    );
    await setPadding(0.2);
    await until(
      () => evaluate(main, `${previewPill}?.textContent === '−0.2s'`),
      "more padding reduces the previewed removal",
    );
    const narrower = await evaluate(
      main,
      `Number(${previewPill}.style.getPropertyValue('--remove-to')) - Number(${previewPill}.style.getPropertyValue('--remove-from'))`,
    );
    assert.ok(narrower < wider, "The removed portion narrows as Keep increases");
    assert.equal(
      await evaluate(main, `${previewPill}.getAttribute('aria-label')`),
      "0.60s of silence: remove 0.20s, keep 0.40s",
      "The preview measures recorded silence across the pause",
    );
    assert.ok(
      originalCut((await stored(main)).recordings[0].cuts),
      "Previewing does not save an edit",
    );
    await screenshot(main, "4-silence-removal-preview");
    main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    await until(
      () => evaluate(main, `document.querySelectorAll('[data-silence-preview]').length === 0`),
      "closing the menu clears the preview",
    );
    assert.ok(
      originalCut((await stored(main)).recordings[0].cuts),
      "Dismissing the preview keeps the edit",
    );
    await openSilences();
    await until(() => evaluate(main, `${previewPill}?.textContent === '−0.2s'`));
    await click(
      main,
      `[...document.querySelectorAll('div[aria-label="Remove silences"] button')].find(b => b.textContent.trim() === 'Remove 2 silences')`,
    );
    await until(
      async () => (await stored(main)).recordings[0].cuts.length === 3,
      "applying the previewed silence removal",
    );
    const removedSilences = (await stored(main)).recordings[0].cuts.slice(1);
    assert.ok(
      Math.abs(removedSilences[0].end - removedSilences[0].start - 0.2) < 1e-6,
      "The applied internal cut matches its preview",
    );
    assert.ok(
      Math.abs(removedSilences[1].end - removedSilences[1].start - 0.8) < 1e-6,
      "The trailing silence only keeps padding next to speech",
    );
    await until(() =>
      evaluate(main, `document.querySelectorAll('[data-silence-preview]').length === 0`),
    );
    await undoTranscriptEdit();

    if (process.env.CHORD_TEST_TRANSCRIPT_ONLY) {
      assert.deepEqual(rendererErrors, []);
      console.log(
        "PASS: transcript cut lines, dimmed and partial words, pointer and keyboard adjustments, live silence removal previews, shared timeline cuts and undo",
      );
      app.exit(0);
      return;
    }

    // Previewing one cut must resume skipping at the next cut.
    const thisWord = await evaluate(
      main,
      `[...document.querySelectorAll('[data-transcript-word]')].find(w => w.textContent === 'this').dataset.transcriptWord`,
    );
    await clickAt(main, `[data-transcript-word="${thisWord}"]`);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[data-transcript-word="${thisWord}"]').classList.contains('selected')`,
        ),
      "the second selection",
    );
    main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Delete" });
    await until(async () => (await stored(main)).recordings[0].cuts?.length === 2, "a second cut");
    await seekTo(0.55);
    played = await sample(1.4);
    assert.ok(
      !played.jumps.some(([from]) => from < 0.8),
      `The first cut can be previewed (${format(played)})`,
    );
    assert.ok(
      !played.times.some((t) => t > 1.05 && t < 1.28) &&
        played.jumps.some(([from, to]) => from > 0.8 && from < 1.25 && to >= 1.28),
      `The next cut is skipped again (${format(played)})`,
    );

    // A real drag of the ruler playhead into a cut works during playback too.
    await seekTo(0.2);
    await click(main, `document.querySelector('[aria-label=Play]')`);
    const ruler = await evaluate(
      main,
      `(() => {
      const r = document.querySelector('[aria-label="Track position"]').getBoundingClientRect();
      const head = document.querySelector('[data-playhead]').getBoundingClientRect();
      const cut = document.querySelector('[data-cut]').getBoundingClientRect();
      return { from: { x: Math.round(head.left), y: Math.round(r.top + r.height / 2) }, to: { x: Math.round(cut.left + cut.width / 6), y: Math.round(r.top + r.height / 2) } };
    })()`,
    );
    await drag(ruler.from, ruler.to);
    // Still playing from where it was dropped, in the cut.
    played = await sample(0.85, { play: false });
    assert.deepEqual(played.jumps, [], "Dragging into the cut previews it while playing");
    await undo((cuts) => cuts?.length === 1);

    // Handles span all media and effects and work even in the space below them.
    const handleHeight = await evaluate(
      main,
      `document.querySelector('[data-cut-edge]').getBoundingClientRect().height`,
    );
    const layersHeight = await evaluate(
      main,
      `[...document.querySelectorAll('[data-layer], [data-effect]')].reduce((sum, row) => sum + row.getBoundingClientRect().height, 0)`,
    );
    assert.ok(handleHeight >= layersHeight, "Cut handles cover the whole track list");
    for (const [edge, fraction, dx] of [
      ["end", 0.8, 60],
      ["start", 0.15, -35],
    ] as const) {
      const from = await edgePoint(edge, fraction);
      await drag(from, { x: from.x + dx, y: from.y });
      await until(async () => {
        const cut = (await stored(main)).recordings[0].cuts[0];
        return edge === "end" ? cut.end > 0.9 : cut.start < 0.4;
      }, `dragging the cut ${edge}`);
      assert.equal(await max(), 4, "Cut edits keep the full recording duration");
      await undo(
        (cuts) => Math.abs(cuts?.[0].start - 0.5) < 1e-6 && Math.abs(cuts?.[0].end - 0.8) < 1e-6,
      );
    }
    await screenshot(main, "4b-handles");

    // Either edge can meet the other to remove the cut, and removal can be undone.
    for (const edge of ["start", "end"] as const) {
      const from = await edgePoint(edge, 0.5);
      const other = await edgePoint(edge === "start" ? "end" : "start", 0.5);
      await drag(from, { x: other.x, y: from.y });
      await until(
        async () => !(await stored(main)).recordings[0].cuts?.length,
        `removing a cut by its ${edge}`,
      );
      assert.equal(
        await evaluate(main, `document.querySelectorAll('[data-cut-edge]').length`),
        0,
        "An empty cut has no lines",
      );
      await undo((cuts) => cuts?.length === 1);
    }

    // Back to the video: shorter by the cut.
    await click(main, `document.querySelector('[data-video]')`);
    await until(async () => Math.abs((await max()) - 5.7) < 0.02, "the video, shorter by the cut");
    // Play across the cut.
    await click(main, `document.querySelector('[aria-label=Play]')`);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[aria-label="Playback position"]').valueAsNumber > 1.5`,
        ),
      "playback to cross the cut",
    );
    await evaluate(main, `document.querySelector('[aria-label=Pause]')?.click()`);
    await screenshot(main, "5-video-after");

    // Double-click a clip to edit its recording, then undo the cut.
    await clickAt(main, '[data-clip="clip"]', 2);
    await until(
      async () =>
        (await max()) === 4 &&
        (await evaluate(main, `!!document.querySelector('[data-transcript-text]')`)),
      "the recording from a double-click",
    );
    await evaluate(main, `document.querySelector('[data-transcript-text]').focus()`);
    main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Z", modifiers: ["meta"] });
    await until(async () => !(await stored(main))?.recordings[0].cuts, "the cut to be undone");
    assert.equal((await stored(main)).pieces.length, 2, "Double-clicking leaves no cut");

    // Captions settings live in the player's captions menu.
    await click(main, `document.querySelector('[aria-label=Captions]')`);
    await until(
      () =>
        evaluate(
          main,
          `[...document.querySelectorAll('[role=menuitemradio]')].some(b => b.textContent.includes('Highlight'))`,
        ),
      "caption styles",
    );
    await screenshot(main, "6-captions");
    await click(main, `document.querySelector('[aria-label=Captions]')`);
    // Export from the recording view still uses the assembled video and the fixed visual composition.
    await click(
      main,
      `[...document.querySelectorAll('header button')].find(b => b.textContent.trim() === 'Export')`,
    );
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('dialog')?.open && document.querySelector('dialog h2')?.textContent === 'Export video'`,
        ),
      "export settings",
    );
    await click(
      main,
      `[...document.querySelectorAll('dialog [aria-label=Resolution] [role=radio]')].find(b => b.textContent.trim() === '720p')`,
    );
    await click(
      main,
      `[...document.querySelectorAll('dialog [aria-label="Frame rate"] [role=radio]')].find(b => b.textContent.trim() === '24')`,
    );
    await click(
      main,
      `[...document.querySelectorAll('dialog button')].find(b => b.textContent.trim() === 'Export')`,
    );
    await until(
      () => evaluate(main, `document.querySelector('dialog h2')?.textContent === 'Video exported'`),
      "the video export",
    );
    const folder = join(recordings, "Playback project", "Exports");
    const exported = join(
      folder,
      readdirSync(folder).find((name: string) => name.endsWith(".mp4"))!,
    );
    const frame = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-ss",
        "0.9",
        "-i",
        exported,
        "-frames:v",
        "1",
        "-vf",
        "scale=1280:720",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ],
      { maxBuffer: 1 << 24 },
    );
    let redPixels = 0,
      greenPixels = 0;
    for (let y = Math.round(720 * 0.73); y < 720 * 0.91; y++)
      for (let x = Math.round(1280 * 0.8); x < 1280 * 0.94; x++) {
        const i = (y * 1280 + x) * 3;
        if (frame[i] > 140 && frame[i + 1] < 100 && frame[i + 2] < 100) redPixels++;
        if (frame[i + 1] > 180 && frame[i] < 70 && frame[i + 2] < 70) greenPixels++;
      }
    assert.equal(redPixels, 0, "The exported camera covers the laser");
    assert.ok(greenPixels > 100, "The export keeps the camera above the screen");
    await click(
      main,
      `[...document.querySelectorAll('dialog button')].find(b => b.textContent.trim() === 'Done')`,
    );
    await reload(main);
    await click(main, `document.querySelector('[data-projects] > div > button:first-child')`);
    await click(main, `document.querySelector('[aria-label="Edit recording 1"]')`);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('[aria-label="Microphone volume"]')?.value === '45'`,
        ),
      "persisted source levels",
    );
    const reloaded = (await stored(main)).recordings[0];
    assert.deepEqual(
      reloaded.visualLayers.map((layer: { id: string; name?: string }) => layer.id).sort(),
      savedLayerIds,
      "Track identities survive reload",
    );
    assert.equal(
      reloaded.visualLayers.find((layer: { id: string; name?: string }) => layer.id === duplicateId)
        .spans[0].start,
      duplicateStart,
    );
    const audioSettings = (await stored(main)).recordings.map((r: { audio?: unknown }) => r.audio);
    assert.equal(audioSettings[0]["microphone:1"].volume, 0.8);
    assert.equal(audioSettings[1]["systemAudio:0"].volume, 0.3);
    await until(
      () =>
        evaluate(
          main,
          `!document.querySelector('[aria-label=Play]').disabled && document.querySelectorAll('[data-waveform]').length >= 4`,
        ),
      "the reloaded media and waveforms",
    );
    assert.deepEqual(rendererErrors, []);
    console.log("OK");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    app.exit(Number(process.exitCode ?? 0));
  }
});
