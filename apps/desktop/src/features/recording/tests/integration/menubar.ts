// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/recording/tests/integration/menubar.ts
import { app, BrowserWindow, screen } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

// Overlay hit testing must use the same pointer as sendInputEvent, not the developer's physical cursor.
let cursor = { x: 0, y: 0 };
const data = mkdtempSync(join(tmpdir(), "chord-menubar-test-"));
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
// Allowed, so the cells' menus can open; previews only start inside them.
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
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => unknown | Promise<unknown>, message = "UI state") {
  for (let i = 0; i < 120; i++) {
    if (await check()) return;
    await pause(50);
  }
  throw new Error(`Timed out waiting for ${message}`);
}
const evaluate = async (win: BrowserWindow, expression: string) => {
  try {
    return await win.webContents.executeJavaScript(expression);
  } catch (error) {
    throw new Error(`Renderer expression failed: ${expression}`, { cause: error });
  }
};
const surfaceWindow = (kind: string) =>
  BrowserWindow.getAllWindows().find(
    (w) => new URL(w.webContents.getURL() || "about:blank").searchParams.get("surface") === kind,
  )!;
const escape = (win: BrowserWindow) => {
  // Test renderer propagation without macOS interpreting Escape as dismissal of its non-activating panel.
  return evaluate(
    win,
    `(() => {
    const target = document.activeElement ?? document.body;
    for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, {key:'Escape', bubbles:true, cancelable:true}));
  })()`,
  );
};
// Dropdowns open in the page of the window they belong to.
const menuOpen = (win: BrowserWindow) => evaluate(win, '!!document.querySelector("[role=menu]")');
async function openMenu(win: BrowserWindow, kind: string) {
  await evaluate(
    win,
    `document.querySelector('[data-source-toggle="${kind.toLowerCase()}"] + [data-popup-trigger]').click()`,
  );
  await until(() => menuOpen(win), `${kind} menu`);
  await pause(200); // Let the entrance animation finish before measuring or clicking.
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
  const bounds = win.getBounds();
  cursor = { x: bounds.x + point.x, y: bounds.y + point.y };
  win.focus();
  await pause(50); // Let the overlay's cursor poll enable mouse events before the synthetic click.
  win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
  win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
}
async function screenshot(win: BrowserWindow, label: string) {
  if (!process.env.CHORD_TEST_SCREENSHOTS) return;
  mkdirSync(process.env.CHORD_TEST_SCREENSHOTS, { recursive: true });
  writeFileSync(
    join(process.env.CHORD_TEST_SCREENSHOTS, `${label}.png`),
    (await win.webContents.capturePage()).toPNG(),
  );
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

// The menu bar icon is the only way to open the panel, so the test keeps hold of it to click it.
import electron from "electron";
const trays: Electron.Tray[] = [];
const { on } = electron.Tray.prototype;
electron.Tray.prototype.on = new Proxy(on, {
  apply(target, tray: Electron.Tray, args: unknown[]) {
    if (!trays.includes(tray)) trays.push(tray);
    return Reflect.apply(target, tray, args);
  },
});
const panelRect = (win: BrowserWindow) =>
  evaluate(
    win,
    `(() => { const r = document.querySelector('[data-menubar]').getBoundingClientRect(); return {x:r.x, y:r.y, width:r.width, height:r.height}; })()`,
  );
async function clickTray() {
  const panel = surfaceWindow("menubar");
  if (panel) {
    const bounds = panel.getBounds();
    const rect = await panelRect(panel);
    cursor = { x: bounds.x + rect.x + rect.width / 2, y: bounds.y + rect.y + rect.height / 2 };
  }
  trays[0].emit("click");
}

app.whenReady().then(async () => {
  try {
    screen.getCursorScreenPoint = () => cursor;
    if (process.platform !== "darwin") {
      console.log("SKIP: the menu bar panel is macOS only");
      app.quit();
      return;
    }
    // Projects kept in the renderer before the library existed are imported from the main window.
    await import(
      pathToFileURL(resolve(import.meta.dirname, "../../../../../out/main/index.js")).href
    );
    await until(() => surfaceWindow("main"));
    let main = surfaceWindow("main");
    await until(() => evaluate(main, '!!window.chord && !!document.querySelector("button")'));
    await until(() => evaluate(main, "window.chord.desktop.getState().then(s=>!!s.defaults)"));
    assert.equal(trays.length, 1, "One menu bar icon");
    assert.equal(app.dock!.isVisible(), true, "The main window has a Dock icon at launch");
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

    // Opening: the home screen under the icon, with room for dropdowns on the roomier side.
    await pause(500); // Let macOS finish positioning the temporary tray icon.
    await clickTray();
    await until(() => surfaceWindow("menubar")?.isVisible(), "panel to show");
    const panel = surfaceWindow("menubar");
    assert.equal(
      app.dock!.isVisible(),
      true,
      "Opening the menu bar panel keeps the main window in the Dock",
    );
    await until(() =>
      evaluate(
        panel,
        '!!document.querySelector("[data-menubar]") && document.body.innerText.includes("Projects")',
      ),
    );
    // The compact cells show only their state, so they're found by their switches.
    await until(
      () =>
        evaluate(
          panel,
          `['screen','camera','microphone'].every(kind => document.querySelector('[data-source-toggle="' + kind + '"]'))`,
        ),
      "the source cells",
    );
    const state = await evaluate(panel, "window.chord.desktop.getState()");
    assert.equal(state.menubar.visible, true);
    const frame = panel.getBounds();
    const rect = await panelRect(panel);
    const icon = trays[0].getBounds();
    assert.ok(
      frame.width >= rect.width + 416,
      "The window keeps room beside the panel for the widest dropdown",
    );
    assert.equal(
      rect.x === 0,
      state.menubar.side === "right",
      "The panel sits away from its dropdown room",
    );
    if (icon.width > 0)
      assert.ok(
        Math.abs(frame.x + rect.x + rect.width / 2 - (icon.x + icon.width / 2)) <= 1 ||
          frame.x + rect.x + rect.width >=
            screen.getDisplayMatching(icon).workArea.x +
              screen.getDisplayMatching(icon).workArea.width -
              8,
        "Centered under the icon unless near the edge",
      );
    const text = await evaluate(panel, "document.body.innerText");
    for (const expected of ["Record", "New project", "Projects", "System audio"] as const)
      assert.ok(text.includes(expected), `The panel shows ${expected}`);
    await screenshot(panel, "menubar");

    // A cell's menu opens beside the panel, clear of it, without moving or resizing the window.
    await openMenu(panel, "Camera");
    assert.deepEqual(
      panel.getBounds(),
      frame,
      "Opening a dropdown must not resize or move the window",
    );
    const menu = await evaluate(
      panel,
      `(()=>{const r=document.querySelector('[role=menu]').getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`,
    );
    if (state.menubar.side === "left")
      assert.ok(
        menu.right <= rect.x - 6,
        `The dropdown opens left of the panel: ${JSON.stringify({ menu, rect })}`,
      );
    else
      assert.ok(
        menu.left >= rect.x + rect.width + 6,
        `The dropdown opens right of the panel: ${JSON.stringify({ menu, rect })}`,
      );
    assert.ok(menu.top >= 0 && menu.bottom <= frame.height, "The dropdown fits in the window");
    await screenshot(panel, "menubar-dropdown");
    await escape(panel);
    await menuClosed(panel, "Escape to close the dropdown");
    assert.equal(panel.isVisible(), true, "Escape closes a dropdown before the panel");

    // Changes in the panel are the quick-start setup the main window shows.
    await evaluate(panel, `document.querySelector('[aria-label^="System audio"]').click()`);
    const audio = (await evaluate(panel, "window.chord.desktop.getState()")).defaults.systemAudio;
    await until(() =>
      evaluate(
        main,
        `window.chord.desktop.getState().then(s=>s.defaults.systemAudio === ${audio})`,
      ),
    );

    // New project opens it in the main window, saved to the library, and hides the panel.
    await evaluate(
      panel,
      `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('New project')).click()`,
    );
    await until(() => !panel.isVisible(), "panel to hide when leaving home");
    await until(
      () =>
        evaluate(
          main,
          'document.body.innerText.includes("Untitled project") && !!document.querySelector("[aria-label=Projects]")',
        ),
      "main window to show the new project",
    );
    const library = join(data, "projects");
    await until(
      () =>
        existsSync(library) && readdirSync(library).filter((f) => f.endsWith(".json")).length === 1,
      "project file",
    );

    // The panel lists it, kept in step with the main window.
    await evaluate(
      main,
      `(() => { const input = document.querySelector('input'); input.value = 'Launch video'; input.dispatchEvent(new Event('input', {bubbles:true})); })()`,
    );
    await clickTray();
    await until(() => panel.isVisible(), "panel to show again");
    await until(
      () => evaluate(panel, 'document.body.innerText.includes("Launch video")'),
      "renamed project in the panel",
    );
    const listed = await evaluate(
      panel,
      'document.querySelectorAll("[data-projects] > div > button:first-child").length',
    );
    assert.equal(listed, 1);

    // Project controls fill both rows, with one height and a custom, keyboard-accessible sort select.
    await evaluate(
      panel,
      'document.querySelector("[role=combobox]").scrollIntoView({block:"center"})',
    );
    const controlRects = await evaluate(
      panel,
      `(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {left:r.left, right:r.right, top:r.top, height:r.height}; };
      return {search:rect('input[placeholder="Search projects, notes, and recordings"]'), sort:rect('[role=combobox][aria-label=Sort]'), view:rect('[aria-label="Project view"]')};
    })()`,
    );
    assert.equal(controlRects.sort.left, controlRects.search.left);
    assert.equal(
      controlRects.view.right,
      controlRects.search.right,
      "The controls fill the search field width",
    );
    assert.equal(controlRects.sort.top, controlRects.view.top);
    assert.equal(controlRects.sort.height, 32, "The compact sort control is 32 px tall");
    assert.equal(controlRects.sort.height, controlRects.search.height);
    assert.equal(controlRects.sort.height, controlRects.view.height);
    await screenshot(panel, "menubar-projects");

    // Distinct creation/update dates make every sorting choice observable.
    await evaluate(
      main,
      `window.chord.desktop.projects.load().then(([project]) => window.chord.desktop.projects.put([
      {...project, id:'sort-alpha', name:'Alpha', createdAt:'2024-01-01', updatedAt:'2024-02-01'},
      {...project, id:'sort-zulu', name:'Zulu', createdAt:'2024-02-01', updatedAt:'2024-01-01'},
    ]))`,
    );
    const projectNames = () =>
      evaluate(
        panel,
        `Array.from(document.querySelectorAll('[data-projects] > div > button:first-child .truncate.text-sm.font-medium')).map(e => e.textContent.trim())`,
      );
    await until(async () => (await projectNames()).length === 3);
    assert.deepEqual(await projectNames(), ["Launch video", "Alpha", "Zulu"]);
    const press = (keyCode: string) => {
      panel.webContents.sendInputEvent({ type: "keyDown", keyCode });
      panel.webContents.sendInputEvent({ type: "keyUp", keyCode });
    };
    const sortOpen = () => evaluate(panel, '!!document.querySelector("[role=listbox]")');
    await clickAt(panel, "[role=combobox][aria-label=Sort]");
    await until(sortOpen, "sort options");
    await pause(200); // Let the entrance animation finish before measuring.
    const sortBounds = await evaluate(
      panel,
      `(() => {
      const trigger = document.querySelector('[role=combobox]').getBoundingClientRect();
      const list = document.querySelector('[role=listbox]').getBoundingClientRect();
      return {triggerWidth:trigger.width, listWidth:list.width, left:list.left, right:list.right, top:list.top, bottom:list.bottom};
    })()`,
    );
    assert.equal(
      sortBounds.listWidth,
      sortBounds.triggerWidth,
      "Floating UI matches the select width",
    );
    assert.ok(
      sortBounds.left >= rect.x && sortBounds.right <= rect.x + rect.width,
      "Sort options stay inside the panel",
    );
    assert.ok(
      sortBounds.top >= 0 && sortBounds.bottom <= frame.height,
      "Sort options fit the window",
    );
    await screenshot(panel, "menubar-project-sort");
    press("End");
    press("Return");
    await until(async () => !(await sortOpen()));
    assert.deepEqual(await projectNames(), ["Alpha", "Launch video", "Zulu"]);
    assert.equal(
      await evaluate(panel, 'document.activeElement.getAttribute("role")'),
      "combobox",
      "Selection keeps focus on the select",
    );
    press("Up");
    await until(sortOpen);
    press("Home");
    press("Down");
    press("Return");
    await until(async () => !(await sortOpen()));
    assert.deepEqual(await projectNames(), ["Launch video", "Zulu", "Alpha"]);
    await clickAt(panel, "[role=combobox][aria-label=Sort]");
    await until(sortOpen, "sort options");
    await pause(200);
    await clickAt(panel, "[role=option]:first-child");
    await until(async () => !(await sortOpen()));
    assert.deepEqual(await projectNames(), ["Launch video", "Alpha", "Zulu"]);
    await clickAt(panel, "[role=combobox][aria-label=Sort]");
    press("n");
    press("Return");
    await until(async () => !(await sortOpen()));
    assert.deepEqual(
      await projectNames(),
      ["Alpha", "Launch video", "Zulu"],
      "Typing finds a sort option",
    );
    await clickAt(panel, "[role=combobox][aria-label=Sort]");
    await escape(panel);
    await until(async () => !(await sortOpen()));
    assert.equal(panel.isVisible(), true, "Escape dismisses the sort before the menu bar panel");
    await clickAt(panel, "[role=combobox][aria-label=Sort]");
    press("Tab");
    await until(async () => !(await sortOpen()));
    assert.equal(
      await evaluate(panel, 'document.activeElement.getAttribute("aria-label")'),
      "Grid view",
      "Tab continues to the next control",
    );
    await clickAt(panel, "[role=combobox][aria-label=Sort]");
    await clickAt(panel, "h2");
    await until(async () => !(await sortOpen()), "outside click to close sort");
    await evaluate(main, 'window.chord.desktop.projects.remove(["sort-alpha", "sort-zulu"])');
    await until(async () => (await projectNames()).length === 1);

    // Opening the panel starts at the top, while ordinary desktop updates preserve the scroll position.
    const scrollTop = () =>
      evaluate(panel, 'document.querySelector("[data-menubar] .overflow-y-auto").scrollTop');
    await evaluate(
      panel,
      'document.querySelector("[data-menubar] .overflow-y-auto").scrollTop = 150',
    );
    await until(async () => (await scrollTop()) > 0, "panel to scroll");
    const scrolled = await scrollTop();
    await evaluate(
      panel,
      "window.chord.desktop.getState().then(s => window.chord.desktop.updateDefaults({showsSystemUI: !s.defaults.showsSystemUI}))",
    );
    await evaluate(
      panel,
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    assert.equal(
      await scrollTop(),
      scrolled,
      "Desktop state updates keep the current scroll position",
    );
    await clickTray();
    await until(() => !panel.isVisible());
    await pause(400); // Allow the native blur/reopen debounce to settle.
    await clickTray();
    await until(() => panel.isVisible());
    await until(async () => (await scrollTop()) === 0, "reopened panel to scroll to the top");

    // Settings and projects open in the main window.
    await evaluate(main, `document.querySelector('[aria-label=Projects]').click()`);
    await until(
      () => evaluate(main, '!document.querySelector("[aria-label=Projects]")'),
      "main window back home",
    );
    await evaluate(panel, `document.querySelector('[aria-label=Settings]').click()`);
    await until(() => !panel.isVisible());
    await until(
      () => evaluate(main, '!!document.querySelector("#settings-panel-general")'),
      "settings in the main window",
    );
    await clickTray();
    await until(() => panel.isVisible());
    await evaluate(
      panel,
      `document.querySelector('[data-projects] > div > button:first-child').click()`,
    );
    await until(() => !panel.isVisible());
    await until(
      () =>
        evaluate(
          main,
          'document.body.innerText.includes("Launch video") && !!document.querySelector("[aria-label=Projects]")',
        ),
      "project in the main window",
    );

    // The logo opens home in the main window even when it currently shows a project.
    await clickTray();
    await until(() => panel.isVisible());
    await clickAt(panel, '[aria-label="Open Chord home"] svg');
    await until(() => !panel.isVisible(), "logo to close the panel");
    await until(
      () =>
        evaluate(
          main,
          '!!document.querySelector("[data-projects]") && !document.querySelector("[aria-label=Projects]")',
        ),
      "logo to open home in the main window",
    );

    // The main window uses one full row, and wraps into two full rows when narrowed.
    const mainBounds = main.getBounds();
    for (const width of [1100, 480] as const) {
      main.setContentSize(width, 800);
      await evaluate(
        main,
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      );
      const controls = await evaluate(
        main,
        `(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {left:r.left, right:r.right, top:r.top, height:r.height}; };
        // Classic scrollbars take width from the scrolling container, not the window.
        const contentWidth = () => {
          let parent = document.querySelector('[aria-label="Project view"]').parentElement;
          while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
          return parent ? parent.getBoundingClientRect().left + parent.clientWidth : innerWidth;
        };
        return {search:rect('input[placeholder="Search projects, notes, and recordings"]'), sort:rect('[role=combobox][aria-label=Sort]'), view:rect('[aria-label="Project view"]'), width:contentWidth()};
      })()`,
      );
      assert.equal(controls.search.left, 32);
      assert.equal(
        controls.view.right,
        controls.width - 32,
        "The toolbar fills the main window content width",
      );
      assert.equal(controls.search.height, controls.sort.height);
      assert.equal(controls.sort.height, controls.view.height);
      if (width === 1100) assert.equal(controls.search.top, controls.sort.top);
      else {
        assert.ok(controls.sort.top > controls.search.top);
        assert.equal(controls.sort.left, controls.search.left);
        assert.equal(controls.view.right, controls.search.right);
      }
      await evaluate(
        main,
        'document.querySelector("[role=combobox]").scrollIntoView({block:"center"})',
      );
      await screenshot(main, `projects-${width}`);
    }
    main.setBounds(mainBounds);

    // Escape hides the panel; clicking the icon toggles it.
    await clickTray();
    await until(() => panel.isVisible());
    await escape(panel);
    await until(() => !panel.isVisible(), "Escape to hide the panel");
    await pause(400);
    await clickTray();
    await until(() => panel.isVisible());
    await clickTray();
    await until(() => !panel.isVisible(), "a second click to hide the panel");

    // Reopening the main window from the panel restores its Dock icon, even from a menu-bar-only state.
    main.close();
    await until(() => main.isDestroyed());
    await until(() => !app.dock!.isVisible(), "Dock icon to hide when the main window closes");
    await pause(400);
    await clickTray();
    await until(() => panel.isVisible());
    assert.equal(app.dock!.isVisible(), false, "The menu bar panel works without a Dock icon");
    await clickAt(panel, '[aria-label="Open Chord home"] svg');
    await until(() => surfaceWindow("main")?.isVisible(), "main window to reopen from the panel");
    main = surfaceWindow("main");
    await until(
      () =>
        evaluate(
          main,
          '!!document.querySelector("[data-projects]") && !document.querySelector("[aria-label=Projects]")',
        ),
      "home in the recreated main window",
    );
    await until(() => app.dock!.isVisible(), "Dock icon for the recreated main window");
    assert.equal(panel.isVisible(), false);

    // Other utility windows must preserve the Dock icon too, including while the main window is minimized.
    main.minimize();
    await until(() => main.isMinimized());
    await evaluate(main, "window.chord.toolbar.show()");
    await until(() => surfaceWindow("toolbar")?.isVisible());
    assert.equal(
      app.dock!.isVisible(),
      true,
      "Opening the toolbar keeps the minimized main window in the Dock",
    );
    assert.equal(main.isMinimized(), true, "Opening the toolbar preserves the main window state");

    assert.deepEqual(rendererErrors, [], "Pages must not throw uncaught errors");
    console.log(
      "PASS: menu bar icon, panel placement, dropdowns beside the panel, shared setup, project library, full-width project controls, custom sorting with pointer and keyboard, opening screens in the main window, Dock visibility, Escape",
    );
    app.quit();
  } catch (error) {
    console.error(error);
    for (const w of BrowserWindow.getAllWindows()) {
      console.error(
        w.webContents.getURL(),
        w.isVisible(),
        await evaluate(w, "document.body.innerText").catch((e) => String(e)),
      );
    }
    app.exit(1);
  }
});
