// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/editing/tests/integration/clip-background.ts
import { app, BrowserWindow, protocol } from "electron";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const data = mkdtempSync(join(tmpdir(), "chord-clip-background-test-"));
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
const recordings = [{ ...recording("one", 1), backdrop: "gradient" }];
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
    const run = async (code: string) => {
      try {
        return await evaluate(main, code);
      } catch (error) {
        console.error("Failed evaluation:", code);
        throw error;
      }
    };
    await until(() => run('!!document.querySelector("[aria-label=Settings]")'), "home");
    const setup = await run("window.chord.desktop.getState().then(state => state.defaults)");
    const now = new Date().toISOString();
    const project = {
      id: "layouts",
      name: "Layouts",
      createdAt: now,
      updatedAt: now,
      notes: [],
      setup,
      recordings,
      pieces: [
        { id: "a", recordingId: "one", start: 0, end: null },
        { id: "b", recordingId: "one", start: 0.25, end: 1.75 },
      ],
    };
    await run(
      `window.chord.desktop.projects.load().then(() => window.chord.desktop.projects.put([${JSON.stringify(project)}]))`,
    );
    async function open() {
      main.webContents.reload();
      await until(() => run('!!document.querySelector("[data-projects] button")'), "project card");
      // Pixel assertions read the canvas repeatedly. Keep one raster backend instead of letting Chromium switch
      // from GPU to CPU after readbacks, which changes antialiasing even when video time hasn't moved.
      await run(`(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, options) {
          return getContext.call(this, type, type === '2d' ? { ...options, willReadFrequently: true } : options);
        };
      })()`);
      await run('document.querySelector("[data-projects] button").click()');
      await until(
        () =>
          run(
            '!!document.querySelector("[aria-label=Play]") && !document.querySelector("[aria-label=Play]").disabled',
          ),
        "player",
      );
    }
    async function select(id: string) {
      await run(
        `document.querySelector('[data-clip="${id}"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))`,
      );
      await until(() => run('!!document.querySelector("[role=menu]")'), "clip menu");
      await run(
        'document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))',
      );
      await until(
        () => run('!!document.querySelector("[aria-label=Background]")'),
        "background controls",
      );
    }
    async function choose(option: string) {
      await run(`document.querySelector('[aria-label="Clip background"]').click()`);
      await until(
        () =>
          run(
            `[...document.querySelectorAll('[role=option]')].some(o => o.textContent.trim() === ${JSON.stringify(option)})`,
          ),
        option,
      );
      assert.deepEqual(
        await run(`[...document.querySelectorAll('[role=option]')].map(o => o.textContent.trim())`),
        ["Single colour", "Floating blocks"],
      );
      await run(
        `[...document.querySelectorAll('[role=option]')].find(o => o.textContent.trim() === ${JSON.stringify(option)}).click()`,
      );
    }
    const input = async (label: string, value: string | number) => {
      if (label === "Background colour") {
        await run(
          `document.querySelector('[data-inspector] [aria-label="Background colour"]').click()`,
        );
        await until(
          () => run(`!!document.querySelector('[aria-label="Hex color"]')`),
          "color picker",
        );
        await run(
          `(() => { const input = document.querySelector('[aria-label="Hex color"]'); input.value = ${JSON.stringify(String(value))}; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`,
        );
        await run(
          'document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))',
        );
        return;
      }
      await run(
        `(() => { const input = document.querySelector('[data-inspector] [aria-label=${JSON.stringify(label)}]'); input.value = ${JSON.stringify(String(value))}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
      );
    };
    const frames = () =>
      run("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    async function seek(time: number) {
      await run(
        `(() => { const input = document.querySelector('[aria-label="Playback position"]'); input.value = '${time}'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); })()`,
      );
      await until(
        () =>
          run(
            `Math.abs(document.querySelector('[aria-label="Playback position"]').valueAsNumber - ${time}) < 0.001 && [...document.querySelectorAll('video')].every(v => !v.seeking)`,
          ),
        "seek",
      );
      await frames();
    }
    const saved = () =>
      run(
        'window.chord.desktop.projects.load().then(ps => ps.find(p => p.id === "layouts").pieces)',
      );
    const pixel = (x: number, y: number) =>
      run(
        `(() => { const c = document.querySelector('[data-player] canvas'); return [...c.getContext('2d').getImageData(Math.floor(c.width * ${x}), Math.floor(c.height * ${y}), 1, 1).data]; })()`,
      );
    const strip = () =>
      run(`(() => { const c = document.querySelector('[data-player] canvas');
      const pixels = c.getContext('2d').getImageData(0, 0, c.width, Math.max(1, Math.floor(c.height * 0.03))).data;
      let hash = 2166136261, brightest = 0, visible = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] !== pixels[i + 1] || pixels[i] !== pixels[i + 2] || pixels[i + 3] !== 255) throw new Error('Wallpaper must be opaque monochrome: pixel ' + i / 4 + ' of ' + pixels.length / 4 + ' is rgba(' + [...pixels.slice(i, i + 4)] + ') on a ' + c.width + 'x' + c.height + ' canvas');
        brightest = Math.max(brightest, pixels[i]); hash = Math.imul(hash ^ pixels[i], 16777619);
        if (pixels[i] >= 24) visible++;
      }
      return { hash, brightest, visible: visible / (pixels.length / 4), width: c.width, height: c.height,
        time: document.querySelector('[aria-label="Playback position"]').valueAsNumber };
    })()`);
    await open();
    await select("a");
    assert.equal(
      await run(`document.querySelector('[aria-label="Clip background"]').textContent.trim()`),
      "Single colour",
    );
    assert.equal(
      await run(`document.querySelector('[aria-label="Background colour"]').value`),
      "#000000",
    );
    await input("Padding", 12);
    await seek(0.5);
    assert.deepEqual(
      await pixel(0.01, 0.5),
      [0, 0, 0, 255],
      "An unspecified clip background is black even over a recording gradient",
    );
    await choose("Single colour");
    await input("Background colour", "#ffffff");
    await until(
      async () => JSON.stringify(await pixel(0.01, 0.5)) === "[255,255,255,255]",
      "solid colour while paused",
    );
    assert.equal((await saved())[1].layout, undefined, "Only the selected occurrence changes");
    assert.ok((await pixel(0.5, 0.5))[0] > 200, "The video remains visible");
    await choose("Floating blocks");
    await until(async () => {
      const shown = await strip();
      return shown.brightest >= 40 && shown.brightest < 140;
    }, "visible wallpaper");
    const first = await strip();
    assert.ok(
      first.visible > 0.005,
      "The pattern has readable outlines across the exposed background",
    );
    assert.equal((await saved())[0].layout.padding, 0.12, "Existing padding is preserved");
    await frames();
    assert.deepEqual(await strip(), first, "Animation stays still while paused");
    await seek(1.5);
    assert.notEqual((await strip()).hash, first.hash, "Animation follows video time");
    await seek(0.5);
    assert.deepEqual(await strip(), first, "Seeking back reproduces the same wallpaper");
    await select("b");
    await choose("Floating blocks");
    await until(
      async () => (await saved())[1].layout?.padding === 0.06,
      "wallpaper margin on an unpadded clip",
    );
    await seek(2.5);
    assert.ok(
      (await strip()).visible > 0.005,
      "A newly selected wallpaper is exposed without adjusting padding",
    );
    await input("Padding", 12);
    await choose("Single colour");
    await input("Background colour", "#ffffff");
    await seek(2.5);
    await until(async () => (await pixel(0.01, 0.5))[0] === 255, "second occurrence background");
    await until(async () => (await saved())[1].layout?.background?.color === "#ffffff", "save");
    await open();
    // Compare with the same clip selected, as an open inspector narrows the player on small windows.
    await select("a");
    await seek(0.5);
    assert.deepEqual(await strip(), first, "Wallpaper survives reloading");
    await select("a");
    await choose("Single colour");
    await until(
      async () => JSON.stringify(await pixel(0.01, 0.5)) === "[0,0,0,255]",
      "single colour starts at black",
    );
    await choose("Floating blocks");
    await frames();
    if (process.env.CHORD_TEST_SCREENSHOTS) {
      mkdirSync(process.env.CHORD_TEST_SCREENSHOTS, { recursive: true });
      writeFileSync(
        join(process.env.CHORD_TEST_SCREENSHOTS, "clip-background.png"),
        (await main.webContents.capturePage()).toPNG(),
      );
    }

    await run(
      `[...document.querySelectorAll('header button')].find(b => b.textContent.trim() === 'Export').click()`,
    );
    await until(() => run('!!document.querySelector("dialog[open]")'), "export dialog");
    for (const [label, option] of [
      ["Resolution", "720p"],
      ["Frame rate", "24"],
    ] as const) {
      await run(
        `[...document.querySelectorAll('dialog [aria-label="${label}"] [role=radio]')].find(b => b.textContent.trim() === '${option}').click()`,
      );
    }
    await run(
      `[...document.querySelectorAll('dialog button')].find(b => b.textContent.trim() === 'Export').click()`,
    );
    await until(
      () =>
        run(
          `['Video exported', 'Export failed'].includes(document.querySelector('dialog h2')?.textContent.trim())`,
        ),
      "export",
    );
    assert.equal(
      await run(`document.querySelector('dialog h2').textContent.trim()`),
      "Video exported",
    );
    const folder = join(process.env.CHORD_RECORDINGS_FOLDER!, "Layouts", "Exports");
    const file = join(
      folder,
      readdirSync(folder).find((name: string) => name.endsWith(".mp4"))!,
    );
    const exportedStrip = (at: number) =>
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
        "crop=iw:40:0:0",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ]);
    const animated = exportedStrip(0.5);
    const brightest = animated.reduce((max, channel) => Math.max(max, channel), 0);
    assert.ok(brightest >= 40 && brightest < 140, "Export includes the visible monochrome pattern");
    assert.notDeepEqual(exportedStrip(1.5), animated, "Exported wallpaper animates");
    assert.ok(
      exportedStrip(2.5).every((channel) => channel > 245),
      "Second occurrence exports its own solid colour",
    );
    console.log(
      "PASS: per-clip background controls, paused colour changes, deterministic timeline animation, persistence, defaults and encoded backgrounds",
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
