// Regenerates the screenshots listed in shots.mjs: renders the demo scenes, builds the demo recordings, captures the
// built app and copies the results to their places in the repository.
//
//   pnpm screenshots                  every shot
//   pnpm screenshots home editor      only these
//
// macOS only. Needs ffmpeg, the app built (`pnpm build`) and screen recording permission for the terminal. Windows
// appear and take focus while it runs. Working files go to artifacts/screenshots.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { SHOTS } from "./shots.mjs";

const desktop = resolve(import.meta.dirname, "../..");
const root = resolve(desktop, "../..");
const work = join(root, "artifacts", "screenshots");

const requested = process.argv.slice(2);
const unknown = requested.filter((id) => !SHOTS.some((shot) => shot.id === id));
if (unknown.length) {
  console.error(
    `Unknown shots: ${unknown.join(", ")}. Known: ${SHOTS.map((s) => s.id).join(", ")}`,
  );
  process.exit(1);
}
const shots = requested.length ? SHOTS.filter((shot) => requested.includes(shot.id)) : SHOTS;

if (process.platform !== "darwin") {
  console.error("Screenshots are captured from the macOS app, so they need macOS.");
  process.exit(1);
}
for (const tool of ["ffmpeg", "ffprobe", "say", "screencapture"]) {
  try {
    execFileSync("which", [tool], { stdio: "ignore" });
  } catch {
    console.error(`${tool} is needed and wasn't found.`);
    process.exit(1);
  }
}
if (!existsSync(join(desktop, "out/main/index.js"))) {
  console.error("Build the app first: pnpm build");
  process.exit(1);
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const electron = createRequire(join(desktop, "package.json"))("electron");
const env = { ...process.env, CHORD_SCREENSHOTS_WORK: work };
delete env.ELECTRON_RUN_AS_NODE;

function step(label, command, args, extra = {}) {
  console.log(label);
  const result = spawnSync(command, args, {
    cwd: desktop,
    env: { ...env, ...extra },
    stdio: ["ignore", "inherit", "pipe"],
  });
  if (result.status !== 0) {
    // Chromium logs noise on stderr; show it only when the step fails.
    process.stderr.write(result.stderr);
    console.error(`${label} failed.`);
    process.exit(1);
  }
}

step("Rendering scenes", electron, [join(import.meta.dirname, "render-frames.mjs")]);
step("Building demo recordings", process.execPath, [join(import.meta.dirname, "build-media.mjs")]);
step("Capturing", electron, [join(import.meta.dirname, "capture.mjs")], {
  CHORD_SCREENSHOTS: shots.map((shot) => shot.id).join(","),
});

for (const shot of shots) {
  const target = join(root, shot.output);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(work, "shots", `${shot.id}.png`), target);
  console.log(`${shot.output}`);
}
