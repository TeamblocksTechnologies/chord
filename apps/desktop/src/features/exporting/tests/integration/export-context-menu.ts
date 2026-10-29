// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/exporting/tests/integration/export-context-menu.ts
import { app, BrowserWindow, shell } from "electron";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const data = mkdtempSync(join(tmpdir(), "chord-export-menu-"));
app.setPath("userData", data);
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
const folder = join(process.env.CHORD_RECORDINGS_FOLDER!, "Export menus", "Exports");
mkdirSync(folder, { recursive: true });
const first = join(folder, "first.mp4");
const second = join(folder, "second.webm");
for (const path of [first, second] as const) {
  writeFileSync(path, "export fixture");
  for (const extension of ["txt", "srt", "vtt"] as const)
    writeFileSync(path.replace(/\.(mp4|webm)$/, `.${extension}`), "transcript fixture");
}

async function until(check: () => unknown | Promise<unknown>, message: string) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

const revealed: string[] = [],
  played: string[] = [],
  trashed: string[] = [];
shell.showItemInFolder = (path: string) => revealed.push(path);
shell.openPath = async (path: string) => {
  played.push(path);
  return "";
};
shell.trashItem = async (path: string) => {
  assert.ok(path.startsWith(folder + "/"));
  trashed.push(path);
  rmSync(path);
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
    const evaluate = (expression: string) => main.webContents.executeJavaScript(expression);
    await until(() => evaluate('!!document.querySelector("[aria-label=Settings]")'), "home");
    const setup = await evaluate("window.chord.desktop.getState().then(state => state.defaults)");
    const now = new Date().toISOString();
    const project = {
      id: "exports",
      name: "Export menus",
      createdAt: now,
      updatedAt: now,
      notes: [],
      recordings: [],
      setup,
    };
    await evaluate(
      `window.chord.desktop.projects.load().then(() => window.chord.desktop.projects.put([${JSON.stringify(project)}]))`,
    );
    main.webContents.reload();
    await until(
      () => evaluate(`!!document.querySelector('[data-projects] > div > button:first-child')`),
      "project",
    );
    await evaluate(`document.querySelector('[data-projects] > div > button:first-child').click()`);
    await until(
      () => evaluate(`document.querySelectorAll('[data-exports] li').length === 2`),
      "export list",
    );
    const row = (path: string) => `[data-export=${JSON.stringify(path)}]`;
    const choose = (label: string) =>
      evaluate(
        `Array.from(document.querySelectorAll('[role=menu] [role=menuitem]')).find(item => item.querySelector('[data-menu-label]').textContent === ${JSON.stringify(label)}).click()`,
      );
    const menuLabels = () =>
      evaluate(
        `Array.from(document.querySelectorAll('[role=menu] [data-menu-label]')).map(label => label.textContent)`,
      );
    const dismiss = async () => {
      main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      main.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until(() => evaluate(`!document.querySelector('[role=menu]')`), "menu dismissed");
    };
    const openContext = async (path: string) => {
      await until(
        () => evaluate(`!document.querySelector('[role=menu]')`),
        "previous menu dismissed",
      );
      assert.equal(
        await evaluate(
          `!document.querySelector(${JSON.stringify(row(path))}).dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, button:2}))`,
        ),
        true,
      );
      await until(
        () => evaluate(`!!document.querySelector('[role=menu] [role=menuitem]')`),
        "export context menu",
      );
      assert.deepEqual(await menuLabels(), ["Show in folder", "Delete export"]);
    };
    const openDropdown = async (path: string) => {
      await until(
        () => evaluate(`!document.querySelector('[role=menu]')`),
        "previous dropdown dismissed",
      );
      const selector = `${row(path)} [aria-haspopup=menu]`;
      const point = await evaluate(
        `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
      );
      main.webContents.sendInputEvent({ type: "mouseMove", ...point });
      await until(
        () =>
          evaluate(
            `Number(getComputedStyle(document.querySelector(${JSON.stringify(selector)})).opacity) > 0.95`,
          ),
        "hover menu button",
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
            `Array.from(document.querySelectorAll('[role=menuitem]')).some(item => item.textContent.trim() === 'Delete export')`,
          ),
        "export dropdown",
      );
      await until(
        () =>
          evaluate(`Array.from(document.querySelectorAll('[role=menuitem]')).every(item => {
        const r = item.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('[role=menuitem]') === item;
      })`),
        "dropdown visible and clickable",
      );
    };
    const dialogButton = (label: string) =>
      evaluate(
        `Array.from(document.querySelectorAll('dialog button')).find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`,
      );
    const confirmShown = () =>
      until(
        () => evaluate(`!!document.querySelector('dialog[open] #export-delete-title')`),
        "export delete confirmation",
      );

    assert.equal(
      await evaluate(
        `!!document.querySelector('[data-exports] button[title="Show in Finder"], [data-exports] button[title="Move to Trash"]')`,
      ),
      false,
      "Separate action buttons removed",
    );
    for (const path of [first, second] as const) {
      await openContext(path);
      await choose("Show in folder");
      await until(() => revealed.at(-1) === path, "context menu reveal of correct export");
      await openDropdown(path);
      const count = revealed.length;
      await choose("Show in folder");
      await until(() => revealed.length > count, "dropdown reveal");
      assert.equal(revealed.at(-1), path);
    }
    assert.deepEqual(played, [], "Secondary actions never play an export");
    await openContext(first);
    await dismiss();
    assert.deepEqual(trashed, [], "Dismissal leaves exports intact");

    // Both menus share confirmation; cancellation leaves the video and caption sidecars intact.
    await openContext(first);
    await choose("Delete export");
    await confirmShown();
    await dialogButton("Cancel");
    await until(
      () => evaluate(`!document.querySelector('dialog[open]')`),
      "cancelled context menu delete",
    );
    await openDropdown(second);
    await choose("Delete export");
    await confirmShown();
    await dialogButton("Cancel");
    await until(
      () => evaluate(`!document.querySelector('dialog[open]')`),
      "cancelled dropdown delete",
    );
    assert.deepEqual(trashed, []);
    assert.ok(existsSync(first) && existsSync(second));

    // Ordinary clicks still play; each confirmed deletion refreshes the sidebar and deletes only its own files.
    await evaluate(`document.querySelector(${JSON.stringify(row(first) + " > button")}).click()`);
    await until(() => played.length === 1, "play export");
    assert.equal(played[0], first);
    await openContext(first);
    await choose("Delete export");
    await confirmShown();
    await dialogButton("Delete export");
    await until(
      () =>
        evaluate(
          `document.querySelectorAll('[data-exports] li').length === 1 && !document.querySelector('dialog[open]')`,
        ),
      "context menu deletion refresh",
    );
    assert.equal(trashed.length, 4);
    assert.ok(existsSync(second));
    await openDropdown(second);
    await choose("Delete export");
    await confirmShown();
    await dialogButton("Delete export");
    await until(
      () => evaluate(`!document.querySelector('[data-exports], dialog[open]')`),
      "empty export section hidden",
    );
    assert.equal(trashed.length, 8);
    console.log(
      "PASS: export context and hover menus reveal the correct files, preserve playback and cancellation, and refresh after confirmed deletion of videos and caption sidecars",
    );
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
