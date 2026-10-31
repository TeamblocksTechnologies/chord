// Run: env -u ELECTRON_RUN_AS_NODE pnpm exec electron tests/integration/ui-composables.ts
// Exercises real Svelte lifecycles and native pointer capture without starting the recorder.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { eventually } from "../support/integration.ts";
const fixture = mkdtempSync(join(import.meta.dirname, ".ui-composables-"));
app.setPath("userData", join(fixture, "user-data"));
app.on("quit", () =>
  rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
);
const sources = {
  "components/ProjectExports.svelte": "../../src/features/exporting/renderer/ProjectExports.svelte",
  "lib/apps.svelte.ts": "../../src/features/recording/renderer/apps.svelte.ts",
  "lib/recordingJobState.svelte.ts":
    "../../src/project-document/renderer/recordingJobState.svelte.ts",
  "lib/clipLayoutEditor.ts": "../../src/features/editing/renderer/layout/clipLayoutEditor.ts",
  "lib/playback/cutEditor.svelte.ts":
    "../../src/features/editing/renderer/transcript/cutEditor.svelte.ts",
  "lib/liveList.svelte.ts": "../../src/shared/renderer/liveList.svelte.ts",
  "lib/paintSelection.ts": "@teamblocks.dev/chord-ui/paintSelection",
  "lib/pointerDrag.ts": "@teamblocks.dev/chord-ui/pointerDrag",
  "components/ConfirmDialog.svelte": "@teamblocks.dev/chord-ui/ConfirmDialog.svelte",
  "components/SliderField.svelte": "@teamblocks.dev/chord-ui/SliderField.svelte",
  "components/BackgroundReplacementControls.svelte":
    "../../src/features/background-removal/renderer/BackgroundReplacementControls.svelte",
};
const source = (name: keyof typeof sources) =>
  JSON.stringify(
    sources[name].startsWith("@") ? sources[name] : resolve(import.meta.dirname, sources[name]),
  );

app.whenReady().then(async () => {
  try {
    const [{ build }, { svelte }] = await Promise.all([
      import("vite"),
      import("@sveltejs/vite-plugin-svelte"),
    ]);
    writeFileSync(
      join(fixture, "index.html"),
      '<div id="app"></div><script type="module" src="./main.js"></script>',
    );
    writeFileSync(
      join(fixture, "main.js"),
      `import { mount, unmount } from 'svelte';
      window.catalogueCalls = { installed: 0, running: 0 };
      window.exportItems = ['first','second'].map(name => ({name:name+'.mp4',path:'/'+name+'.mp4',createdAt:Date.now()}));
      window.exportTrashed = [];
      window.activePolls = new Set();
      const interval = window.setInterval.bind(window), clear = window.clearInterval.bind(window);
      window.setInterval = (callback, ms) => { const id = interval(callback, ms); if (ms === 2000) activePolls.add(id); return id; };
      window.clearInterval = id => { activePolls.delete(id); clear(id); };
      window.chord = { surface: 'fixture',
        installedApps: async () => { catalogueCalls.installed++; return []; },
        runningApps: async () => { catalogueCalls.running++; return []; }, appIcons: async () => ({}),
        helper: { request: async () => ({displays:[],applications:[],windows:[],microphones:[],cameras:[]}), onNotification: () => () => {} },
        desktop: {
          export: { list: async () => [...exportItems], trash: async path => { exportTrashed.push(path); window.exportItems = exportItems.filter(item => item.path !== path); } },
          projects: { onChange: () => () => {}, load: async () => [], put: async () => {}, remove: async () => {} } },
      };
      const { default: Harness } = await import('./Harness.svelte');
      const instance = mount(Harness, { target: document.getElementById('app') });
      window.unmountHarness = () => unmount(instance);`,
    );
    writeFileSync(
      join(fixture, "Harness.svelte"),
      `<script>
      import { observeAppCatalogue } from ${source("lib/apps.svelte.ts")};
      import { observeRecordingJobs } from ${source("lib/recordingJobState.svelte.ts")};
      import { ClipLayoutEditor } from ${source("lib/clipLayoutEditor.ts")};
      import { CutEditor } from ${source("lib/playback/cutEditor.svelte.ts")};
      import { LiveList } from ${source("lib/liveList.svelte.ts")};
      import { PaintSelection } from ${source("lib/paintSelection.ts")};
      import { pointerDrag } from ${source("lib/pointerDrag.ts")};
      import ProjectExports from ${source("components/ProjectExports.svelte")};
      import ConfirmDialog from ${source("components/ConfirmDialog.svelte")};
      import SliderField from ${source("components/SliderField.svelte")};
      import BackgroundReplacementControls from ${source("components/BackgroundReplacementControls.svelte")};
      let mounted = $state(true), showDialog = $state(false), hidden = $state([]), volume = $state(0.45);
      let background = $state({ replacement: 'blur', blur: 8, color: '#112233' });
      const trace = { moves: [], ends: [], closed: 0, calls: 0, off: 0 };
      observeAppCatalogue(); observeAppCatalogue();
      let jobProject = $state({ id: 'one', recordings: [{ directory: '/a' }] });
      const states = $state({}), loads = [], pending = new Map();
      let jobEvent, jobOff = 0;
      observeRecordingJobs({
        project: () => jobProject, load: directory => { loads.push(directory); return new Promise(resolve => pending.set(directory, resolve)); },
        subscribe: receive => { jobEvent = receive; return () => jobOff++; },
        has: directory => !!states[directory], receive: state => states[state.directory] = state,
      });
      let editProject = $state({ id: 'edit', recordings: [{ id: 'r', duration: 10 }], pieces: [{ id: 'p', recordingId: 'r', start: 0, end: null }] });
      const layouts = new ClipLayoutEditor(() => editProject);
      const available = [{ id: 'screen', kind: 'screen' }, { id: 'camera', kind: 'camera' }];
      const cuts = new CutEditor({ project: () => editProject, player: () => ({ loading: false, time: 0, parts: [], timeline: () => ({ duration: 10 }) }), recordingId: () => 'r' });
      let resolveInitial, receive, complete, fail;
      const live = new LiveList(() => new Promise(resolve => resolveInitial = resolve), callback => { receive = callback; return () => trace.off++; });
      const painting = new PaintSelection(id => hidden.includes(id), (ids, selected) => { hidden = selected ? [...new Set([...hidden, ...ids])] : hidden.filter(id => !ids.includes(id)); });
      const drag = pointerDrag(() => ({ move: (_event, delta) => trace.moves.push(delta), end: cancelled => trace.ends.push(cancelled) }));
      window.harness = {
        jobs: { loads, event: state => jobEvent(state), resolve: (directory, state) => pending.get(directory)(state),
          states: () => JSON.parse(JSON.stringify(states)), off: () => jobOff,
          clone: () => { jobProject = {...jobProject}; }, open: (id, directory) => { jobProject = {id, recordings:[{directory}]}; } },
        edits: { frame: patch => layouts.updateFeed('p', available, 'camera', patch), layout: () => JSON.parse(JSON.stringify(editProject.pieces[0].layout)),
          recut: () => cuts.recut('r', [{start:1,end:2}]), canUndo: () => cuts.canUndo, undo: () => cuts.undo(),
          clone: () => { editProject = {...editProject, recordings: editProject.recordings.map(recording => ({...recording}))}; },
          cuts: () => editProject.recordings[0].cuts ?? [] },
        trace, receive: value => receive(value), initial: value => resolveInitial(value), list: () => [...live.list],
        hidden: () => [...hidden], volume: () => volume, background: () => ({...background}),
        removeDrag: () => mounted = false, dialog: () => showDialog = true, removeDialog: () => showDialog = false,
        complete: () => complete(), fail: () => fail(new Error('Try again')),
        confirm: () => { trace.calls++; return new Promise((resolve, reject) => { complete = resolve; fail = reject; }); },
      };
    </script>
    <style>button { padding: 12px; } #drag { width: 200px; height: 40px; margin-top: 20px; background: silver; touch-action: none; }</style>
    {#each ['a', 'b', 'c'] as id}<button id={id} onpointerdown={event => painting.down(event, id)} onpointerenter={event => painting.enter(event, id)} onclick={event => painting.click(event, id)}>{id}</button>{/each}
    <SliderField label="Volume" value={volume} min={0} max={1} step={0.01} scale={100} suffix="%" onchange={value => volume = value} />
    <BackgroundReplacementControls value={background} onchange={patch => background = {...background, ...patch}} />
    <ProjectExports folder="/exports" />
    {#if mounted}<div id="drag" {@attach drag}></div>{/if}
    {#if showDialog}<ConfirmDialog title="Delete fixture?" confirmLabel="Delete" onconfirm={window.harness.confirm} onclose={() => { trace.closed++; showDialog = false; }}>Fixture description</ConfirmDialog>{/if}`,
    );
    await build({
      configFile: false,
      root: fixture,
      base: "./",
      plugins: [svelte()],
      logLevel: "error",
      build: { outDir: "dist", emptyOutDir: true },
    });
    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: { backgroundThrottling: false },
    });
    const errors: string[] = [];
    win.webContents.on("console-message", (event) => {
      if (event.level === "error") {
        errors.push(event.message);
        console.error("Renderer:", event.message);
      }
    });
    const run = async (expression: string) => {
      try {
        return await win.webContents.executeJavaScript(expression);
      } catch (error) {
        throw new Error(
          `${expression}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    };
    const frame = () =>
      run("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const click = async (selector: string) => {
      await run(`document.querySelector(${JSON.stringify(selector)}).click()`);
      await frame();
    };
    const pointer = async (id: string, type: string, pointerId = 1) => {
      await run(
        `document.getElementById('${id}').dispatchEvent(new PointerEvent('${type}', { bubbles: true, pointerId: ${pointerId}, button: 0 }))`,
      );
      await frame();
    };
    await win.loadFile(join(fixture, "dist/index.html"));
    await frame();
    assert.deepEqual(
      await run("window.catalogueCalls"),
      { installed: 2, running: 2 },
      "Two pickers share one refresh in addition to the eager catalogue preload",
    );
    assert.equal(await run("activePolls.size"), 1, "Mounted pickers share one poller");
    await run(`harness.edits.frame({scale:2}); harness.edits.frame({x:0.2})`);
    await frame();
    const layout = await run("harness.edits.layout()");
    assert.equal(layout.feeds.camera.scale, 2);
    assert.equal(layout.feeds.camera.x, 0.2);
    assert.deepEqual(
      layout.sources,
      ["screen", "camera"],
      "Editing a feed preserves default source resolution",
    );
    await run("harness.edits.recut()");
    await frame();
    assert.equal(await run("harness.edits.canUndo()"), true);
    await run("harness.edits.clone()");
    await frame();
    assert.equal(
      await run("harness.edits.canUndo()"),
      true,
      "Persistence replacing the project object preserves valid undo",
    );
    await run("harness.edits.undo()");
    await frame();
    assert.deepEqual(await run("harness.edits.cuts()"), []);
    await run(
      `harness.jobs.event({directory:'/a', phase:'done'}); harness.jobs.resolve('/a', {directory:'/a',phase:'idle'})`,
    );
    await frame();
    assert.equal(
      (await run("harness.jobs.states()"))["/a"].phase,
      "done",
      "Initial job reads preserve newer live events",
    );
    await run("harness.jobs.clone()");
    await frame();
    assert.deepEqual(
      await run("harness.jobs.loads"),
      ["/a"],
      "Replacing the project object does not repeat job reads",
    );
    await run(`harness.jobs.open('two','/b')`);
    await frame();
    await run(`harness.jobs.open('three','/c')`);
    await frame();
    await run(`harness.jobs.resolve('/b',{directory:'/b',phase:'idle'})`);
    await frame();
    assert.equal(
      (await run("harness.jobs.states()"))["/b"],
      undefined,
      "A late read cannot update an inactive project",
    );
    await run(`harness.jobs.open('two','/b')`);
    await frame();
    assert.equal(
      (await run("harness.jobs.loads")).filter((directory: string) => directory === "/b").length,
      2,
      "Returning to an abandoned initial read retries it",
    );
    await run(`harness.receive(['new']); harness.initial(['old'])`);
    await frame();
    assert.deepEqual(
      await run("harness.list()"),
      ["new"],
      "A slow initial list cannot overwrite a live event",
    );
    await pointer("a", "pointerdown");
    await pointer("b", "pointerenter", 2);
    assert.deepEqual(
      await run("harness.hidden()"),
      ["a"],
      "Another pointer cannot join a paint gesture",
    );
    await pointer("b", "pointerenter");
    await pointer("b", "pointerup");
    await pointer("c", "pointerenter");
    assert.deepEqual(
      await run("harness.hidden()"),
      ["a", "b"],
      "Painting ends when the pointer is released",
    );
    await click("#a");
    assert.deepEqual(
      await run("harness.hidden()"),
      ["b"],
      "Keyboard-style activation toggles selection",
    );
    await pointer("b", "pointerdown");
    await run(`window.dispatchEvent(new Event('blur'))`);
    await pointer("c", "pointerenter");
    assert.deepEqual(await run("harness.hidden()"), [], "Losing focus ends a paint gesture");
    await run(
      `const input = document.querySelector('[aria-label="Volume"]'); input.value = '73'; input.dispatchEvent(new Event('input', {bubbles:true}))`,
    );
    await frame();
    assert.equal(await run("harness.volume()"), 0.73, "The slider returns model units");
    assert.match(await run(`document.querySelector('label').textContent`), /73%/);
    await click('[aria-label="Background replacement"] button:nth-child(2)');
    assert.equal((await run("harness.background()")).replacement, "color");
    assert.equal(await run(`!!document.querySelector('[aria-label="Background color"]')`), true);
    await click('[aria-label="Background replacement"] button:first-child');
    await run(
      `const blur = document.querySelector('[aria-label="Blur amount"]'); blur.value = '12'; blur.dispatchEvent(new Event('input', {bubbles:true}))`,
    );
    await frame();
    assert.equal(
      (await run("harness.background()")).blur,
      12,
      "Background edits patch only the changed value",
    );
    const point = await run(
      `(() => { const r = document.getElementById('drag').getBoundingClientRect(); return {x:Math.round(r.x+10),y:Math.round(r.y+10)}; })()`,
    );
    win.webContents.sendInputEvent({ type: "mouseMove", ...point });
    win.webContents.sendInputEvent({ type: "mouseDown", button: "left", clickCount: 1, ...point });
    win.webContents.sendInputEvent({
      type: "mouseMove",
      x: point.x + 30,
      y: point.y + 5,
      movementX: 30,
      movementY: 5,
    });
    // Native input arrives separately from scripts, so it may be handled a frame or two later.
    await eventually(
      async () =>
        assert.ok(
          (await run("harness.trace.moves")).some(
            (delta: { x: number; y: number }) => delta.x === 30 && delta.y === 5,
          ),
          "Native captured drags report deltas",
        ),
      "the drag to move",
    );
    await run("harness.removeDrag()");
    await frame();
    assert.deepEqual(
      await run("harness.trace.ends"),
      [true],
      "Unmount cancels a captured drag exactly once",
    );
    win.webContents.sendInputEvent({ type: "mouseUp", button: "left", clickCount: 1, ...point });
    const openDelete = async (path: string) => {
      await click(`[data-export="${path}"] button[aria-haspopup="menu"]`);
      await run(
        `[...document.querySelectorAll('[role=menuitem]')].find(item => item.textContent.trim() === 'Delete export').click()`,
      );
      await frame();
    };
    // Dialogs close on a timer once their exit transition ends (EXIT_MS in the UI package's dialog.ts). A longer
    // timer started after it in the page always runs after it, however slow the machine.
    const afterDialogExit = () => run("new Promise(resolve => setTimeout(resolve, 180))");
    await openDelete("/first.mp4");
    await click("dialog button:first-child");
    await openDelete("/second.mp4");
    assert.equal(
      await run('document.querySelector("dialog").open'),
      true,
      "Another export opens a fresh confirmation during the previous exit",
    );
    await afterDialogExit();
    assert.equal(
      await run('document.querySelector("dialog").open'),
      true,
      "The old close callback cannot dismiss a newer confirmation",
    );
    await click("dialog button:first-child");
    await openDelete("/second.mp4");
    assert.equal(
      await run('document.querySelector("dialog").open'),
      true,
      "The same export can be reopened during its exit",
    );
    await click("dialog button:last-child");
    await afterDialogExit();
    assert.deepEqual(
      await run("exportTrashed"),
      ["/second.mp4"],
      "Confirmation deletes only the current request",
    );
    await run("harness.dialog()");
    await frame();
    const confirm = `document.querySelector('dialog button:last-child').click()`;
    await run(confirm);
    await frame();
    assert.equal(await run('document.querySelector("dialog button").disabled'), true);
    assert.equal(
      await run(
        `document.querySelector('dialog').dispatchEvent(new Event('cancel', {cancelable:true}))`,
      ),
      false,
      "A pending confirmation cannot dismiss the dialog",
    );
    await run("harness.fail()");
    await frame();
    assert.equal(await run('document.querySelector("[role=alert]").textContent'), "Try again");
    assert.equal(
      await run("harness.trace.closed"),
      0,
      "Failed actions keep their confirmation open",
    );
    await run(confirm);
    await run("harness.complete()");
    await frame();
    await afterDialogExit();
    assert.equal(
      await run("harness.trace.closed"),
      1,
      "Successful actions close once after the exit transition",
    );
    await run("harness.dialog()");
    await frame();
    await run(confirm);
    await frame();
    await run("harness.removeDialog()");
    await frame();
    await run("harness.complete()");
    await frame();
    await afterDialogExit();
    assert.equal(
      await run("harness.trace.closed"),
      2,
      "Successful deletion still notifies when its caller unmounts first",
    );
    await run("window.unmountHarness()");
    await frame();
    assert.equal(await run("activePolls.size"), 0, "The last catalogue owner stops polling");
    assert.equal(await run("harness.trace.off"), 1, "Live lists unsubscribe on unmount");
    assert.equal(await run("harness.jobs.off()"), 1, "Job observers unsubscribe on unmount");
    await run(
      `harness.jobs.resolve('/b',{directory:'/b',phase:'done'}); harness.jobs.event({directory:'/b',phase:'done'}); harness.receive(['after unmount'])`,
    );
    await frame();
    assert.equal((await run("harness.jobs.states()"))["/b"], undefined);
    assert.deepEqual(await run("harness.list()"), ["new"], "Disposed state ignores late results");
    assert.deepEqual(errors, []);
    console.log(
      "PASS: catalogue ownership, job races and cleanup, layout updates, cut history, paint gestures, slider units, background controls, drag cleanup, asynchronous confirmation, retry and export-dialog reentry",
    );
    win.destroy();
    rmSync(fixture, { recursive: true, force: true });
    app.exit(0);
  } catch (error) {
    console.error(error);
    rmSync(fixture, { recursive: true, force: true });
    app.exit(1);
  }
});
