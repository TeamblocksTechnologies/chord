// Electron step: renders each scene's three moments and each presenter palette's poses to PNG in
// $CHORD_SCREENSHOTS_WORK/frames. Started by run.mjs.
import { app, BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CAMERA, DISPLAY, PRESENTER_PALETTES, SCENES, presenter } from "./scenes.mjs";

const out = join(process.env.CHORD_SCREENSHOTS_WORK, "frames");
mkdirSync(out, { recursive: true });
app.dock?.hide();
// Each frame gets its own window; closing the last one mustn't quit.
app.on("window-all-closed", () => {});

async function render(html, size, file) {
  const win = new BrowserWindow({
    show: false,
    ...size,
    useContentSize: true,
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadURL("data:text/html,<!doctype html><meta charset=utf-8><body></body>");
  await win.webContents.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, ...size });
  writeFileSync(join(out, file), image.resize(size).toPNG());
  win.destroy();
}

app.whenReady().then(async () => {
  try {
    for (const [name, scene] of Object.entries(SCENES))
      for (let v = 0; v < 3; v++) await render(scene(v), DISPLAY, `${name}-${v}.png`);
    for (let p = 0; p < PRESENTER_PALETTES.length; p++)
      for (let v = 0; v < 3; v++) await render(presenter(v, p), CAMERA, `presenter${p}-${v}.png`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
