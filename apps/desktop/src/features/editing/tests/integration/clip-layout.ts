// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/editing/tests/integration/clip-layout.ts
import { app, BrowserWindow, protocol } from "electron";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const data = mkdtempSync(join(tmpdir(), "chord-clip-layout-test-"));
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
  const result = ['setScreenPreview','setAudioPreview'].includes(request.method) ? {failures:[]} : request.method === 'listSources' ? {displays:[],applications:[],windows:[],microphones:[],cameras:[]}
    : request.method === 'getPermissions' ? {screen:'granted',microphone:'granted',camera:'granted',accessibility:'granted'} : null;
  process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:request.id, result}) + '\\n');
});
`,
  { mode: 0o755 },
);
process.env.CHORD_RECORDER_HELPER = helper;
process.env.CHORD_RECORDINGS_FOLDER = join(data, "recordings");
function recording(name: string, count: number) {
  const directory = join(process.env.CHORD_RECORDINGS_FOLDER!, "Layouts", name);
  mkdirSync(directory, { recursive: true });
  const tracks = [];
  for (let i = 0; i < count; i++) {
    const file = `feed-${i}.mp4`;
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=${["red", "lime", "blue"][i]}:size=320x180:rate=10:duration=2`,
      "-pix_fmt",
      "yuv420p",
      join(directory, file),
    ]);
    tracks.push({
      id: i ? `camera-${i}` : "screen-1",
      kind: i ? "camera" : "screen",
      source: `source-${i}`,
      ...(!i && { display: { id: 1, frame: { x: 0, y: 0, width: 320, height: 180 }, scale: 1 } }),
      segments: [{ file, start: 0, end: 2 }],
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
      tracks,
      stoppedAt: 2,
    }),
  );
  return {
    id: name,
    createdAt: new Date().toISOString(),
    duration: 2,
    mode: "display",
    hasMicrophone: false,
    hasCamera: count > 1,
    hasSystemAudio: false,
    markCount: 0,
    pageChanges: [],
    directory,
    annotations: { laser: [], clicks: [], keys: [] },
  };
}
const recordings = [recording("three", 3), recording("two", 2), recording("one", 1)];
const evaluate = (win: BrowserWindow, code: string) => win.webContents.executeJavaScript(code);
async function until(check: () => unknown | Promise<unknown>, label: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
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
    main.webContents.on("console-message", (event) => {
      if (event.level === "error") console.error("Renderer:", event.message);
    });
    const run = (code: string) => evaluate(main, code);
    await until(() => run('!!document.querySelector("[aria-label=Settings]")'), "home");
    const setup = await run("window.chord.desktop.getState().then(state => state.defaults)");
    const project = {
      id: "layouts",
      name: "Layouts",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      notes: [],
      setup,
      recordings,
      pieces: [
        { id: "a", recordingId: "three", start: 0, end: null },
        { id: "b", recordingId: "three", start: 0, end: null },
        { id: "c", recordingId: "two", start: 0, end: null },
        { id: "d", recordingId: "one", start: 0, end: null },
      ],
    };
    await run(
      `window.chord.desktop.projects.load().then(() => window.chord.desktop.projects.put([${JSON.stringify(project)}]))`,
    );
    async function openProject() {
      main.webContents.reload();
      await until(
        () => run('!!document.querySelector("[data-projects] > div > button:first-child")'),
        "project",
      );
      await run(`document.querySelector('[data-projects] > div > button:first-child').click()`);
      await until(
        () =>
          run(
            `!!document.querySelector('[aria-label="Play"]') && !document.querySelector('[aria-label="Play"]').disabled`,
          ),
        "player",
      );
    }
    const saved = () =>
      run(
        `window.chord.desktop.projects.load().then(ps => ps.find(p => p.id === 'layouts').pieces)`,
      );
    async function selectClip(id: string) {
      await run(
        `document.querySelector('[data-clip="${id}"]').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true,button:2}))`,
      );
      await until(() => run(`!!document.querySelector('[role=menu]')`), "clip menu");
      await run(
        `document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}))`,
      );
      await until(
        () => run(`!!document.querySelector('[aria-label="Layout"]')`),
        "layout inspector",
      );
    }
    // Layouts and their arrangements are radio groups of drawn shapes; feed sources are dropdowns.
    async function pick(group: string, option: string) {
      const radio = `document.querySelector('[data-inspector] [role=radiogroup][aria-label=${JSON.stringify(group)}] [role=radio][aria-label=${JSON.stringify(option)}]')`;
      await until(() => run(`!!${radio}`), `${group}: ${option}`);
      await run(`${radio}.click()`);
      await until(
        () => run(`${radio}?.getAttribute('aria-checked') === 'true'`),
        `${option} chosen`,
      );
    }
    async function choose(label: string, option: string) {
      await run(
        `document.querySelector('[data-inspector] [role=combobox][aria-label=${JSON.stringify(label)}]').click()`,
      );
      await until(
        () =>
          run(
            `[...document.querySelectorAll('[role=option]')].some(o => o.textContent.trim() === ${JSON.stringify(option)})`,
          ),
        option,
      );
      await run(
        `[...document.querySelectorAll('[role=option]')].find(o => o.textContent.trim() === ${JSON.stringify(option)}).click()`,
      );
      await until(() => run(`!document.querySelector('[role=listbox]')`), "selection");
    }
    const slider = (label: string, value: number) =>
      run(
        `(() => { const field = document.querySelector('[data-inspector] input[aria-label=${JSON.stringify(label)}]'); field.value = ${JSON.stringify(String(value))}; field.dispatchEvent(new Event('input', {bubbles:true})); })()`,
      );
    // Fills a feed's cell from its settings popover.
    async function fill(name: string) {
      const trigger = `document.querySelector('[data-inspector] button[aria-label=${JSON.stringify(`${name} settings`)}]')`;
      await run(`${trigger}.click()`);
      const option = `[...document.querySelectorAll('[role=dialog][aria-label=${JSON.stringify(`${name} settings`)}] [role=radiogroup] [role=radio]')].find(b => b.textContent.trim() === 'Fill')`;
      await until(() => run(`!!${option}`), `${name} frame`);
      await run(`${option}.click()`);
      await run(`${trigger}.click()`);
      await until(
        () =>
          run(
            `!document.querySelector('[role=dialog][aria-label=${JSON.stringify(`${name} settings`)}]')`,
          ),
        `${name} settings to close`,
      );
    }
    const twoOnTheLeft = async () => {
      await pick("Clip layout", "Split with another split");
      await pick("Split side", "Left");
    };
    async function seek(time: number) {
      await run(
        `(() => {const field=document.querySelector('[aria-label="Playback position"]'); field.value='${time}'; field.dispatchEvent(new Event('input',{bubbles:true})); field.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
    }
    const pixel = (x: number, y: number) =>
      run(
        `(() => {const c=document.querySelector('[data-player] canvas'); return [...c.getContext('2d').getImageData(Math.floor(c.width*${x}),Math.floor(c.height*${y}),1,1).data].slice(0,3);})()`,
      );
    const color = (rgb: number[]) =>
      rgb[0] > 180 && rgb[1] < 50 && rgb[2] < 50
        ? "red"
        : rgb[1] > 180 && rgb[0] < 50 && rgb[2] < 50
          ? "green"
          : rgb[2] > 180 && rgb[0] < 50 && rgb[1] < 50
            ? "blue"
            : "other";
    async function expectColors(points: [number, number][], expected: string[]) {
      await until(
        async () =>
          JSON.stringify(
            await Promise.all(points.map(async ([x, y]) => color(await pixel(x, y)))),
          ) === JSON.stringify(expected),
        `pixels ${expected}`,
      );
    }
    await openProject();
    await selectClip("a");
    await twoOnTheLeft();
    await slider("Gap", 0);
    await fill("Screen");
    await fill("Camera 1");
    await fill("Camera 2");
    await seek(0.75);
    await expectColors(
      [
        [0.25, 0.25],
        [0.25, 0.75],
        [0.75, 0.5],
      ],
      ["red", "green", "blue"],
    );
    const first = (await saved())[0].layout;
    assert.equal(first.preset, "split-stack");
    assert.equal(first.stack, "start");
    assert.equal((await saved())[1].layout, undefined, "Only selected occurrence changes");
    if (process.env.CHORD_TEST_SCREENSHOTS) {
      mkdirSync(process.env.CHORD_TEST_SCREENSHOTS, { recursive: true });
      writeFileSync(
        join(process.env.CHORD_TEST_SCREENSHOTS, "clip-layout-three.png"),
        (await main.webContents.capturePage()).toPNG(),
      );
    }
    // Each layout is drawn while paused; changing layout must never seek the media.
    await run(
      `window.layoutSeeks=[];document.addEventListener('seeking',e=>window.layoutSeeks.push(e.target.src),true)`,
    );
    for (const [group, option] of [
      ["Clip layout", "Three split"],
      ["Direction", "Rows"],
      ["Clip layout", "Split with another split"],
      ["Direction", "Columns"],
      ["Split side", "Right"],
      ["Clip layout", "Split with picture in picture"],
      ["Clip layout", "Two pictures in picture"],
      ["Placement", "Apart"],
      ["Clip layout", "Split"],
      ["Direction", "Rows"],
    ] as const) {
      await pick(group, option);
    }
    assert.deepEqual(await run("window.layoutSeeks"), []);
    assert.equal(
      await run(`document.querySelector('[aria-label="Playback position"]').valueAsNumber`),
      0.75,
    );
    await pick("Clip layout", "Picture in picture");
    await choose("Feed 1 source", "Camera 2");
    await choose("Feed 2 source", "Screen");
    await fill("Camera 2");
    await expectColors(
      [
        [0.4, 0.5],
        [0.85, 0.82],
      ],
      ["blue", "red"],
    );
    assert.deepEqual((await saved())[0].layout.sources, ["camera-2", "screen-1"]);
    await pick("Clip layout", "Centered");
    await slider("Padding", 10);
    await expectColors([[0.5, 0.5]], ["blue"]);
    await until(
      async () => JSON.stringify(await pixel(0.01, 0.5)) === "[0,0,0]",
      "padding to expose the backdrop",
    );
    // Controls are filtered to the actual recording, including the one-feed case.
    await selectClip("c");
    assert.deepEqual(
      await run(
        `[...document.querySelectorAll('[data-inspector] [aria-label="Clip layout"] [role=radio]')].map(o=>o.getAttribute('aria-label'))`,
      ),
      ["Centered", "Picture in picture", "Split"],
    );
    await selectClip("d");
    assert.equal(await run(`!!document.querySelector('[aria-label="Clip layout"]')`), false);
    await slider("Padding", 12);
    await seek(6.5);
    await expectColors([[0.5, 0.5]], ["red"]);
    // Layouts survive reload, and the second copy keeps its automatic three-feed layout.
    await until(async () => (await saved())[3].layout?.padding === 0.12, "save");
    await openProject();
    await selectClip("a");
    assert.equal((await saved())[0].layout.preset, "single");
    await seek(0.75);
    await expectColors([[0.5, 0.5]], ["blue"]);
    await selectClip("b");
    await twoOnTheLeft();
    await slider("Gap", 0);
    await fill("Screen");
    await fill("Camera 1");
    await fill("Camera 2");
    await seek(2.75);
    await expectColors(
      [
        [0.25, 0.25],
        [0.25, 0.75],
        [0.75, 0.5],
      ],
      ["red", "green", "blue"],
    );
    // Encode the edited video, then compare decoded pixels to the preview's source assignments.
    const exportButton = `[...document.querySelectorAll('header button')].find(b=>b.textContent.trim()==='Export')`;
    await run(`${exportButton}.click()`);
    await until(() => run(`!!document.querySelector('dialog[open]')`), "export dialog");
    for (const [label, option] of [
      ["Resolution", "720p"],
      ["Frame rate", "24"],
    ] as const) {
      await run(
        `[...document.querySelectorAll('dialog [aria-label="${label}"] [role=radio]')].find(b=>b.textContent.trim()==='${option}').click()`,
      );
    }
    await run(
      `[...document.querySelectorAll('dialog button')].find(b=>b.textContent.trim()==='Export').click()`,
    );
    await until(
      () => run(`document.querySelector('dialog h2')?.textContent.trim()==='Video exported'`),
      "encoded export",
    );
    const exports = join(process.env.CHORD_RECORDINGS_FOLDER!, "Layouts", "Exports");
    const file = join(
      exports,
      readdirSync(exports).find((file: string) => file.endsWith(".mp4"))!,
    );
    const frame = (at: number) =>
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-ss",
        String(at),
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        "scale=160:90",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ]);
    const sample = (pixels: Buffer, x: number, y: number) =>
      color([
        ...pixels.subarray(
          (Math.floor(y * 90) * 160 + Math.floor(x * 160)) * 3,
          (Math.floor(y * 90) * 160 + Math.floor(x * 160)) * 3 + 3,
        ),
      ]);
    assert.equal(
      sample(frame(0.75), 0.5, 0.5),
      "blue",
      "Single chosen camera exports with padding",
    );
    const three = frame(2.75);
    assert.deepEqual(
      [
        [0.25, 0.25],
        [0.25, 0.75],
        [0.75, 0.5],
      ].map(([x, y]) => sample(three, x, y)),
      ["red", "green", "blue"],
      "All three sources export in their assigned cells",
    );
    await run(
      `[...document.querySelectorAll('dialog button')].find(b=>b.textContent.trim()==='Done').click()`,
    );
    await run(
      `[...document.querySelectorAll('[data-inspector] button')].find(b=>b.textContent.trim()==='Edit recording').click()`,
    );
    await until(
      () => run(`document.querySelectorAll('[data-layer="camera"]').length===2`),
      "both camera tracks in the recording editor",
    );
    console.log(
      "PASS: one/two/three-feed controls, every layout, source swaps, paused edits, per-clip persistence, encoded export pixels and multiple camera track rows",
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
