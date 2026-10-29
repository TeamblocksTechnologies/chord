// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/editing/tests/integration/track-context-menu.ts
import { app, BrowserWindow, protocol, shell } from "electron";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

// Electron's default uncaught-error dialog blocks unattended test runs.
process.on("uncaughtException", (error) => {
  console.error("Uncaught main-process error:", error);
  process.exit(1);
});

const data = mkdtempSync(join(tmpdir(), "chord-track-menu-"));
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
const directory = join(process.env.CHORD_RECORDINGS_FOLDER!, "Menus", "session");
mkdirSync(directory, { recursive: true });
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=320x200:rate=10:duration=1",
  "-pix_fmt",
  "yuv420p",
  join(directory, "screen.mov"),
]);
copyFileSync(join(directory, "screen.mov"), join(directory, "later.mov"));
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-y",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:duration=2",
  join(directory, "audio.wav"),
]);
copyFileSync(join(directory, "audio.wav"), join(directory, "second-audio.wav"));
const segment = (file: string) => ({ file, start: 0, end: 2 });
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
    input: "input.jsonl",
    tracks: [
      {
        id: "screen-1",
        kind: "screen",
        source: "display:1",
        display: { id: 1, frame: { x: 0, y: 0, width: 320, height: 200 }, scale: 1 },
        segments: [
          { file: "screen.mov", start: 0, end: 1 },
          { file: "later.mov", start: 1, end: 2 },
        ],
      },
      {
        id: "camera-1",
        kind: "camera",
        source: "camera",
        segments: [{ file: "screen.mov", start: 0, end: 1 }],
      },
      ...["microphone", "microphone", "systemAudio"].map((kind: string, index: number) => ({
        id: `audio-${index}`,
        kind,
        source: `audio-${index}`,
        segments: [segment(index === 1 ? "second-audio.wav" : "audio.wav")],
      })),
    ],
  }),
);
writeFileSync(
  join(directory, "input.jsonl"),
  JSON.stringify({ type: "move", time: 0, x: 100, y: 100 }) + "\n",
);

async function until(check: () => unknown | Promise<unknown>, message: string) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  for (const window of BrowserWindow.getAllWindows()) {
    console.error(
      "Menu timeout diagnostics",
      await window.webContents
        .executeJavaScript(
          `JSON.stringify({
      focused: document.hasFocus(), hidden: document.hidden,
      menus: [...document.querySelectorAll('[role=menu]')].map(m => ({html: m.outerHTML, inert: m.inert, animations: m.getAnimations().map(a => ({state:a.playState,time:a.currentTime}))}))
    })`,
        )
        .catch(() => "window unavailable"),
    );
  }
  throw new Error(`Timed out waiting for ${message}`);
}

// Keep real renderer events and IPC; intercept only Finder and the Trash.
const revealed: string[] = [];
shell.showItemInFolder = (path: string) => revealed.push(path);
const trashed: string[] = [];
shell.trashItem = async (path: string) => {
  trashed.push(path);
};

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
    const evaluate = (expression: string) =>
      main.webContents.executeJavaScript(expression).catch((error) => {
        console.error("Renderer expression failed:", expression);
        throw error;
      });
    await until(() => evaluate('!!document.querySelector("[aria-label=Settings]")'), "home");
    const setup = await evaluate("window.chord.desktop.getState().then(state => state.defaults)");
    const now = new Date().toISOString();
    const project = {
      id: "menus",
      name: "Menus",
      createdAt: now,
      updatedAt: now,
      notes: [],
      setup,
      recordings: [
        {
          id: "take",
          createdAt: now,
          duration: 2,
          mode: "display",
          hasMicrophone: true,
          hasCamera: true,
          hasSystemAudio: true,
          markCount: 0,
          pageChanges: [],
          directory,
          annotations: { laser: [{ start: 0, end: 2 }], clicks: [], keys: [] },
        },
      ],
      pieces: [
        { id: "piece", recordingId: "take", start: 1, end: 2 },
        { id: "piece-again", recordingId: "take", start: 0, end: 1 },
      ],
    };
    await evaluate(
      `window.chord.desktop.projects.load().then(() => window.chord.desktop.projects.put([${JSON.stringify(project)}]))`,
    );
    main.webContents.reload();
    await until(
      () => evaluate(`!!document.querySelector('[data-projects] > div > button:first-child')`),
      "project card",
    );
    await evaluate(`document.querySelector('[data-projects] > div > button:first-child').click()`);
    await until(
      () =>
        evaluate(
          `!!document.querySelector('[data-clip]') && !document.querySelector('[aria-label=Play]').disabled`,
        ),
      "video",
    );

    const menuLabels = () =>
      evaluate(
        `Array.from(document.querySelectorAll('[role=menu] [data-menu-label]')).map(label => label.textContent)`,
      );
    const chooseContext = (label: string) =>
      evaluate(
        `Array.from(document.querySelectorAll('[role=menu] [role=menuitem]')).find(item => item.querySelector('[data-menu-label]').textContent === ${JSON.stringify(label)}).click()`,
      );
    const dismissContext = async () => {
      // Native key events require a focused window, unlike executeJavaScript clicks.
      app.focus({ steal: true });
      main.focus();
      await until(() => main.isFocused(), "window focus before Escape");
      await until(
        () => evaluate(`!!document.activeElement?.closest('[role=menu]')`),
        "context menu keyboard focus",
      );
      main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      main.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until(
        () => evaluate(`!document.querySelector('[role=menu]')`),
        "context menu dismissed",
      );
    };
    const openContextAt = async (target: string) => {
      await until(
        () => evaluate(`!document.querySelector('[role=menu]')`),
        "previous menu dismissed",
      );
      assert.equal(
        await evaluate(
          `!${target}.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, button:2}))`,
        ),
        true,
        "Suppress the web context menu",
      );
      await until(
        () => evaluate(`!!document.querySelector('[role=menu] [role=menuitem]')`),
        "context menu",
      );
    };
    const openContext = async (selector: string) => {
      await openContextAt(`document.querySelector(${JSON.stringify(selector)})`);
      assert.equal(
        await evaluate(
          `Array.from(document.querySelectorAll('[role=menu] [role=menuitem]')).find(item => item.querySelector('[data-menu-label]').textContent === 'Show in folder')?.disabled`,
        ),
        false,
      );
    };
    const revealContext = async (selector: string, expected: string) => {
      await openContext(selector);
      const count = revealed.length;
      await chooseContext("Show in folder");
      await until(() => revealed.length > count, "Finder reveal");
      assert.equal(revealed.at(-1), expected);
    };
    const revealInspector = async (expected: string) => {
      await evaluate(`document.querySelector('[data-inspector] [aria-haspopup=menu]').click()`);
      await until(
        () =>
          evaluate(
            `Array.from(document.querySelectorAll('[role=menuitem]')).some(item => item.textContent === 'Show in folder')`,
          ),
        "inspector actions",
      );
      const count = revealed.length;
      await evaluate(
        `Array.from(document.querySelectorAll('[role=menuitem]')).find(item => item.textContent === 'Show in folder').click()`,
      );
      await until(() => revealed.length > count, "inspector reveal");
      assert.equal(revealed.at(-1), expected);
    };
    const openDropdown = async (selector: string) => {
      await until(
        () => evaluate(`!document.querySelector('[role=menu]')`),
        "previous dropdown dismissed",
      );
      const point = await evaluate(
        `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
      );
      app.focus({ steal: true });
      main.focus();
      await until(() => main.isFocused(), "window focus before pointer input");
      main.webContents.sendInputEvent({ type: "mouseMove", ...point });
      await until(
        () =>
          evaluate(
            `Number(getComputedStyle(document.querySelector(${JSON.stringify(selector)})).opacity) > 0.95`,
          ),
        "hover actions visible",
      );
      main.webContents.sendInputEvent({
        type: "mouseDown",
        ...point,
        button: "left",
        clickCount: 1,
      });
      main.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
      await until(
        () =>
          evaluate(
            `Array.from(document.querySelectorAll('[role=menuitem]')).some(item => item.textContent.trim() === 'Delete recording')`,
          ),
        "recording dropdown",
      );
      await until(
        () =>
          evaluate(`Array.from(document.querySelectorAll('[role=menuitem]')).every(item => {
        const r = item.getBoundingClientRect();
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[role=menuitem]') === item;
      })`),
        "dropdown items visible and clickable",
      );
    };
    const chooseDropdown = (label: string) =>
      evaluate(
        `Array.from(document.querySelectorAll('[role=menuitem]')).find(item => item.textContent.trim() === ${JSON.stringify(label)}).click()`,
      );
    const cancelDelete = async () => {
      await until(
        () => evaluate(`!!document.querySelector('dialog[open] #recording-delete-title')`),
        "recording delete confirmation",
      );
      await evaluate(
        `Array.from(document.querySelectorAll('dialog button')).find(button => button.textContent.trim() === 'Cancel').click()`,
      );
      await until(() => evaluate(`!document.querySelector('dialog[open]')`), "cancelled delete");
    };

    // Sidebar actions use either the context menu or the shared dropdown, without the old icon buttons.
    const sidebar = "[data-recording-row=take]";
    assert.equal(
      await evaluate(
        `!!document.querySelector('[aria-label="Show recording 1 in Finder"], [aria-label="Delete recording 1"]')`,
      ),
      false,
    );
    await openContext(sidebar);
    assert.deepEqual(await menuLabels(), ["Show in folder", "Delete recording"]);
    await dismissContext();
    await revealContext(sidebar, directory);
    await openContext(sidebar);
    await chooseContext("Delete recording");
    await cancelDelete();
    await openDropdown(`${sidebar} [aria-haspopup=menu]`);
    let count = revealed.length;
    await chooseDropdown("Show in folder");
    await until(() => revealed.length > count, "sidebar dropdown reveal");
    assert.equal(revealed.at(-1), directory);
    await openDropdown(`${sidebar} [aria-haspopup=menu]`);
    await chooseDropdown("Delete recording");
    await cancelDelete();

    // A trimmed composite clip reveals the leading file at its start through either menu.
    await revealContext("[data-clip]", join(directory, "later.mov"));
    await openContext("[data-clip]");
    assert.ok((await menuLabels()).includes("Delete recording"));
    await chooseContext("Delete recording");
    await cancelDelete();
    await openDropdown("[data-clip] [aria-haspopup=menu]");
    count = revealed.length;
    await chooseDropdown("Show in folder");
    await until(() => revealed.length > count, "timeline dropdown reveal");
    assert.equal(revealed.at(-1), join(directory, "later.mov"));
    await openDropdown("[data-clip] [aria-haspopup=menu]");
    await chooseDropdown("Delete recording");
    await cancelDelete();
    assert.equal(
      await evaluate(`!!document.querySelector('[data-inspector]')`),
      true,
      "Right-clicking selects the clip, like Finder",
    );
    const point = await evaluate(
      `(() => { const r = document.querySelector('[data-clip]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
    );
    main.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    main.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
    await until(
      () => evaluate(`!!document.querySelector('[aria-label="Clip actions"]')`),
      "clip inspector",
    );
    await revealInspector(join(directory, "later.mov"));

    await evaluate(`document.querySelector('[aria-label="Edit recording 1"]').click()`);
    await until(
      () =>
        evaluate(
          `!!document.querySelector('[data-layer]') && !document.querySelector('[aria-label=Play]').disabled`,
        ),
      "recording tracks",
    );
    for (const [kind, index, file] of [
      ["screen", 0, "screen.mov"],
      ["camera", 0, "screen.mov"],
      ["microphone", 0, "audio.wav"],
      ["microphone", 1, "second-audio.wav"],
      ["systemAudio", 0, "audio.wav"],
    ] as const) {
      await revealContext(
        `[data-layer="${kind}"][data-layer-index="${index}"] [data-file]`,
        join(directory, file),
      );
      const label = `[data-layer-label="${kind}"][data-layer-index="${index}"]`;
      await revealContext(label, join(directory, file));
      await evaluate(`document.querySelector(${JSON.stringify(label)}).click()`);
      await revealInspector(join(directory, file));
    }
    await revealContext(
      '[data-layer=screen] [data-file="later.mov"]',
      join(directory, "later.mov"),
    );
    await revealContext("[data-effect=laser] [data-span]", directory);
    await revealContext("[data-effect-label=laser]", directory);
    await evaluate(`document.querySelector('[data-effect-label=laser]').click()`);
    await revealInspector(directory);

    // Dismissal leaves the track intact, and empty space only offers adding tracks.
    await openContext("[data-layer-label=microphone]");
    await dismissContext();
    await openContextAt(`document.querySelector('[data-tracks]')`);
    assert.equal(
      (await menuLabels()).includes("Show in folder"),
      false,
      "Empty space has nothing to reveal",
    );
    await dismissContext();
    const saved = await evaluate(
      `window.chord.desktop.projects.load().then(ps => ps.find(p => p.id === 'menus'))`,
    );
    assert.deepEqual(saved.pieces, project.pieces, "Reveal never edits clips");
    assert.equal(saved.recordings[0].audio, undefined, "Reveal never mutes tracks");
    assert.deepEqual(
      [...trashed],
      [],
      "Cancelling context menu and dropdown deletion preserves recording files",
    );
    // Confirming deletion while editing removes the recording and every occurrence from the video.
    await openContext(sidebar);
    await chooseContext("Delete recording");
    await until(() => evaluate(`!!document.querySelector('dialog[open]')`), "final confirmation");
    await evaluate(
      `Array.from(document.querySelectorAll('dialog button')).find(button => button.textContent.trim() === 'Delete recording').click()`,
    );
    await until(
      () =>
        evaluate(
          `window.chord.desktop.projects.load().then(ps => ps.find(p => p.id === 'menus').recordings.length === 0)`,
        ),
      "recording deletion saved",
    );
    const deleted = await evaluate(
      `window.chord.desktop.projects.load().then(ps => ps.find(p => p.id === 'menus'))`,
    );
    assert.deepEqual(deleted.pieces, []);
    await until(() => trashed.includes(directory), "deleted files moved to Trash");
    await until(
      () => evaluate(`!document.querySelector('[data-back-to-video]')`),
      "return from the deleted recording",
    );
    console.log(
      "PASS: context menu and dropdown recording actions reveal sources, preserve clips on cancellation, and delete all occurrences only after confirmation; track and inspector actions still work",
    );
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
