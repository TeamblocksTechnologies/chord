// Electron step: starts the built app on a fresh profile with the demo library and a fixture recorder helper, then
// captures the requested shots ($CHORD_SCREENSHOTS, ids from shots.mjs) into $CHORD_SCREENSHOTS_WORK/shots with
// macOS's screencapture, so windows keep their real traffic lights, shadows and transparent surroundings.
// Started by run.mjs.
import electron, { app, BrowserWindow, nativeImage, protocol, screen } from "electron";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PROJECTS, SETUP, SOURCES } from "./demo.mjs";
import { SHOTS } from "./shots.mjs";

const work = process.env.CHORD_SCREENSHOTS_WORK;
const wanted = new Set(process.env.CHORD_SCREENSHOTS.split(","));
const shots = SHOTS.filter((shot) => wanted.has(shot.id));
const out = join(work, "shots");
const data = join(work, "profile");
const recordings = join(work, "recordings");
const media = JSON.parse(readFileSync(join(work, "media.json"), "utf8"));
mkdirSync(out, { recursive: true });
mkdirSync(data, { recursive: true });

app.setPath("userData", data);
// The app registers this when it starts before Electron is ready; here it's loaded after.
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
writeFileSync(join(data, "quick-recording.json"), JSON.stringify(SETUP));
const fixture = join(work, "helper.cjs");
writeFileSync(
  fixture,
  `#!/usr/bin/env node
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  const result = request.method === 'listSources' ? ${JSON.stringify(SOURCES)}
    : ['getPermissions','requestPermission'].includes(request.method) ? {screen:'granted',microphone:'granted',camera:'granted',accessibility:'granted'}
    : ['updateSession','setMouseWatch','setKeyWatch'].includes(request.method) ? null
    : ['setAudioPreview','setScreenPreview'].includes(request.method) ? {failures:[]}
    : request.method === 'setWindowPreview' ? {window:null} : {};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:request.id, result}) + '\\n');
});
`,
  { mode: 0o755 },
);
process.env.CHORD_RECORDER_HELPER = fixture;
process.env.CHORD_RECORDINGS_FOLDER = recordings;

// The menu bar icon is the only way to open its panel, so keep hold of it.
const trays = [];
const { on } = electron.Tray.prototype;
electron.Tray.prototype.on = new Proxy(on, {
  apply(target, tray, args) {
    if (!trays.includes(tray)) trays.push(tray);
    return Reflect.apply(target, tray, args);
  },
});

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(check, message, tries = 600) {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await pause(50);
  }
  throw new Error(`Timed out waiting for ${message}`);
}
const evaluate = (win, expression) => win.webContents.executeJavaScript(expression);
const surface = (kind) =>
  BrowserWindow.getAllWindows().find(
    (w) => new URL(w.webContents.getURL() || "about:blank").searchParams.get("surface") === kind,
  );
const rectOf = (win, selector) =>
  evaluate(
    win,
    `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x, y:r.y, width:r.width, height:r.height}; })()`,
  );

/** Saves `win` as macOS draws it: with its shadow and transparent surroundings unless `shadow` is false. */
function capture(win, path, { shadow = true } = {}) {
  const id = win.getMediaSourceId().split(":")[1];
  execFileSync("screencapture", ["-x", ...(shadow ? [] : ["-o"]), `-l${id}`, path]);
}

/** Captures the window with key focus, so its traffic lights show in color. */
async function captureFocused(win, path) {
  for (let attempt = 0; !win.isFocused(); attempt++) {
    if (attempt === 10)
      throw new Error("Chord couldn't take focus. Leave the Mac alone while screenshots run.");
    app.focus({ steal: true });
    win.show();
    win.focus();
    await pause(500);
  }
  // Rest the page's pointer on the empty title bar, wherever the real one is, so nothing shows a hover.
  win.webContents.sendInputEvent({
    type: "mouseMove",
    x: Math.round(win.getContentBounds().width * 0.3),
    y: 18,
  });
  await pause(600);
  capture(win, path);
}

/**
 * Captures a transparent surface window cropped to `selector`, then sets it in transparent space with a soft shadow,
 * as a floating panel looks over the desktop. These windows draw no native shadow of their own.
 */
async function captureSurface(win, selector, path, pad = 40) {
  capture(win, path, { shadow: false });
  const rect = await rectOf(win, selector);
  const image = nativeImage.createFromPath(path);
  const scale = image.getSize().width / win.getBounds().width;
  const cropped = image.crop({
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale),
  });
  const frame = new BrowserWindow({
    width: Math.round(rect.width) + pad * 2,
    height: Math.round(rect.height) + pad * 2,
    x: 40,
    y: 60,
    frame: false,
    transparent: true,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
  });
  await frame.loadURL(
    "data:text/html,<!doctype html><body style='margin:0;background:transparent'></body>",
  );
  await evaluate(
    frame,
    `(() => {
      const img = new Image();
      img.src = ${JSON.stringify(`data:image/png;base64,${cropped.toPNG().toString("base64")}`)};
      img.style.cssText = 'position:absolute;left:${pad}px;top:${pad}px;width:${rect.width}px;height:${rect.height}px;filter:drop-shadow(0 10px 24px rgba(0,0,0,.35)) drop-shadow(0 1px 3px rgba(0,0,0,.3))';
      document.body.append(img);
      return img.decode();
    })()`,
  );
  frame.showInactive();
  // The window server can take a moment to have something to capture.
  for (let attempt = 0; ; attempt++) {
    await pause(800);
    try {
      capture(frame, path, { shadow: false });
      break;
    } catch (error) {
      if (attempt > 5) throw error;
    }
  }
  frame.destroy();
}

/** A wallpaper in the app's colors behind the main window, so its vibrancy blurs that rather than the real desktop. */
function wallpaper() {
  const win = new BrowserWindow({
    ...screen.getPrimaryDisplay().bounds,
    frame: false,
    focusable: false,
    hasShadow: false,
    show: false,
    backgroundColor: "#07080b",
  });
  const glow = (style, color) =>
    `<div style="position:absolute;border-radius:50%;${style};background:radial-gradient(circle, ${color}, transparent 62%)"></div>`;
  win.loadURL(
    `data:text/html,${encodeURIComponent(`<body style="margin:0;height:100vh;overflow:hidden;background:#07080b">
      ${glow("width:120vw;height:120vw;left:-30vw;top:-70vw", "rgba(37,99,235,.75)")}
      ${glow("width:110vw;height:110vw;right:-40vw;bottom:-70vw", "rgba(139,92,246,.6)")}
      ${glow("width:60vw;height:60vw;left:35vw;top:20vh", "rgba(20,184,166,.25)")}
    </body>`)}`,
  );
  return win;
}

/** The demo projects as the app saves them, all with the quick-start setup. */
function library(setup) {
  const now = Date.now();
  return PROJECTS.map((project, i) => {
    const take = media[project.name];
    const updatedAt = new Date(now - project.updated * 60_000).toISOString();
    const createdAt = new Date(now - project.updated * 60_000 - 3_600_000).toISOString();
    const recording = {
      id: `take-${i}`,
      createdAt,
      duration: take.duration,
      mode: "display",
      hasMicrophone: true,
      hasCamera: take.hasCamera,
      hasSystemAudio: take.hasSystemAudio,
      markCount: 0,
      pageChanges: [],
      directory: take.directory,
      annotations: { laser: [], clicks: [], keys: [] },
    };
    const edits = project.edits;
    if (edits) {
      const all = [{ start: 0, end: take.duration }];
      recording.annotations = {
        laser: edits.laser === "all" ? all : (edits.laser ?? []),
        clicks: edits.clicks === "all" ? all : (edits.clicks ?? []),
        keys: [],
      };
      recording.annotationTracks = ["clicks", "laser"].filter(
        (kind) => recording.annotations[kind].length,
      );
      if (edits.cutLine !== undefined) {
        const line = take.lines[edits.cutLine];
        recording.cuts = [{ start: line.start - 0.2, end: line.end + 0.25 }];
      }
    }
    return {
      id: `demo-${i}`,
      name: project.name,
      createdAt,
      updatedAt,
      notes: [],
      setup,
      captions: { style: "highlight", length: "medium" },
      recordings: [recording],
    };
  });
}

/** Which view the project library shows, in the main window or the menu bar panel. */
async function projectView(win, label) {
  await evaluate(win, `document.querySelector('[aria-label="${label}"]')?.click()`);
  await pause(500);
}

const steps = {
  async home(shot, main) {
    await projectView(main, "Grid view");
    await captureFocused(main, join(out, `${shot.id}.png`));
  },

  async menubar(shot) {
    trays[0].emit("click");
    await until(() => surface("menubar")?.isVisible(), "the menu bar panel");
    const panel = surface("menubar");
    await until(() => evaluate(panel, "!!document.querySelector('[data-menubar]')"), "panel");
    await projectView(panel, "List view");
    await pause(1200);
    await captureSurface(panel, "[data-menubar]", join(out, `${shot.id}.png`));
    trays[0].emit("click");
    await pause(500);
  },

  async toolbar(shot, main) {
    await evaluate(main, "window.chord.toolbar.show()");
    await until(() => surface("toolbar")?.isVisible(), "the toolbar");
    const toolbar = surface("toolbar");
    await until(() => evaluate(toolbar, "!!document.querySelector('[data-toolbar]')"), "toolbar");
    await pause(1200);
    await captureSurface(toolbar, "[data-toolbar]", join(out, `${shot.id}.png`));
    toolbar.hide();
    await pause(300);
  },

  async editor(shot, main) {
    main.show();
    await evaluate(
      main,
      `[...document.querySelectorAll('[data-projects] button')].find(b => b.textContent.includes(${JSON.stringify(shot.project)})).click()`,
    );
    await until(
      () => evaluate(main, `!!document.querySelector('[aria-label="Edit recording 1"]')`),
      "the project",
    );
    await evaluate(main, `document.querySelector('[aria-label="Edit recording 1"]').click()`);
    const track = `[data-layer-label=${shot.track}]`;
    await until(() => evaluate(main, `!!document.querySelector('${track}')`), "the recording");
    await evaluate(main, `document.querySelector('${track}').click()`);
    await until(
      () => evaluate(main, `document.querySelector('[aria-label="Play"]')?.disabled === false`),
      "the player",
    );
    await evaluate(
      main,
      `(() => { const input = document.querySelector('[aria-label="Playback position"]'); input.value = ${shot.time}; input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true})); })()`,
    );
    // Waveforms and the frame at the playhead load in the background.
    await pause(6000);
    await captureFocused(main, join(out, `${shot.id}.png`));
    await evaluate(main, `document.querySelector('[aria-label="Projects"]').click()`);
    await pause(500);
  },
};

app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  try {
    await import(pathToFileURL(resolve(import.meta.dirname, "../../out/main/index.js")).href);
    await until(() => surface("main"), "the main window");
    const main = surface("main");
    await until(
      () => evaluate(main, '!!document.querySelector("[aria-label=Settings]")'),
      "the home screen",
    );
    const backdrop = wallpaper();

    const setup = await evaluate(main, "window.chord.desktop.getState().then(s => s.defaults)");
    await evaluate(
      main,
      `window.chord.desktop.projects.load().then(() => window.chord.desktop.projects.put(${JSON.stringify(library(setup))}))`,
    );
    for (const { name } of PROJECTS) {
      const folder = join(recordings, name, "Thumbnails");
      await until(
        () => existsSync(join(folder, "thumbnails.json")) && !existsSync(join(folder, ".lock")),
        `${name}'s thumbnails`,
        4000,
      );
    }

    // The window doesn't hear of projects it didn't change, so it reloads.
    const size = SHOTS.find((shot) => shot.window)?.window ?? { width: 1280, height: 880 };
    main.setContentSize(size.width, size.height);
    main.center();
    backdrop.showInactive();
    main.webContents.reload();
    await until(
      () =>
        evaluate(
          main,
          `!!document.querySelector('[data-projects]') && [...document.querySelectorAll('[data-projects] img')].filter(i => !i.classList.contains('invisible')).every(i => i.complete && i.naturalWidth > 0) && document.querySelectorAll('[data-projects] canvas').length > 0`,
        ),
      "the project covers",
    );
    main.moveTop();
    await pause(1000);

    for (const shot of shots) {
      if (shot.window) main.setContentSize(shot.window.width, shot.window.height);
      await steps[shot.id](shot, main);
      console.log(`  ${shot.id}`);
    }
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
