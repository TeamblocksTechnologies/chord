// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/projects/tests/integration/project-context-menu.ts
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const data = mkdtempSync(join(tmpdir(), "chord-project-menu-test-"));
app.setPath("userData", data);
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
    : ['setScreenPreview','setAudioPreview'].includes(request.method) ? {failures:[]}
    : request.method === 'getPermissions' ? {screen:'granted',microphone:'granted',camera:'granted',accessibility:'granted'}
    : null;
  process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:request.id, result}) + '\\n');
});
`,
  { mode: 0o755 },
);
process.env.CHORD_RECORDER_HELPER = fixture;
process.env.CHORD_RECORDINGS_FOLDER = join(data, "recordings");
const speechFixture = join(data, "speech.cjs");
writeFileSync(
  speechFixture,
  `#!/usr/bin/env node
console.log(JSON.stringify({status:'installed',locale:'en-CA',locales:['en-CA','fr-CA'],system:'en-CA'}));
`,
  { mode: 0o755 },
);
process.env.CHORD_TRANSCRIBER_HELPER = speechFixture;
const rendererErrors: string[] = [];
app.on("browser-window-created", (_event, win: BrowserWindow) =>
  win.webContents.on("console-message", (event) => {
    if (/^Uncaught/.test(event.message)) {
      console.error("Renderer error:", event.message, event.sourceId, event.lineNumber);
      rendererErrors.push(event.message);
    }
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
    await until(() => evaluate(main, '!!document.querySelector("[aria-label=Settings]")'));
    await click(
      main,
      `Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('New project'))`,
    );
    await until(() => evaluate(main, `!!document.querySelector('[aria-label="Project name"]')`));
    await evaluate(
      main,
      `(() => {
      const input = document.querySelector('[aria-label="Project name"]');
      input.value = 'Context menu project';
      input.dispatchEvent(new Event('input', {bubbles:true}));
      document.querySelector('[aria-label=Projects]').click();
    })()`,
    );
    await until(() =>
      evaluate(main, '!!document.querySelector("[data-projects] > div > button:first-child")'),
    );
    const projects = () => evaluate(main, "window.chord.desktop.projects.load()");
    await until(async () =>
      (await projects()).some((p: { name: string }) => p.name === "Context menu project"),
    );
    const [project] = await projects();
    const menuLabels = () =>
      evaluate(
        main,
        `Array.from(document.querySelectorAll('[role=menu] [data-menu-label]')).map(label => label.textContent)`,
      );
    const chooseItem = (label: string) =>
      evaluate(
        main,
        `Array.from(document.querySelectorAll('[role=menu] [role=menuitem]')).find(item => item.querySelector('[data-menu-label]').textContent === ${JSON.stringify(label)}).click()`,
      );
    const openContext = async () => {
      await until(
        () => evaluate(main, `!document.querySelector('[role=menu]')`),
        "previous menu dismissed",
      );
      assert.equal(
        await evaluate(
          main,
          `!document.querySelector('[data-projects] > div > button:first-child').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true, button:2}))`,
        ),
        true,
        "Suppress the web context menu",
      );
      await until(
        () => evaluate(main, `!!document.querySelector('[role=menu] [role=menuitem]')`),
        "project context menu",
      );
      assert.deepEqual(await menuLabels(), ["Open project", "Show in folder", "Delete project"]);
      assert.equal(
        await evaluate(main, '!!document.querySelector("[data-projects]")'),
        true,
        "Right click keeps home open",
      );
    };
    const choose = async (label: string | null) => {
      if (label) return chooseItem(label);
      main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      main.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      await until(() => evaluate(main, `!document.querySelector('[role=menu]')`), "menu dismissed");
    };
    const dialogOpen = () => evaluate(main, '!!document.querySelector("dialog[open]")');
    const dialogClosed = () => evaluate(main, '!document.querySelector("dialog")');
    const cancel = () =>
      evaluate(
        main,
        `Array.from(document.querySelectorAll('dialog button')).find(b => b.textContent.trim() === 'Cancel').click()`,
      );
    const confirm = () =>
      evaluate(
        main,
        `Array.from(document.querySelectorAll('dialog button')).find(b => b.textContent.trim() === 'Delete project').click()`,
      );
    await openContext();
    await choose(null);
    await evaluate(main, "new Promise(resolve => requestAnimationFrame(resolve))");
    assert.equal(await dialogOpen(), false, "Dismissed menu does nothing");
    assert.equal(
      await evaluate(main, '!!document.querySelector("[data-projects]")'),
      true,
      "Escape on the menu stays home",
    );
    for (const view of ["Grid view", "List view"] as const) {
      await click(main, `document.querySelector('[aria-label="${view}"]')`);
      await openContext();
      await choose("Delete project");
      await until(dialogOpen, "deletion confirmation");
      assert.equal((await projects()).length, 1, "Choosing Delete does not delete immediately");
      assert.match(
        await evaluate(main, 'document.querySelector("dialog").innerText'),
        /Context menu project/,
      );
      assert.equal(
        await evaluate(main, "document.activeElement.textContent.trim()"),
        "Cancel",
        "Safe initial focus",
      );
      await screenshot(main, `project-delete-${view.split(" ")[0].toLowerCase()}`);
      await cancel();
      await until(dialogClosed);
      assert.equal((await projects()).length, 1, "Cancel preserves project");
    }
    await openContext();
    await choose("Open project");
    await until(
      () => evaluate(main, `!!document.querySelector('[aria-label="Project name"]')`),
      "Open project action",
    );
    await click(main, `document.querySelector('[aria-label="Project actions"]')`);
    await until(() => evaluate(main, '!!document.querySelector("[role=menu] [role=menuitem]")'));
    await chooseItem("Delete project");
    await until(dialogOpen);
    const confirmation = await evaluate(main, 'document.querySelector("dialog").innerText');
    await cancel();
    await until(dialogClosed);
    await click(main, `document.querySelector('[aria-label=Projects]')`);
    await until(() => evaluate(main, '!!document.querySelector("[data-projects]")'));
    await openContext();
    await choose("Delete project");
    await until(dialogOpen);
    assert.equal(
      await evaluate(main, 'document.querySelector("dialog").innerText'),
      confirmation,
      "Both entry points share confirmation",
    );
    main.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    main.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await until(dialogClosed, "Escape cancels deletion");
    await openContext();
    await choose("Delete project");
    await until(dialogOpen);
    await confirm();
    await until(async () => (await projects()).length === 0, "Confirmed deletion persisted");
    assert.equal(
      await evaluate(main, '!!document.querySelector("[aria-label=Projects]")'),
      false,
      "Deletion from home stays on home",
    );
    assert.equal(
      (await projects()).some((p: { id: string }) => p.id === project.id),
      false,
    );
    // The project view also confirms and deletes projects containing recordings.
    await evaluate(
      main,
      `window.chord.desktop.projects.put([{
      ...${JSON.stringify(project)}, name:'Project with recordings',
      recordings:[{id:'take', createdAt:new Date().toISOString(), duration:10, mode:'display',
        hasMicrophone:false, hasCamera:false, hasSystemAudio:false, markCount:0, pageChanges:[], directory:null}],
    }])`,
    );
    await reload(main);
    await until(() =>
      evaluate(main, '!!document.querySelector("[data-projects] > div > button:first-child")'),
    );
    await click(main, `document.querySelector('[data-projects] > div > button:first-child')`);
    await click(main, `document.querySelector('[aria-label="Project actions"]')`);
    await until(() => evaluate(main, '!!document.querySelector("[role=menu] [role=menuitem]")'));
    await chooseItem("Delete project");
    await until(dialogOpen);
    assert.match(
      await evaluate(main, 'document.querySelector("dialog").innerText'),
      /Its recording will be moved to the Trash too/,
    );
    await confirm();
    await until(async () => (await projects()).length === 0);
    await until(
      () => evaluate(main, `!document.querySelector('[aria-label="Project actions"]')`),
      "Project view returns home after deletion",
    );
    assert.deepEqual(rendererErrors, []);
    console.log(
      "PASS: project context menu, grid/list, open, dismiss, shared deletion confirmation, Cancel, Escape, confirmed deletion",
    );
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
