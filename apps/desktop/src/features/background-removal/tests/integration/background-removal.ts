import type { Project } from "#project-document/domain/recording";
// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/background-removal/tests/integration/background-removal.ts
import { app, BrowserWindow, protocol } from "electron";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  truncateSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  click,
  evaluate,
  reload,
  screenshot,
  until,
} from "../../../../../tests/support/integration.ts";
const data = mkdtempSync(join(tmpdir(), "chord-background-ui-"));
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
const helper = join(data, "recorder.cjs");
writeFileSync(
  helper,
  `#!/usr/bin/env node
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
const r=JSON.parse(line); const result=r.method==='listSources'?{displays:[],applications:[],windows:[],microphones:[],cameras:[]}:r.method==='getPermissions'?{screen:'granted',microphone:'granted',camera:'granted',accessibility:'granted'}:null;
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});`,
  { mode: 0o755 },
);
process.env.CHORD_RECORDER_HELPER = helper;
process.env.CHORD_RECORDINGS_FOLDER = join(data, "recordings");
const modelFolder = join(data, "models", "background-removal");
mkdirSync(modelFolder, { recursive: true });
writeFileSync(join(modelFolder, "modnet.onnx"), "");
truncateSync(join(modelFolder, "modnet.onnx"), 25888640);
const session = join(data, "recordings", "Background demo", "manual");
mkdirSync(session, { recursive: true });
const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
for (const name of ["a", "b"] as const)
  ffmpeg(
    "-f",
    "lavfi",
    "-i",
    "color=red:size=320x180:rate=30:duration=2",
    "-vf",
    "drawbox=x=80:y=30:w=160:h=120:color=white:t=fill",
    "-pix_fmt",
    "yuv420p",
    join(session, `camera-${name}.mp4`),
  );
const mask = join(data, "mask.mp4");
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "color=black:size=320x180:rate=30:duration=2",
  "-vf",
  "drawbox=x=80:y=30:w=160:h=120:color=white:t=fill",
  "-pix_fmt",
  "yuv420p",
  mask,
);
writeFileSync(
  join(session, "session.json"),
  JSON.stringify({
    version: 1,
    id: "camera",
    createdAt: "2026-10-21T12:00:00Z",
    hostTimeOrigin: 0,
    config: {},
    pauses: [{ start: 2, end: 3 }],
    marks: [],
    stoppedAt: 5,
    tracks: [
      {
        id: "camera",
        kind: "camera",
        source: "cam",
        segments: [
          { file: "camera-a.mp4", start: 0, end: 2 },
          { file: "camera-b.mp4", start: 3, end: 5 },
        ],
      },
    ],
  }),
);
const automatic = join(data, "recordings", "Automatic", "auto");
cpSync(session, automatic, { recursive: true });
const log = join(data, "worker.log");
const worker = join(data, "background-fixture.cjs");
writeFileSync(
  worker,
  `const {appendFileSync,copyFileSync,readFileSync}=require('node:fs');
process.parentPort.once('message',({data})=>{
appendFileSync(${JSON.stringify(log)},JSON.stringify(data)+'\\n');
const call=readFileSync(${JSON.stringify(log)},'utf8').trim().split('\\n').length;
process.parentPort.postMessage({progress:0.1});
for(const file of data.files) copyFileSync(${JSON.stringify(mask)},file.output);
// The third run is the one the test cancels, so it stays running until then, however slow the machine.
if(call!==3) setTimeout(()=>process.parentPort.postMessage({done:true}),400);
});`,
);
process.env.CHORD_BACKGROUND_WORKER = worker;
const calls = () =>
  existsSync(log)
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
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
    const errors: string[] = [];
    main.webContents.on("console-message", (event) => {
      if (/^Uncaught/.test(event.message)) errors.push(event.message);
    });
    await until(() => evaluate(main, '!!document.querySelector("[aria-label=Settings]")'));
    const api = "window.chord.desktop";
    await evaluate(main, `${api}.projects.load()`);
    const setup = await evaluate(main, `${api}.getState().then(s=>s.defaults)`);
    const now = new Date().toISOString();
    const project = (id: string, directory: string): Project => ({
      id,
      name: id === "auto" ? "Automatic" : "Background demo",
      createdAt: now,
      updatedAt: now,
      notes: [],
      setup,
      recordings: [
        {
          id: "take",
          createdAt: now,
          duration: 4,
          mode: null,
          hasMicrophone: false,
          hasCamera: true,
          hasSystemAudio: false,
          markCount: 0,
          pageChanges: [],
          directory,
          annotations: { laser: [], clicks: [], keys: [] },
        },
      ],
    });
    await evaluate(
      main,
      `${api}.updatePreferences({backgroundModel:'modnet',autoRemoveBackground:true,backgroundReplacement:'color',backgroundColor:'#00ff00'})`,
    );
    await evaluate(main, `${api}.projects.put([${JSON.stringify(project("auto", automatic))}])`);
    await until(
      () =>
        evaluate(
          main,
          `${api}.background.get(${JSON.stringify(automatic)}).then(s=>s.phase==='done')`,
        ),
      "automatic processing before the editor opens",
    );
    assert.equal(calls().length, 1);
    assert.equal(calls()[0].files.length, 2, "All camera segments queued together");
    await evaluate(main, `${api}.updatePreferences({autoRemoveBackground:false})`);
    await evaluate(main, `${api}.projects.put([${JSON.stringify(project("manual", session))}])`);
    await reload(main);
    await until(() =>
      evaluate(
        main,
        `[...document.querySelectorAll('[data-projects] > div > button:first-child')].some(b=>b.textContent.includes('Background demo'))`,
      ),
    );
    await click(
      main,
      `[...document.querySelectorAll('[data-projects] > div > button:first-child')].find(b=>b.textContent.includes('Background demo'))`,
    );
    await click(main, `document.querySelector('[aria-label="Edit recording 1"]')`);
    const panelButton = (text: string) =>
      `[...document.querySelectorAll('[aria-label="Camera background"] button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
    const toggle = `document.querySelector('[aria-label="Camera background"] [role=switch][aria-label="Remove camera background"]')`;
    // The library only starts automatic processing as it saves a project, and it was off by then.
    await until(() => evaluate(main, `!!${panelButton("Process")}`), "the process button");
    assert.equal(
      (await evaluate(main, `${api}.background.get(${JSON.stringify(session)})`)).phase,
      "idle",
      "Automatic processing off leaves the take unprocessed",
    );
    assert.equal(calls().length, 1, "Automatic processing off does not invoke the model");
    await click(main, panelButton("Process"));
    await until(() => evaluate(main, `!!${toggle}`), "manual processing result");
    assert.equal(calls().length, 2);
    const pixel = (x: number, y: number): Promise<number[]> =>
      evaluate(
        main,
        `(()=>{const c=document.querySelector('[data-player] canvas');return Array.from(c.getContext('2d').getImageData(Math.floor(c.width*${x}),Math.floor(c.height*${y}),1,1).data).slice(0,3);})()`,
      );
    const green = (p: number[]) => p[1] > 200 && p[0] < 30 && p[2] < 30;
    const red = (p: number[]) => p[0] > 200 && p[1] < 30 && p[2] < 30;
    await until(async () => green(await pixel(0.15, 0.5)), "color replacement in paused preview");
    await until(async () => (await pixel(0.5, 0.5)).every((v) => v > 220), "foreground white");
    const subject = await pixel(0.5, 0.5);
    assert.ok(
      subject.every((v) => v > 220),
      `Foreground remains opaque (${subject})`,
    );
    await screenshot(main, "background-editor");
    const originalMasks = await evaluate(
      main,
      `${api}.background.get(${JSON.stringify(session)}).then(s=>s.result.masks)`,
    );
    // Processing again is in the camera inspector's actions menu.
    const action = (text: string) =>
      `[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
    await click(main, `document.querySelector('[data-inspector] [aria-label="Camera actions"]')`);
    await click(main, `${action("Process background again")}`);
    await until(() => evaluate(main, `!!${panelButton("Cancel")}`), "reprocessing to start");
    await until(() => calls().length === 3, "reprocessing worker to start");
    await click(main, `${panelButton("Cancel")}`);
    await until(
      () =>
        evaluate(
          main,
          `${api}.background.get(${JSON.stringify(session)}).then(s=>s.phase==='done')`,
        ),
      "cancel preserves completed result",
    );
    assert.deepEqual(
      await evaluate(
        main,
        `${api}.background.get(${JSON.stringify(session)}).then(s=>s.result.masks)`,
      ),
      originalMasks,
    );

    await click(main, `${toggle}`);
    await until(async () => red(await pixel(0.15, 0.5)), "original camera restored");
    await click(main, `${toggle}`);
    await until(async () => green(await pixel(0.15, 0.5)), "background enabled again");
    // Change color without re-running the model.
    await click(
      main,
      `document.querySelector('[aria-label="Camera background"] [aria-label="Background color"]')`,
    );
    await until(
      () => evaluate(main, `!!document.querySelector('[aria-label="Hex color"]')`),
      "the color picker",
    );
    await evaluate(
      main,
      `(()=>{const field=document.querySelector('[aria-label="Hex color"]');field.value='0000ff';field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));})()`,
    );
    await evaluate(
      main,
      `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`,
    );
    const blue = (p: number[]) => p[2] > 200 && p[0] < 30 && p[1] < 30;
    await until(async () => blue(await pixel(0.15, 0.5)), "new per-take color");
    await until(
      () =>
        evaluate(
          main,
          `${api}.background.get(${JSON.stringify(session)}).then(s=>s.result.settings.color.startsWith('#0000ff'))`,
        ),
      "the saved color",
    );
    assert.equal(calls().length, 3, "Color change reuses masks");
    assert.match(
      JSON.parse(readFileSync(join(session, "background.json"), "utf8")).settings.color,
      /^#0000ff/,
    );
    const replacement = (text: string) =>
      `[...document.querySelectorAll('[aria-label="Camera background"] [role=radiogroup][aria-label="Background replacement"] [role=radio]')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
    await click(main, `${replacement("Blur")}`);
    await until(() => evaluate(main, `!!document.querySelector('[aria-label="Blur amount"]')`));
    await evaluate(
      main,
      `(()=>{const slider=document.querySelector('[aria-label="Blur amount"]');slider.value='80';slider.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await until(async () => red(await pixel(0.15, 0.5)), "blur uses original camera background");
    assert.ok(
      (await pixel(0.5, 0.5)).every((v) => v > 220),
      "Blur keeps foreground sharp",
    );
    await click(main, `${replacement("Color")}`);
    await until(async () => blue(await pixel(0.15, 0.5)), "color restored without reprocessing");

    // Bulk processing leaves completed masks and their saved treatment intact.
    const batch = join(data, "recordings", "Background demo", "batch");
    cpSync(session, batch, { recursive: true });
    rmSync(join(batch, "background.json"), { force: true });
    const batchProject = project("manual", session);
    batchProject.recordings.push({ ...batchProject.recordings[0], id: "batch", directory: batch });
    await evaluate(main, `${api}.projects.put([${JSON.stringify(batchProject)}])`);
    await reload(main);
    await until(() =>
      evaluate(
        main,
        `[...document.querySelectorAll('[data-projects] > div > button:first-child')].some(b=>b.textContent.includes('Background demo'))`,
      ),
    );
    await click(
      main,
      `[...document.querySelectorAll('[data-projects] > div > button:first-child')].find(b=>b.textContent.includes('Background demo'))`,
    );
    await until(() =>
      evaluate(main, `!!document.querySelector('[aria-label="Edit recording 2"]')`),
    );
    await click(main, `document.querySelector('[aria-label="Recording actions"]')`);
    const processAll = `[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.trim()==='Remove 1 camera background')`;
    await click(main, `${processAll}`);
    await until(
      () =>
        evaluate(main, `${api}.background.get(${JSON.stringify(batch)}).then(s=>s.phase==='done')`),
      "bulk background processing",
    );
    assert.equal(calls().length, 4, "Only the new camera recording is processed");
    const preserved = await evaluate(main, `${api}.background.get(${JSON.stringify(session)})`);
    assert.deepEqual(preserved.result.masks, originalMasks);
    assert.match(preserved.result.settings.color, /^#0000ff/);
    // A cut/move preserves the exact source-file mask lookup after the pause.
    const edited = project("manual", session);
    edited.pieces = [
      { id: "later", recordingId: "take", start: 2.5, end: 4, offset: 0 },
      { id: "first", recordingId: "take", start: 0.5, end: 2, offset: 1.5 },
    ];
    await evaluate(main, `${api}.projects.put([${JSON.stringify(edited)}])`);
    await reload(main);
    await until(() =>
      evaluate(
        main,
        `[...document.querySelectorAll('[data-projects] > div > button:first-child')].some(b=>b.textContent.includes('Background demo'))`,
      ),
    );
    await click(
      main,
      `[...document.querySelectorAll('[data-projects] > div > button:first-child')].find(b=>b.textContent.includes('Background demo'))`,
    );
    await until(
      async () => blue(await pixel(0.15, 0.5)),
      "persisted background after cut, move and reload",
    );
    const exportButton = `[...document.querySelectorAll('header button')].find(b=>b.textContent.trim()==='Export')`;
    await click(main, `${exportButton}`);
    await until(() =>
      evaluate(main, `!!document.querySelector('dialog [aria-label="Resolution"]')`),
    );
    await click(
      main,
      `[...document.querySelectorAll('dialog [aria-label="Resolution"] [role=radio]')].find(b=>b.textContent.trim()==='720p')`,
    );
    await click(
      main,
      `[...document.querySelectorAll('dialog button')].find(b=>b.textContent.trim()==='Export')`,
    );
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('dialog h2')?.textContent.trim()==='Video exported'`,
        ),
      "background-removed export",
    );
    const folder = join(data, "recordings", "Background demo", "Exports");
    const video = readdirSync(folder).find((file: string) => file.endsWith(".mp4"));
    assert.ok(video);
    for (const time of [0.5, 2] as const) {
      const frame = execFileSync("ffmpeg", [
        "-v",
        "error",
        "-ss",
        String(time),
        "-i",
        join(folder, video),
        "-frames:v",
        "1",
        "-vf",
        "scale=320:180",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ]);
      const at = (x: number, y: number) =>
        Array.from(frame.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3));
      assert.ok(blue(at(30, 90)), `Export background is blue at ${time}s (${at(30, 90)})`);
      assert.ok(
        at(160, 90).every((v) => v > 220),
        "Export keeps the foreground",
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS: automatic, manual and safe bulk camera processing, original toggle, saved color changes without inference, masks through cuts/pauses/moves, and matching exported pixels",
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
