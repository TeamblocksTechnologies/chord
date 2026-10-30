// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/recording/tests/integration/toolbar.ts
import { app, BrowserWindow, globalShortcut, screen } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  animationsDone,
  click,
  evaluate,
  eventually,
  screenshot,
  settle,
  until,
} from "../../../../../tests/support/integration.ts";
const data = mkdtempSync(join(tmpdir(), "chord-toolbar-test-"));
app.setPath("userData", data);
app.on("quit", () =>
  rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
);
const helperLog = join(data, "helper.log");
const sourcesPath = join(data, "sources.json");
writeFileSync(
  sourcesPath,
  JSON.stringify({ displays: [], applications: [], windows: [], microphones: [], cameras: [] }),
);
// Granted, since source menus stay closed until the system allows what they need.
const permissionsPath = join(data, "permissions.json");
const setPermissions = (status: string) =>
  writeFileSync(
    permissionsPath,
    JSON.stringify({ screen: status, microphone: status, camera: status, accessibility: status }),
  );
setPermissions("granted");
const fixture = join(data, "helper.cjs");
writeFileSync(
  fixture,
  `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  appendFileSync(${JSON.stringify(helperLog)}, line + '\\n');
  const permissions = JSON.parse(readFileSync(${JSON.stringify(permissionsPath)}, 'utf8'));
  const session = { id:'session', directory:require('node:path').join(${JSON.stringify(data)}, 'recordings', 'session'), state:'recording' };
  const result = request.method === 'listSources' ? JSON.parse(readFileSync(${JSON.stringify(sourcesPath)}, 'utf8'))
    : ['getPermissions','requestPermission'].includes(request.method) ? permissions
    : ['startSession','pauseSession','resumeSession','stopSession'].includes(request.method) ? session
    : ['updateSession','setMouseWatch','setKeyWatch'].includes(request.method) ? null
    : ['setAudioPreview','setScreenPreview'].includes(request.method) ? {failures:[]}
    : request.method === 'setWindowPreview' ? {window:null} : {};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:request.id, result}) + '\\n');
});
`,
  { mode: 0o755 },
);
process.env.CHORD_RECORDER_HELPER = fixture;
process.env.CHORD_RECORDINGS_FOLDER = join(data, "recordings");
const surfaceWindow = (kind: string) =>
  BrowserWindow.getAllWindows().find(
    (w) => new URL(w.webContents.getURL() || "about:blank").searchParams.get("surface") === kind,
  )!;
const escape = (win: BrowserWindow) => {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
};
// Dropdowns open in the page of the window they belong to.
const menuOpen = (win: BrowserWindow) => evaluate(win, '!!document.querySelector("[role=menu]")');
async function openMenu(win: BrowserWindow, kind: string) {
  await click(
    win,
    `document.querySelector('[data-source-toggle="${kind.toLowerCase()}"] + [data-popup-trigger]')`,
  );
  await until(() => menuOpen(win), `${kind} menu`);
  await animationsDone(win);
}
const menuClosed = (win: BrowserWindow, message: string) =>
  until(async () => !(await menuOpen(win)), message);
async function clickAt(win: BrowserWindow, selector: string, offset?: { x: number; y: number }) {
  const point = await evaluate(
    win,
    `(() => {
    const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
    return r && { x:Math.round(r.x + ${offset ? offset.x : "r.width / 2"}), y:Math.round(r.y + ${offset ? offset.y : "r.height / 2"}) };
  })()`,
  );
  if (!point) throw new Error(`Nothing to click at ${selector}`);
  win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
  win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
}
// The toolbar's bar, in the page and on screen.
async function barRect(win: BrowserWindow) {
  await evaluate(
    win,
    "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
  );
  const r = await evaluate(
    win,
    `(() => { const r = document.querySelector('[data-toolbar]').getBoundingClientRect(); return {x:r.x, y:r.y, width:r.width, height:r.height, top:r.top, bottom:r.bottom, viewportHeight:innerHeight}; })()`,
  );
  const frame = win.getBounds();
  return { ...r, screenY: frame.y + r.y, screenX: frame.x + r.x };
}
// Moves the toolbar's bar to `y` on screen the way a drag does.
async function moveToolbar(win: BrowserWindow, y: number) {
  const before = await barRect(win);
  await evaluate(win, "window.chord.desktop.overlay.dragStart()");
  await evaluate(win, `window.chord.desktop.overlay.dragMove(0, ${y - before.screenY})`);
  await evaluate(win, "window.chord.desktop.overlay.dragEnd()");
}
// An uncaught error in any page, like a Svelte effect loop that freezes it, fails the run.
const rendererErrors: string[] = [];
app.on("browser-window-created", (_e, w) =>
  w.webContents.on("console-message", (event) => {
    const message = String(event.message ?? "");
    console.log("renderer:", message);
    if (/^Uncaught/.test(message)) rendererErrors.push(message);
  }),
);
app.whenReady().then(async () => {
  try {
    assert.equal(
      existsSync(resolve(import.meta.dirname, "../../../../../out/main/window-material.node")),
      false,
      "The build should not include the removed native addon",
    );
    await import(
      pathToFileURL(resolve(import.meta.dirname, "../../../../../out/main/index.js")).href
    );
    await until(() => surfaceWindow("main"));
    let main = surfaceWindow("main");
    await until(() => evaluate(main, '!!window.chord && !!document.querySelector("button")'));
    await until(() => evaluate(main, "window.chord.desktop.getState().then(s=>!!s.defaults)"));
    const original = main.getBounds();
    const originalShadow = main.hasShadow();
    const initial = await evaluate(main, "window.chord.desktop.getState()");
    assert.equal(
      initial.toolbar.registered,
      globalShortcut.isRegistered("CommandOrControl+Shift+R"),
    );
    await evaluate(main, "window.chord.toolbar.show()");
    await until(() => surfaceWindow("toolbar")?.isVisible());
    const bar = surfaceWindow("toolbar");
    await until(() => evaluate(bar, '!!document.querySelector("[data-toolbar]")'));
    assert.notEqual(main.id, bar.id);
    assert.deepEqual(main.getBounds(), original);
    assert.equal(main.hasShadow(), originalShadow);
    const toolbarHeight = 56;
    // The window is transparent, with room for dropdowns beside the bar; at the bottom of the screen that's above it.
    assert.equal(bar.isResizable(), false);
    assert.equal(bar.hasShadow(), false);
    let rect = await barRect(bar);
    assert.equal(rect.height, toolbarHeight);
    assert.ok(bar.getBounds().height > toolbarHeight + 200, "The window keeps room for a dropdown");
    assert.equal(
      rect.bottom,
      rect.viewportHeight,
      "The bar sits at the bottom, below the room for its dropdowns",
    );
    assert.equal((await evaluate(bar, "window.chord.desktop.getState()")).toolbar.side, "above");
    assert.equal(await evaluate(bar, 'document.body.innerText.includes("New project")'), false);
    await screenshot(bar, "toolbar");
    const compactControls = await evaluate(
      bar,
      `(() => {
      const toolbar = document.querySelector('[data-toolbar]');
      const buttons = Array.from(toolbar.querySelectorAll('button'));
      const r = toolbar.getBoundingClientRect();
      return {
        firstButton:buttons[0].getAttribute('aria-label'),
        controlsFit:buttons.every(b=>{const c=b.getBoundingClientRect(); return c.top>=r.top && c.bottom<=r.bottom && c.left>=r.left && c.right<=r.right}),
        hasSubheaders:Array.from(toolbar.querySelectorAll('span')).some(e=>['Screen','Camera','Microphone'].includes(e.textContent)),
        hasDragHandle:!!toolbar.querySelector('[title="Drag toolbar"]'),
      };
    })()`,
    );
    assert.deepEqual(compactControls, {
      firstButton: "Dismiss toolbar",
      controlsFit: true,
      hasSubheaders: false,
      hasDragHandle: false,
    });
    const cells = await evaluate(
      bar,
      `Array.from(document.querySelectorAll('[aria-pressed]')).map(e=>(e.tagName === 'BUTTON' && e.hasAttribute('aria-label') && !e.getAttribute('aria-label').startsWith('System audio') ? e.parentElement : e).getBoundingClientRect().y)`,
    );
    assert.equal(cells.length, 4);
    assert.equal(new Set(cells).size, 1);
    // Dropdowns open on the side with room, clear of the bar, without the window moving or resizing.
    const { workArea } = screen.getDisplayMatching(bar.getBounds());
    for (const [y, side] of [
      [workArea.y, "below"],
      [workArea.y + workArea.height - toolbarHeight, "above"],
    ] as const) {
      await moveToolbar(bar, y);
      await until(
        async () => (await evaluate(bar, "window.chord.desktop.getState()")).toolbar.side === side,
        `toolbar at ${side}`,
      );
      await eventually(async () => {
        rect = await barRect(bar);
        assert.equal(rect.screenY, y, "The bar stays where it was dropped");
      }, `the bar at ${y}`);
      const frame = bar.getBounds();
      await openMenu(bar, "Camera");
      assert.deepEqual(
        bar.getBounds(),
        frame,
        "Opening a dropdown must not resize or move the window",
      );
      const menu = await evaluate(
        bar,
        `(()=>{const m=document.querySelector('[role=menu]'); const r=m.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height,left:r.left,right:r.right, translate:m.style.translate, transform:getComputedStyle(m).transform, trigger:m.parentElement.getBoundingClientRect().bottom}})()`,
      );
      assert.ok(menu.height > 30);
      assert.ok(
        menu.top >= 0 && menu.bottom <= rect.viewportHeight && menu.left >= 0,
        "The dropdown fits in the window",
      );
      if (side === "below")
        assert.ok(
          menu.top >= rect.bottom + 6,
          `The dropdown should clear the bottom of the toolbar: ${JSON.stringify({ menu, rect })}`,
        );
      else
        assert.ok(menu.bottom <= rect.top - 6, "The dropdown should clear the top of the toolbar");
      await screenshot(bar, `dropdown-${side}`);
      escape(bar);
      await menuClosed(bar, "Escape to close the dropdown");
      assert.equal(bar.isVisible(), true, "Escape closes the dropdown before the toolbar");
    }
    // Only a dropdown's own source toggle is exempt from outside-click dismissal.
    const savedDefaults = (await evaluate(bar, "window.chord.desktop.getState()")).defaults;
    await evaluate(
      bar,
      'window.chord.desktop.updateDefaults({cameraIds:["test-camera"],cameraEnabled:false,microphoneIds:["test-mic"],microphoneEnabled:false})',
    );
    for (const kind of ["Screen", "Camera", "Microphone"] as const) {
      await openMenu(bar, kind);
      await evaluate(
        bar,
        `document.querySelector('[role=menu]').dataset.test = ${JSON.stringify(kind)}`,
      );
      const toggle = `[aria-label^="${kind} "][aria-pressed]`;
      const wasOn = await evaluate(
        bar,
        `document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-pressed')`,
      );
      for (const expected of [wasOn === "true" ? "false" : "true", wasOn] as const) {
        // Target the icon too, so nested SVG clicks get the same behavior as button clicks.
        await clickAt(bar, `${toggle} svg`);
        await until(
          () =>
            evaluate(
              bar,
              `document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-pressed') === ${JSON.stringify(expected)}`,
            ),
          `${kind} source to toggle`,
        );
        await settle();
        assert.equal(
          await evaluate(bar, `document.querySelector('[role=menu]')?.dataset.test`),
          kind,
          `${kind} dropdown should stay open, not reopen, when its own source is toggled`,
        );
      }
      await clickAt(bar, '[aria-label^="System audio "][aria-pressed]');
      await menuClosed(bar, "another source toggle to dismiss the dropdown");
    }
    await evaluate(bar, `window.chord.desktop.updateDefaults(${JSON.stringify(savedDefaults)})`);
    // Unchecking kept devices while a source is off must edit the selection without switching it on.
    writeFileSync(
      sourcesPath,
      JSON.stringify({
        displays: [],
        applications: [],
        windows: [],
        microphones: [
          { id: "mic-1", name: "Microphone one", isDefault: true },
          { id: "mic-2", name: "Microphone two", isDefault: false },
        ],
        cameras: [
          { id: "camera-1", name: "Camera one", isDefault: true, formats: [] },
          { id: "camera-2", name: "Camera two", isDefault: false, formats: [] },
        ],
      }),
    );
    for (const win of BrowserWindow.getAllWindows())
      win.webContents.send("helper:notification", "devicesChanged", {});
    // Let the fresh-install default microphone selection finish before setting up each case.
    await until(() =>
      evaluate(
        main,
        'window.chord.desktop.getState().then(s=>s.defaults.microphoneIds.includes("mic-1"))',
      ),
    );
    for (const win of [main, bar] as const) {
      for (const [kind, field, ids] of [
        ["Microphone", "microphone", ["mic-1", "mic-2"]],
        ["Camera", "camera", ["camera-1", "camera-2"]],
      ] as const) {
        const patch = { [`${field}Ids`]: ids, [`${field}Enabled`]: false };
        await evaluate(win, `window.chord.desktop.updateDefaults(${JSON.stringify(patch)})`);
        const source = `[data-source-toggle="${field}"]`;
        await until(() =>
          evaluate(
            win,
            `document.querySelector(${JSON.stringify(source)}).getAttribute('aria-pressed') === 'false'`,
          ),
        );
        if (win === main) main.focus();
        await openMenu(win, kind);
        await until(() =>
          evaluate(win, 'document.querySelectorAll("[role=menuitemcheckbox]").length === 2'),
        );
        const checked = () =>
          evaluate(
            win,
            'Array.from(document.querySelectorAll("[role=menuitemcheckbox]")).map(e=>e.getAttribute("aria-checked"))',
          );
        await until(
          async () => (await checked()).every((value: string) => value === "true"),
          `${kind} saved selections in ${win === bar ? "toolbar" : "main app"}`,
        );
        for (const remaining of [[ids[1]], []] as const) {
          await clickAt(win, "[role=menuitemcheckbox][aria-checked=true] span");
          await until(() =>
            evaluate(
              win,
              `window.chord.desktop.getState().then(s=>JSON.stringify(s.defaults.${field}Ids) === ${JSON.stringify(JSON.stringify(remaining))})`,
            ),
          );
          assert.equal(
            (await evaluate(win, "window.chord.desktop.getState()")).defaults[`${field}Enabled`],
            false,
            `${kind} must stay off when unchecking a device in ${win === bar ? "the toolbar" : "the main app"}`,
          );
          await until(
            async () =>
              (await checked()).filter((value: string) => value === "true").length ===
              remaining.length,
          );
          assert.equal(
            await evaluate(
              win,
              `document.querySelector(${JSON.stringify(source)}).getAttribute('aria-pressed')`,
            ),
            "false",
          );
        }
        // Checking an unchecked device still enables it, and unchecking the last active device turns the cell off.
        await clickAt(win, "[role=menuitemcheckbox] span");
        await until(() =>
          evaluate(
            win,
            `document.querySelector(${JSON.stringify(source)}).getAttribute('aria-pressed') === 'true'`,
          ),
        );
        await clickAt(win, "[role=menuitemcheckbox][aria-checked=true] span");
        await until(() =>
          evaluate(
            win,
            `document.querySelector(${JSON.stringify(source)}).getAttribute('aria-pressed') === 'false'`,
          ),
        );
        escape(win);
        await menuClosed(win, `${kind} menu to close`);
      }
    }
    writeFileSync(
      sourcesPath,
      JSON.stringify({ displays: [], applications: [], windows: [], microphones: [], cameras: [] }),
    );
    for (const win of BrowserWindow.getAllWindows())
      win.webContents.send("helper:notification", "devicesChanged", {});
    await evaluate(bar, `window.chord.desktop.updateDefaults(${JSON.stringify(savedDefaults)})`);
    // Real pointer input dismisses outside the dropdown, including clicks on the toolbar and the empty room beside it.
    await openMenu(bar, "Camera");
    await clickAt(bar, "[role=menu]");
    await settle();
    assert.equal(await menuOpen(bar), true, "Clicks inside the dropdown must keep it open");
    await clickAt(bar, "[data-toolbar]", { x: 500, y: 4 });
    await menuClosed(bar, "toolbar click to dismiss the dropdown");
    await openMenu(bar, "Camera");
    await clickAt(bar, "body", { x: 5, y: 5 });
    await menuClosed(bar, "click in the empty room to dismiss the dropdown");
    assert.equal(bar.isVisible(), true);
    await openMenu(bar, "Camera");
    await clickAt(bar, '[data-source-toggle="camera"] + [data-popup-trigger]');
    await menuClosed(bar, "same dropdown to toggle closed");
    await settle();
    assert.equal(
      await menuOpen(bar),
      false,
      "Outside-click handling must not reopen the same dropdown",
    );
    await openMenu(bar, "Camera");
    await clickAt(bar, '[data-source-toggle="screen"] + [data-popup-trigger]');
    await until(
      () =>
        evaluate(
          bar,
          `document.querySelectorAll('[role=menu]').length === 1 && !!document.querySelector('[role=menu] [aria-label="Screen mode"]')`,
        ),
      "another dropdown to replace it",
    );
    await animationsDone(bar);
    await clickAt(bar, '[role=menu] [role=radio][title="Focused window"]');
    await settle();
    assert.equal(
      await menuOpen(bar),
      true,
      "Dropdown controls should remain interactive without dismissal",
    );
    await clickAt(bar, '[data-source-toggle="camera"]');
    await menuClosed(bar, "source toggle outside the dropdown to dismiss it");
    await openMenu(bar, "Camera");
    app.emit("browser-window-focus", {}, main);
    await menuClosed(bar, "main-window focus to dismiss the dropdown");
    if (process.platform === "darwin") {
      await openMenu(bar, "Camera");
      app.emit("did-resign-active", {});
      await menuClosed(bar, "app deactivation to dismiss the dropdown");
      assert.equal(bar.isVisible(), true);
    }
    await openMenu(bar, "Screen");
    await Promise.all([
      evaluate(
        bar,
        `document.querySelector('[role=menu] [role=radio][title="Full display"]').click()`,
      ),
      evaluate(main, `document.querySelector('[aria-label^="System audio"]').click()`),
    ]);
    await until(() =>
      evaluate(
        bar,
        'window.chord.desktop.getState().then(s=>s.defaults.mode==="display" && s.defaults.systemAudio)',
      ),
    );
    await until(() =>
      evaluate(bar, 'document.querySelector("[data-toolbar]").innerText.includes("Full display")'),
    );
    await until(() =>
      evaluate(main, 'window.chord.desktop.getState().then(s=>s.defaults.mode==="display")'),
    );
    // Different windows can update separate setup fields concurrently.
    await Promise.all([
      evaluate(main, "window.chord.desktop.updateDefaults({showsSystemUI:false})"),
      evaluate(bar, "window.chord.desktop.updateDefaults({systemAudio:true})"),
    ]);
    const synced = await evaluate(bar, "window.chord.desktop.getState()");
    assert.equal(synced.defaults.showsSystemUI, false);
    assert.equal(synced.defaults.systemAudio, true);
    assert.deepEqual(
      JSON.parse(readFileSync(join(data, "quick-recording.json"), "utf8")),
      synced.defaults,
    );
    escape(bar);
    await menuClosed(bar, "Escape to close the screen dropdown");
    await openMenu(bar, "Camera");
    if (bar.isFocused()) main.focus();
    else await evaluate(bar, 'window.dispatchEvent(new Event("blur"))'); // Background test runs can have no active window.
    await menuClosed(bar, "dropdown to dismiss when the toolbar loses focus");
    // Preview ownership is independent across windows, including empty and released watchers.
    await evaluate(
      main,
      `window.chord.helper.request('setAudioPreview',{sources:[{kind:'microphone',deviceId:'main-mic'}]})`,
    );
    await evaluate(bar, `window.chord.helper.request('setAudioPreview',{sources:[]})`);
    const logged = readFileSync(helperLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((r) => r.method === "setAudioPreview")
      .at(-1);
    assert.equal(logged.params.sources[0].deviceId, "main-mic");
    await evaluate(
      bar,
      `window.chord.helper.request('setAudioPreview',{sources:[{kind:'microphone',deviceId:'toolbar-mic'}]})`,
    );
    await evaluate(bar, "window.chord.toolbar.hide()");
    await until(() => {
      const r = readFileSync(helperLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((r) => r.method === "setAudioPreview")
        .at(-1);
      return r.params.sources.length === 1 && r.params.sources[0].deviceId === "main-mic";
    });
    setPermissions("granted");
    // A main-window start hands off during the countdown, and cancellation returns to the same window.
    await evaluate(main, "window.chord.desktop.updatePreferences({countdown:3})");
    await evaluate(
      main,
      "window.chord.desktop.getState().then(s=>window.chord.desktop.recording.start(s.defaults))",
    );
    assert.equal(
      main.isVisible(),
      false,
      "Starting from the main window hides it during the countdown",
    );
    assert.equal(
      (await evaluate(main, "window.chord.desktop.getState()")).recording.phase,
      "countdown",
    );
    await until(() => surfaceWindow("island")?.isVisible(), "countdown island");
    await evaluate(surfaceWindow("island"), "window.chord.desktop.recording.cancel()");
    assert.equal(main.isVisible(), true, "Canceling returns to the main window");
    assert.deepEqual(main.getBounds(), original);
    const preferences = await evaluate(
      main,
      "window.chord.desktop.updatePreferences({countdown:0}).then(s=>s.preferences)",
    );
    assert.deepEqual(JSON.parse(readFileSync(join(data, "preferences.json"), "utf8")), preferences);
    await evaluate(main, "window.chord.toolbar.show()");
    await until(() => bar.isVisible());
    await evaluate(bar, 'document.querySelector("[aria-label=Record]").click()');
    await until(() =>
      evaluate(main, 'window.chord.desktop.getState().then(s=>s.recording.phase==="recording")'),
    );
    assert.equal(bar.isVisible(), false);
    assert.equal(main.isVisible(), false, "Starting from the toolbar also hides the main window");
    assert.deepEqual(main.getBounds(), original);
    // The island shows the recording; its cells only appear once it's opened to interact with.
    await until(() => surfaceWindow("island")?.isVisible(), "recording island");
    const island = surfaceWindow("island");
    await until(() => evaluate(island, '!!document.querySelector("[data-island]")'));
    // Cells stay mounted so opening can animate, but are hidden and unreachable until then.
    const islandView = await evaluate(
      island,
      `(() => {
      const cells = document.querySelector('[data-island] [aria-pressed]');
      const layer = cells && cells.closest('[inert]');
      return {mode:document.querySelector('[data-island]').dataset.island, hidden:!!layer && getComputedStyle(layer).opacity === '0'};
    })()`,
    );
    assert.notEqual(islandView.mode, "open", "The island only opens when hovered");
    assert.equal(islandView.hidden, true);
    // Changes from the island apply to the recording in progress, not the quick-start setup.
    const before = await evaluate(island, "window.chord.desktop.getState()");
    const quality = before.recording.target.setup.quality === "max" ? "standard" : "max";
    await evaluate(
      island,
      `window.chord.desktop.recording.update({quality:${JSON.stringify(quality)}})`,
    );
    const during = await evaluate(island, "window.chord.desktop.getState()");
    assert.equal(during.recording.target.setup.quality, quality);
    assert.equal(during.defaults.quality, before.defaults.quality);
    assert.ok(during.liveRevision > before.liveRevision);
    // The capture mode can change mid-recording too, but a recording can't be left with nothing to record.
    assert.equal(
      await evaluate(
        island,
        'window.chord.desktop.recording.update({mode:"area"}).then(()=>"accepted",e=>e.message)',
      ),
      "accepted",
    );
    assert.equal(
      (await evaluate(island, "window.chord.desktop.getState()")).recording.target.setup.mode,
      "area",
    );
    assert.equal(
      (await evaluate(island, "window.chord.desktop.getState()")).defaults.mode,
      before.defaults.mode,
      "Live changes leave the quick-start setup alone",
    );
    assert.match(
      await evaluate(
        island,
        'window.chord.desktop.recording.update({recordsScreen:false,cameraEnabled:false,microphoneEnabled:false,systemAudio:false}).then(()=>"accepted",e=>e.message)',
      ),
      /at least one source/,
    );
    await evaluate(island, 'window.chord.desktop.recording.update({mode:"display"})');
    await evaluate(main, "window.chord.desktop.recording.pause()");
    await evaluate(main, "window.chord.desktop.recording.addMark()");
    const paused = await evaluate(bar, "window.chord.desktop.getState()");
    assert.equal(paused.recording.phase, "paused");
    assert.equal(paused.recording.markCount, 1);
    await evaluate(bar, "window.chord.toolbar.show()");
    assert.equal(
      bar.isVisible(),
      false,
      "Shortcut during a recording should reveal its main-window controls",
    );
    assert.equal(main.isVisible(), true);
    await evaluate(bar, "window.chord.desktop.recording.quickStart()");
    assert.equal(main.isVisible(), true, "A rejected second start leaves the main window visible");
    // The central session survives closing and recreating the main renderer.
    main.close();
    await until(() => main.isDestroyed());
    await evaluate(bar, "window.chord.toolbar.show()");
    await until(() => surfaceWindow("main") && surfaceWindow("main") !== main);
    main = surfaceWindow("main");
    await until(() => evaluate(main, 'document.body.innerText.toLowerCase().includes("paused")'));
    await click(
      main,
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Finish recording'))`,
    );
    // The take is saved once the helper has finalized its files.
    // Saved to the project library in the app's data folder.
    const library = join(data, "projects");
    const stored = () =>
      existsSync(library)
        ? readdirSync(library)
            .filter((f) => f.endsWith(".json"))
            .map((f) => JSON.parse(readFileSync(join(library, f), "utf8")))
        : [];
    await until(() => stored().length === 1, "take to be saved");
    const projects = stored();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].recordings.length, 1);
    assert.equal(projects[0].recordings[0].markCount, 1);
    assert.equal(projects[0].setup.mode, "display");
    await until(() => !island.isVisible(), "island to hide once the recording finishes");
    await evaluate(main, "window.chord.toolbar.show()");
    await until(() => bar.isVisible());
    escape(bar);
    await until(() => !bar.isVisible());
    // A kept selection with its source switched off must not leave an empty preview's bottom padding.
    writeFileSync(
      sourcesPath,
      JSON.stringify({
        displays: [],
        applications: [],
        windows: [],
        microphones: [],
        cameras: [{ id: "test-camera", name: "Test camera", isDefault: true, formats: [] }],
      }),
    );
    for (const win of BrowserWindow.getAllWindows())
      win.webContents.send("helper:notification", "devicesChanged", {});
    await evaluate(
      main,
      'window.chord.desktop.updateDefaults({cameraIds:["test-camera"],cameraEnabled:false})',
    );
    await evaluate(main, "window.chord.toolbar.show()");
    await until(() => evaluate(bar, 'document.body.innerText.includes("Test camera")'));
    await openMenu(bar, "Camera");
    const spacing = await evaluate(
      bar,
      `(() => {
      const button = document.querySelector('[role=menuitemcheckbox]');
      const row = button.getBoundingClientRect();
      const item = button.parentElement.getBoundingClientRect();
      return {top:row.top-item.top, bottom:item.bottom-row.bottom};
    })()`,
    );
    assert.ok(
      spacing.top <= 1 && spacing.bottom <= 1,
      `Single camera option should have no empty preview padding: ${JSON.stringify(spacing)}`,
    );
    escape(bar);
    await menuClosed(bar, "Escape to close the camera dropdown");
    // A quick start with the main window closed must not create one merely to hide it.
    main.close();
    await until(() => main.isDestroyed());
    await evaluate(bar, "window.chord.desktop.recording.quickStart()");
    await until(() => island.isVisible(), "quick-start island without a main window");
    assert.equal(surfaceWindow("main"), undefined);
    assert.equal(bar.isVisible(), false);
    await evaluate(island, "window.chord.desktop.recording.stop()");
    await until(() => surfaceWindow("main")?.isVisible(), "finishing to reopen the main window");
    assert.deepEqual(rendererErrors, [], "Pages must not throw uncaught errors");
    console.log(
      "PASS: separate windows, in-page dropdowns with room beside the toolbar, outside clicks and app deactivation, dropdown toggles, shared defaults, preview ownership, centralized recording, recording island, live changes, saved take, Escape",
    );
    app.quit();
  } catch (error) {
    console.error(error);
    for (const w of BrowserWindow.getAllWindows()) {
      console.error(
        w.webContents.getURL(),
        w.isVisible(),
        await evaluate(
          w,
          "(async()=>({text:document.body.innerText,state:window.chord && await window.chord.desktop.getState()}))()",
        ).catch((e) => String(e)),
      );
    }
    app.exit(1);
  }
});
