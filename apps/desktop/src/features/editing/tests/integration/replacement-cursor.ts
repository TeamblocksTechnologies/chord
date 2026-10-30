// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/editing/tests/integration/replacement-cursor.ts
// The replacement cursor, drawn from a recorded shape's image, in the editor's preview and an exported video, giving
// way to the laser; and its track's controls.
import { app, BrowserWindow, protocol } from "electron";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  click,
  evaluate as evaluateIn,
  reload,
  until,
} from "../../../../../tests/support/integration.ts";

const data = mkdtempSync(join(tmpdir(), "chord-replacement-cursor-"));
app.setPath("userData", data);
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
    : request.method === 'getPermissions' ? {screen:'granted',microphone:'granted',camera:'granted',accessibility:'granted'}
    : request.method === 'setScreenPreview' || request.method === 'setAudioPreview' ? {failures:[]} : null;
  process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:request.id, result}) + '\\n');
});
`,
  { mode: 0o755 },
);
process.env.CHORD_RECORDER_HELPER = helper;
process.env.CHORD_RECORDINGS_FOLDER = join(data, "recordings");

// A blue display, 320 by 200 points, with the cursor still in the middle in a solid red 10-point square shape.
const session = join(process.env.CHORD_RECORDINGS_FOLDER!, "Cursor", "session");
mkdirSync(join(session, "cursors"), { recursive: true });
const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "color=blue:size=320x200:rate=30:duration=2",
  "-pix_fmt",
  "yuv420p",
  join(session, "screen.mov"),
);
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "color=red:size=20x20",
  "-frames:v",
  "1",
  join(session, "cursors", "square.png"),
);
writeFileSync(
  join(session, "session.json"),
  JSON.stringify({
    version: 1,
    id: "session",
    createdAt: new Date().toISOString(),
    hostTimeOrigin: 0,
    config: {},
    pauses: [],
    marks: [],
    stoppedAt: 2,
    stopReason: "requested",
    input: "input.jsonl",
    tracks: [
      {
        id: "screen-1",
        kind: "screen",
        source: "display:1",
        display: { id: 1, frame: { x: 0, y: 0, width: 320, height: 200 }, scale: 1 },
        segments: [{ file: "screen.mov", start: 0, end: 2, screenMode: { type: "display" } }],
      },
    ],
  }),
);
writeFileSync(
  join(session, "input.jsonl"),
  [
    { type: "move", time: 0, x: 160, y: 100 },
    {
      type: "cursor",
      time: 0,
      image: "cursors/square.png",
      width: 10,
      height: 10,
      hotspotX: 0,
      hotspotY: 0,
    },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n") + "\n",
);

const isRed = ([r, g, b]: number[]) => r > 180 && g < 80 && b < 80;
const isBlue = ([r, g, b]: number[]) => b > 180 && r < 80 && g < 80;

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
      "the main window",
    );
    const evaluate = (expression: string) => evaluateIn(main, expression);
    main.webContents.on("console-message", (event) => {
      if (event.level === "error") console.error("Renderer:", event.message);
    });
    await until(() => evaluate('!!document.querySelector("[aria-label=Settings]")'), "home");
    const setup = await evaluate("window.chord.desktop.getState().then(state => state.defaults)");
    const now = new Date().toISOString();
    await evaluate(
      `window.chord.desktop.projects.load().then(() => window.chord.desktop.projects.put([${JSON.stringify(
        {
          id: "cursor",
          name: "Cursor",
          createdAt: now,
          updatedAt: now,
          notes: [],
          setup,
          pieces: [{ id: "take", recordingId: "take", start: 0, end: null }],
          recordings: [
            {
              id: "take",
              createdAt: now,
              duration: 2,
              mode: "display",
              hasMicrophone: false,
              hasCamera: false,
              hasSystemAudio: false,
              markCount: 0,
              pageChanges: [],
              directory: session,
              annotations: { laser: [{ start: 1.5, end: 2 }], clicks: [], keys: [] },
              visualLayers: [
                {
                  id: "cursor:0",
                  kind: "cursor",
                  spans: [{ start: 0, end: 2 }],
                  cursor: { size: 1, hideWhenIdle: false, smooth: true },
                },
                { id: "laser:0", kind: "laser", spans: [{ start: 1.5, end: 2 }] },
                { id: "screen:0", kind: "screen" },
              ],
            },
          ],
        },
      )}]))`,
    );
    await reload(main);
    await until(
      () => evaluate(`!!document.querySelector('[data-projects] button')`),
      "the project card",
    );
    await click(main, `document.querySelector('[data-projects] button')`);

    // Export at the default settings.
    const exportButton = `[...document.querySelectorAll('header button')].find(b => b.textContent.trim() === 'Export')`;
    const dialogButton = (label: string) =>
      `[...document.querySelectorAll('dialog button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
    await until(
      () => evaluate(`!!${exportButton} && !${exportButton}.disabled`),
      "the project to load for export",
    );
    await click(main, `${exportButton}`);
    await until(
      () => evaluate(`document.querySelector('dialog')?.open && !!${dialogButton("Export")}`),
      "the export dialog",
    );
    await click(main, `${dialogButton("Export")}`);
    await until(
      () =>
        evaluate(`document.querySelector('dialog h2')?.textContent.trim() === 'Video exported'`),
      "the export to finish",
    );
    await click(main, `${dialogButton("Done")}`);
    const folder = join(data, "recordings", "Cursor", "Exports");
    const mp4 = join(
      folder,
      readdirSync(existsSync(folder) ? folder : data).find((name: string) =>
        name.endsWith(".mp4"),
      )!,
    );
    const pixel = (time: number, x: number, y: number) =>
      [
        ...execFileSync("ffmpeg", [
          "-v",
          "error",
          "-ss",
          String(time),
          "-i",
          mp4,
          "-frames:v",
          "1",
          "-vf",
          `crop=2:2:${x - (x % 2)}:${y - (y % 2)}`,
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "-",
        ]),
      ].slice(0, 3);
    const [width, height] = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        mp4,
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split(",")
      .map(Number);
    // The display fits the frame; a point of it is `scale` pixels.
    const scale = Math.min(width / 320, height / 200);
    const at = (dx: number, dy: number): [number, number] => [
      Math.round((width - 320 * scale) / 2 + (160 + dx) * scale),
      Math.round((height - 200 * scale) / 2 + (100 + dy) * scale),
    ];
    assert.ok(
      isRed(pixel(1, ...at(5, 5))),
      `The exported cursor's image sits at its hotspot (${width}x${height}): ${pixel(1, ...at(5, 5))}`,
    );
    assert.ok(isBlue(pixel(1, ...at(-4, -4))), "Nothing above and left of the hotspot");
    assert.ok(!isRed(pixel(1.75, ...at(7, 7))), "The laser stands in for the cursor in the export");

    // Preview: the recording on its own, its cursor track and the same composition.
    await until(
      () => evaluate(`!!document.querySelector('[aria-label="Edit recording 1"]')`),
      "the recording list",
    );
    await click(main, `document.querySelector('[aria-label="Edit recording 1"]')`);
    await until(
      () => evaluate(`!!document.querySelector('[data-effect=cursor]')`),
      "the cursor track",
    );
    const seek = async (time: number) => {
      await evaluate(
        `(() => { const s = document.querySelector('[aria-label="Playback position"]'); s.value = ${time}; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); })()`,
      );
      await until(
        () =>
          evaluate(
            `Math.abs(document.querySelector('[data-player] video').currentTime - ${time}) < 0.02 && !document.querySelector('[data-player] video').seeking`,
          ),
        `seeking to ${time}`,
      );
    };
    const preview = (dx: number, dy: number) =>
      evaluate(`(() => {
      const canvas = document.querySelector('[data-player] canvas');
      const scale = Math.min(canvas.width / 320, canvas.height / 200);
      const x = (canvas.width - 320 * scale) / 2 + 160 * scale, y = (canvas.height - 200 * scale) / 2 + 100 * scale;
      return [...canvas.getContext('2d').getImageData(Math.round(x + ${dx} * scale), Math.round(y + ${dy} * scale), 1, 1).data];
    })()`);
    await seek(1);
    await until(async () => isRed(await preview(5, 5)), "the cursor in the preview");
    assert.ok(isBlue(await preview(-4, -4)), "The preview places it as the export does");
    await seek(1.75);
    await until(
      async () => !isRed(await preview(7, 7)),
      "the laser to stand in for the cursor in the preview",
    );

    // Its controls, and one cursor per recording.
    await click(main, `document.querySelector('[data-effect-label=cursor]')`);
    await until(
      () =>
        evaluate(
          `document.querySelector('[data-inspector] [data-panel-title]')?.textContent === 'Cursor'`,
        ),
      "the cursor inspector",
    );
    for (const label of [
      "Cursor size",
      "Smooth cursor movement",
      "Hide cursor when idle",
    ] as const) {
      assert.ok(
        await evaluate(`!!document.querySelector('[data-inspector] [aria-label="${label}"]')`),
        `${label} control`,
      );
    }
    await evaluate(
      `(() => { const input = document.querySelector('[aria-label="Cursor size"]'); input.value = 200; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
    await until(
      () =>
        evaluate(
          `window.chord.desktop.projects.load().then(ps => ps.find(p => p.id === 'cursor').recordings[0].visualLayers.find(l => l.kind === 'cursor').cursor.size === 2)`,
        ),
      "the size to save",
    );
    await seek(1);
    await until(async () => isRed(await preview(15, 15)), "the larger cursor");
    console.log(
      "PASS: the replacement cursor draws its recorded shape at the hotspot in preview and export, gives way to the laser, and its size saves",
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
