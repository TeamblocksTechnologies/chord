// Electron step: composes the GitHub social preview card (1280x640) from the logo and a window screenshot.
//
//   electron social.mjs [source.png [output.png]]
//
// The source defaults to docs/images/home.png and the output to artifacts/social/card.png. Started by run.mjs.
//
// GitHub's template keeps 40pt (80px at this 2x size) clear on every side, so the logo and the window's sides sit inside
// the 1120x480 safe area at (80, 80). The logo is centered on top with the top of the home screen below it, running off
// the bottom edge and fading out there. The screenshot is cropped to its opaque window first, dropping the transparent
// shadow margin.
import { app, BrowserWindow, nativeImage } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const source = resolve(process.argv[2] ?? join(root, "docs/images/home.png"));
const output = resolve(process.argv[3] ?? join(root, "artifacts", "social", "card.png"));

const CARD = { width: 1280, height: 640 };
const SAFE = { x: 80, y: 80, width: 1120, height: 480 };
// The logo sits a little below the top of the safe area so it never touches it; the gap is the space under it.
const LOGO_TOP = SAFE.y + 8;
const GAP = 48;
const LOGO_WIDTH = 220;
// viewBox of docs/images/logo-dark.svg.
const LOGO_ASPECT = 315.512 / 79.847;
// How wide the window is drawn. It's shown whole across and from its top edge, traffic lights included; the height
// left under the logo decides how much of it shows before the bottom fade.
const SHOT_WIDTH = 1040;
// The window runs past the safe area to the bottom edge of the card, fading into the black there; only the logo and
// the window's sides have to stay inside it.
const FADE = "linear-gradient(to bottom, #000 78%, transparent)";

/** The bounds of the window in `image`, ignoring the faint drop shadow around it. */
function opaqueBounds(image) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (bitmap[(y * width + x) * 4 + 3] < 250) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

const dataUrl = (type, bytes) => `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;

app.dock?.hide();
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  try {
    const shot = nativeImage.createFromPath(source);
    const win = shot.crop(opaqueBounds(shot));
    const size = win.getSize();
    const logoHeight = LOGO_WIDTH / LOGO_ASPECT;
    const shotHeight = CARD.height - LOGO_TOP - logoHeight - GAP;
    const crop = win.crop({
      x: 0,
      y: 0,
      width: size.width,
      height: Math.round((size.width * shotHeight) / SHOT_WIDTH),
    });
    const logo = readFileSync(join(root, "docs/images/logo-dark.svg"));

    const html = `<body style="margin:0;width:${CARD.width}px;height:${CARD.height}px;background:#000;overflow:hidden">
      <div style="position:absolute;left:${SAFE.x}px;top:${LOGO_TOP}px;width:${SAFE.width}px;height:${CARD.height - LOGO_TOP}px;display:flex;flex-direction:column;align-items:center;gap:${GAP}px">
        <img src="${dataUrl("image/svg+xml", logo)}" style="width:${LOGO_WIDTH}px;height:${logoHeight}px;display:block">
        <img src="${dataUrl("image/png", crop.toPNG())}" style="width:${SHOT_WIDTH}px;height:${shotHeight}px;display:block;-webkit-mask-image:${FADE}">
      </div>
    </body>`;

    const page = new BrowserWindow({
      show: false,
      ...CARD,
      useContentSize: true,
      webPreferences: { backgroundThrottling: false },
    });
    await page.loadURL("data:text/html,<!doctype html><meta charset=utf-8><body></body>");
    await page.webContents.executeJavaScript(
      `document.documentElement.innerHTML = ${JSON.stringify(html)};
       Promise.all([...document.images].map((img) => img.decode()))`,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const image = await page.webContents.capturePage({ x: 0, y: 0, ...CARD });
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, image.resize({ ...CARD, quality: "best" }).toPNG());
    console.log(output);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
