// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/recording/tests/integration/screen-preview.ts
import { app, BrowserWindow, nativeImage } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  click,
  evaluate,
  screenshot,
  settle,
  until,
} from "../../../../../tests/support/integration.ts";

const data = mkdtempSync(join(tmpdir(), "chord-screen-preview-"));
app.setPath("userData", data);
// The helper may still be flushing its final request log as Electron closes stdin.
app.on("quit", () =>
  rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
);
const log = join(data, "helper.log");
const controlPath = join(data, "control.json");
let control = { permission: "granted", alpha: false, fail: false };
const configure = (patch: Record<string, unknown>) => {
  control = { ...control, ...patch };
  writeFileSync(controlPath, JSON.stringify(control));
};
configure({});
const opaque = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8DwHwQBEPgD/U6VwW8AAAAASUVORK5CYII=",
  "base64",
);
const alpha = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAD0lEQVR4nGNgYPj/nwEIAAr+Af/hHqJQAAAAAElFTkSuQmCC",
  "base64",
);
writeFileSync(join(data, "opaque.png"), opaque);
writeFileSync(join(data, "alpha.png"), alpha);
const fixture = join(data, "helper.cjs");
writeFileSync(
  fixture,
  `#!/usr/bin/env node
const { appendFileSync, readFileSync, createWriteStream } = require('node:fs');
const frames = createWriteStream(null, { fd: 3 });
const config = () => JSON.parse(readFileSync(${JSON.stringify(controlPath)}, 'utf8'));
const image = name => readFileSync(${JSON.stringify(data)} + '/' + name);
let previews = [];
function sendFrame(preview) {
  const name = Buffer.from(preview.id);
  const c = config();
  const bytes = image(preview.background === 'transparent' ? (c.alpha ? 'alpha.png' : 'opaque.png') : 'opaque.jpg');
  const frame = Buffer.alloc(8 + name.length + bytes.length);
  frame.writeUInt32BE(name.length, 0);
  name.copy(frame, 4);
  frame.writeUInt32BE(bytes.length, 4 + name.length);
  bytes.copy(frame, 8 + name.length);
  // Fragment the header and body to exercise the real pipe reader.
  frames.write(frame.subarray(0, 3));
  frames.write(frame.subarray(3, 11));
  frames.write(frame.subarray(11));
}
setInterval(() => previews.forEach(sendFrame), 50).unref();
process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'ready',params:{version:'test',protocolVersion:1}}) + '\\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  appendFileSync(${JSON.stringify(log)}, line + '\\n');
  const c = config();
  let result = {};
  if (request.method === 'listSources') result = {
    displays:[{id:1,name:'Test display',width:1920,height:1080,scale:1,isMain:true},
      {id:2,name:'Portrait display',width:1080,height:1920,scale:1,isMain:false}],
    windows:[],applications:[],microphones:[],cameras:[]
  };
  if (['getPermissions','requestPermission'].includes(request.method)) result = {
    screen:c.permission,microphone:'denied',camera:'denied',accessibility:'granted'
  };
  if (request.method === 'setScreenPreview') {
    previews = c.fail ? [] : request.params.previews;
    result = {failures:c.fail ? request.params.previews.map(p=>({id:p.id,message:'Display unavailable'})) : []};
  }
  if (request.method === 'setAudioPreview') result = {failures:[]};
  if (request.method === 'setWindowPreview') result = {window:null};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result}) + '\\n');
});
`,
  { mode: 0o755 },
);
process.env.CHORD_RECORDER_HELPER = fixture;
const surface = (kind: string) =>
  BrowserWindow.getAllWindows().find(
    (w) => new URL(w.webContents.getURL() || "about:blank").searchParams.get("surface") === kind,
  )!;
const requests = () =>
  readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((r) => r.method === "setScreenPreview");
const previews = () => requests().at(-1)?.params.previews ?? [];
const open = async (win: BrowserWindow) => {
  await click(
    win,
    `document.querySelector('[data-source-toggle="screen"] + [data-popup-trigger]')`,
  );
  await until(() => evaluate(win, '!!document.querySelector("[role=menu]")'), "screen menu");
};
const close = async (win: BrowserWindow) => {
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await until(() => evaluate(win, '!document.querySelector("[role=menu]")'), "menu cleanup");
};
const patch = (win: BrowserWindow, value: Record<string, unknown>) =>
  evaluate(win, `window.chord.desktop.updateDefaults(${JSON.stringify(value)})`);
const pixels = (win: BrowserWindow) =>
  evaluate(
    win,
    `(() => {
  const c = document.querySelector('.display-preview canvas');
  return c && c.width === 2 ? Array.from(c.getContext('2d').getImageData(0,0,2,1).data) : [];
})()`,
  );
const errors: string[] = [];
app.on("browser-window-created", (_event, win: BrowserWindow) =>
  win.webContents.on("console-message", (event) => {
    if (/^Uncaught/.test(event.message ?? "")) errors.push(event.message);
  }),
);

app.whenReady().then(async () => {
  try {
    writeFileSync(join(data, "opaque.jpg"), nativeImage.createFromBuffer(opaque).toJPEG(90));
    await import(
      pathToFileURL(resolve(import.meta.dirname, "../../../../../out/main/index.js")).href
    );
    await until(() => surface("main"), "main window");
    const main = surface("main");
    await until(
      () => evaluate(main, "window.chord?.desktop.getState().then(s=>!!s.defaults)"),
      "defaults",
    );
    await patch(main, {
      mode: "display",
      recordsScreen: true,
      background: "desktop",
      showsSystemUI: true,
      hiddenApps: ["com.example.hidden"],
    });
    await evaluate(main, `window.chord.desktop.updatePreferences({showsCursor:false})`);
    await open(main);
    await until(
      () => pixels(main).then((p) => p[3] === 255 && p[7] === 255),
      "JPEG frame from the helper pipe",
    );
    assert.equal(previews().length, 1);
    assert.deepEqual(previews()[0].excludedBundleIds, ["com.example.hidden"]);
    assert.equal(previews()[0].background, "desktop");
    assert.equal(previews()[0].showsSystemUI, true);
    assert.equal(previews()[0].showsCursor, false);
    assert.equal(previews()[0].displayId, 1);
    const oldId = previews()[0].id;

    // A mounted preview restarts when settings change; PNG alpha replaces, rather than covers, old pixels.
    await patch(main, { background: "transparent", hiddenApps: ["com.example.other"] });
    await until(
      () => previews()[0]?.background === "transparent" && previews()[0]?.id !== oldId,
      "new filtered preview",
    );
    assert.deepEqual(previews()[0].excludedBundleIds, ["com.example.other"]);
    // Apps hidden from every recording in Settings are hidden too.
    await evaluate(
      main,
      `window.chord.desktop.updatePreferences({hiddenApps:['com.example.always'],showsCursor:true})`,
    );
    await until(
      () => previews()[0]?.excludedBundleIds.length === 2,
      "always-hidden apps in the preview",
    );
    assert.deepEqual(previews()[0].excludedBundleIds, ["com.example.other", "com.example.always"]);
    assert.equal(previews()[0].showsCursor, true);
    await until(() => pixels(main).then((p) => p[0] === 255 && p[7] === 255), "opaque PNG frame");
    configure({ alpha: true });
    await until(
      () => pixels(main).then((p) => p[2] === 255 && p[7] === 0),
      "transparent PNG frame clearing old pixels",
    );
    assert.equal(
      await evaluate(main, `!!document.querySelector('[aria-label="Loading preview"]')`),
      false,
    );
    assert.equal(
      await evaluate(
        main,
        'getComputedStyle(document.querySelector(".display-preview")).backgroundImage',
      ),
      "none",
    );
    // Background transparency and the Mac UI toggle are independent, including while the preview is mounted.
    for (const background of ["desktop", "transparent"] as const) {
      for (const showsSystemUI of [false, true] as const) {
        await patch(main, { background, showsSystemUI });
        await until(
          () =>
            previews()[0]?.background === background &&
            previews()[0]?.showsSystemUI === showsSystemUI,
          "independent appearance settings",
        );
      }
    }
    await patch(main, { background: "transparent", showsSystemUI: false });
    await until(
      () => previews()[0]?.showsSystemUI === false && pixels(main).then((p) => p[7] === 0),
      "transparent frame after appearance changes",
    );
    assert.equal(
      await evaluate(
        main,
        `document.querySelector('[aria-label="Hide Mac UI"]').getAttribute('aria-checked')`,
      ),
      "true",
    );
    await screenshot(main, "screen-preview");

    // Stale frames cannot paint a replacement preview.
    main.webContents.send("preview:frame", oldId.split("/").at(-1), opaque);
    await settle();
    assert.equal((await pixels(main))[7], 0);

    // Multiple displays and area outlines use the same filters, retaining the display's actual aspect ratio.
    await patch(main, { displayIds: [1, 2] });
    await until(() => previews().length === 2, "two displays");
    assert.equal(
      await evaluate(
        main,
        'getComputedStyle(document.querySelectorAll(".display-preview")[1]).aspectRatio',
      ),
      "0.5625 / 1",
    );
    await patch(main, {
      mode: "area",
      areas: [{ displayId: 1, x: 10, y: 20, width: 300, height: 200 }],
    });
    await until(
      () => evaluate(main, '!!document.querySelector(".display-preview svg")'),
      "area outlines",
    );
    await until(
      () => previews().length === 1 && previews()[0].background === "transparent",
      "area preview filters",
    );
    await close(main);
    await until(() => previews().length === 0, "unmount releasing capture");

    configure({ fail: true });
    await open(main);
    await until(
      () =>
        evaluate(
          main,
          'document.querySelector(".display-preview")?.innerText.includes("Preview unavailable")',
        ),
      "helper failure",
    );
    await close(main);
    configure({ fail: false, permission: "denied" });
    await open(main);
    await until(
      () =>
        evaluate(
          main,
          'document.querySelector(".display-preview")?.innerText.includes("Allow screen recording in System Settings")',
        ),
      "permission hint",
    );
    await until(() => previews().length === 0, "denied preview stays stopped");
    await close(main);
    configure({ permission: "granted" });

    // The bridge isolates preview IDs between windows, and hides release only their owner's streams.
    await evaluate(main, "window.chord.toolbar.show()");
    await until(() => surface("toolbar")?.isVisible(), "toolbar");
    const bar = surface("toolbar");
    await until(
      () => evaluate(bar, '!!document.querySelector("[data-source-toggle=screen]")'),
      "toolbar controls",
    );
    await open(bar);
    await until(() => pixels(bar).then((p) => p[7] === 0), "toolbar frame");
    const barId = previews()[0].id;
    await evaluate(
      main,
      `window.chord.helper.request('setScreenPreview',{previews:[{id:'independent',displayId:2,background:'desktop'}]})`,
    );
    await until(() => previews().length === 2, "independent previews");
    assert.ok(previews().some((p: { id: string }) => p.id === barId));
    assert.ok(
      previews().some((p: { id: string }) => p.id === `${main.webContents.id}/independent`),
    );
    // Simulate helper restart notification: the mounted renderer resends its current request.
    const count = requests().length;
    bar.webContents.send("helper:notification", "ready", { version: "test", protocolVersion: 1 });
    await until(
      () =>
        requests().length > count &&
        previews().some((p: { id: string }) => p.id.startsWith(`${bar.webContents.id}/`)),
      "preview restored after helper ready",
    );
    await until(() => pixels(bar).then((p) => p[7] === 0), "restored preview frame");
    await evaluate(bar, "window.chord.toolbar.hide()");
    await until(
      () => previews().length === 1 && previews()[0].id === `${main.webContents.id}/independent`,
      "hide releases only toolbar previews",
    );
    await evaluate(main, `window.chord.helper.request('setScreenPreview',{previews:[]})`);
    assert.equal(previews().length, 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: helper JPEG/PNG frames, alpha clearing, recording filters, settings updates, stale frames, multiple displays, areas, failures, permissions, restart, per-window ownership and cleanup",
    );
    app.quit();
  } catch (error) {
    console.error(error);
    console.error("Previews:", previews());
    for (const win of BrowserWindow.getAllWindows())
      console.error(await evaluate(win, "document.body.innerText").catch(String));
    app.exit(1);
  }
});
