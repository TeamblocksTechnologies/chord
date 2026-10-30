// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/editing/tests/integration/annotation-tracks.ts
import { app, BrowserWindow, protocol } from "electron";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  click,
  evaluate as evaluateIn,
  reload,
  until,
} from "../../../../../tests/support/integration.ts";

const data = mkdtempSync(join(tmpdir(), "chord-annotation-tracks-"));
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
const directory = join(process.env.CHORD_RECORDINGS_FOLDER!, "Annotations", "session");
mkdirSync(directory, { recursive: true });
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=320x200:rate=30:duration=2",
  "-pix_fmt",
  "yuv420p",
  join(directory, "screen.mov"),
]);
writeFileSync(
  join(directory, "session.json"),
  JSON.stringify({
    version: 1,
    id: "session",
    createdAt: new Date().toISOString(),
    hostTimeOrigin: 0,
    config: {},
    pauses: [],
    marks: [],
    stoppedAt: 2,
    stopReason: "requested",
    input: "input.jsonl",
    tracks: [
      {
        id: "screen-1",
        kind: "screen",
        source: "display:1",
        display: { id: 1, frame: { x: 0, y: 0, width: 320, height: 200 }, scale: 1 },
        segments: [{ file: "screen.mov", start: 0, end: 2 }],
      },
    ],
  }),
);
writeFileSync(
  join(directory, "input.jsonl"),
  [
    { type: "move", time: 0, x: 100, y: 100 },
    { type: "down", time: 0.5, button: "left", x: 100, y: 100 },
    { type: "up", time: 0.6, button: "left", x: 100, y: 100 },
    { type: "key", time: 1, key: 8, modifiers: ["command"], duration: 0.2 },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n") + "\n",
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
      "the main window",
    );
    const evaluate = (expression: string) => evaluateIn(main, expression);
    await until(() => evaluate('!!document.querySelector("[aria-label=Settings]")'), "home");
    const setup = await evaluate("window.chord.desktop.getState().then(state => state.defaults)");
    const now = new Date().toISOString();
    const project = {
      id: "annotations",
      name: "Annotations",
      createdAt: now,
      updatedAt: now,
      notes: [],
      setup,
      // Old project-wide manual additions must migrate without applying to future takes.
      annotationTracks: ["keys"],
      recordings: [
        {
          id: "first",
          createdAt: now,
          duration: 2,
          mode: "display",
          hasMicrophone: false,
          hasCamera: false,
          hasSystemAudio: false,
          markCount: 0,
          pageChanges: [],
          directory,
          annotations: { laser: [{ start: 0, end: 2 }], clicks: [], keys: [] },
        },
      ],
    };
    await evaluate(
      `window.chord.desktop.projects.load().then(() => window.chord.desktop.projects.put([${JSON.stringify(project)}]))`,
    );
    // Opens a recording on its own, where its effect tracks are edited.
    const reopen = async (number: number) => {
      await reload(main);
      await until(
        () => evaluate(`!!document.querySelector('[data-projects] > div > button:first-child')`),
        "the project card",
      );
      await click(main, `document.querySelector('[data-projects] > div > button:first-child')`);
      await until(
        () => evaluate(`!!document.querySelector('[aria-label="Edit recording ${number}"]')`),
        "the recordings list",
      );
      await click(main, `document.querySelector('[aria-label="Edit recording ${number}"]')`);
      await until(
        () =>
          evaluate(
            `!!document.querySelector('[data-effect]') && !document.querySelector('[aria-label=Play]').disabled`,
          ),
        `recording ${number}'s effect tracks`,
      );
    };
    const effects = () =>
      evaluate(`Array.from(document.querySelectorAll('[data-effect]'), row => row.dataset.effect)`);
    await reopen(1);
    assert.deepEqual((await effects()).sort(), ["keys", "laser"]);
    await until(
      () =>
        evaluate(`window.chord.desktop.projects.load().then(ps => {
      const p = ps.find(p => p.id === 'annotations');
      return !p.annotationTracks && p.recordings[0].annotationTracks.includes('keys');
    })`),
      "legacy layers saved per recording",
    );

    await evaluate(`window.chord.desktop.projects.load().then(ps => {
      const p = ps.find(p => p.id === 'annotations');
      p.recordings.push({...p.recordings[0], id:'second', annotationTracks:[],
        annotations:{laser:[], clicks:[{start:0,end:2}], keys:[]}});
      return window.chord.desktop.projects.put([p]);
    })`);
    await reopen(2);
    assert.deepEqual(
      await effects(),
      ["clicks"],
      "The new take shows only the effect enabled during that recording",
    );
    const addTrack = `[...document.querySelectorAll('[data-track-footer] button')].find(b => b.textContent.trim() === 'Add track')`;
    await click(main, `${addTrack}`);
    const laserItem = `[...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent.trim() === 'Laser pointer')`;
    await until(
      () => evaluate(`!!${laserItem} && !${laserItem}.disabled`),
      "the laser pointer in Add track",
    );
    await click(main, `${laserItem}`);
    await until(
      () => evaluate(`document.querySelectorAll('[data-effect=laser]').length === 1`),
      "adding the missing laser layer",
    );
    assert.equal(
      await evaluate(`document.querySelectorAll('[data-effect=keys]').length`),
      0,
      "Adding a laser does not add shortcuts",
    );
    await reopen(2);
    assert.deepEqual(
      (await effects()).sort(),
      ["clicks", "laser"],
      "Manual additions persist with their recording",
    );
    await reopen(1);
    assert.deepEqual(
      (await effects()).sort(),
      ["keys", "laser"],
      "Another recording's additions leave this one alone",
    );

    // Dragging a span's end resizes it.
    const edge = await evaluate(`(() => {
      const handle = document.querySelector('[data-effect=laser] [data-span] [data-edge=end]');
      handle.scrollIntoView({block:'center'});
      const r = handle.getBoundingClientRect();
      return {x:Math.round(r.left + r.width / 2), y:Math.round(r.top + r.height / 2)};
    })()`);
    main.webContents.sendInputEvent({
      type: "mouseDown",
      x: edge.x,
      y: edge.y,
      button: "left",
      clickCount: 1,
    });
    main.webContents.sendInputEvent({
      type: "mouseMove",
      x: edge.x - 30,
      y: edge.y,
      button: "left",
      modifiers: ["leftbuttondown"],
    });
    await until(
      () =>
        evaluate(
          `document.querySelector('[data-effect=laser] [data-span]').getBoundingClientRect().right < ${edge.x - 10}`,
        ),
      "resizing the effect span",
    );
    main.webContents.sendInputEvent({
      type: "mouseUp",
      x: edge.x - 30,
      y: edge.y,
      button: "left",
      clickCount: 1,
    });
    await until(
      () =>
        evaluate(
          `window.chord.desktop.projects.load().then(ps => ps.find(p => p.id === 'annotations').recordings[0].annotations.laser[0].end < 1.95)`,
        ),
      "the resized effect to save",
    );
    console.log(
      "PASS: annotation tracks follow each recording, legacy manual additions migrate, unused effects stay hidden on new takes, missing tracks can be added and reopened, and effect spans resize",
    );
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
