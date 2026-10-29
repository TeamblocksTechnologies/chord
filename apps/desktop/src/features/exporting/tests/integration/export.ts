// Run after building: env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/exporting/tests/integration/export.ts
import { app, BrowserWindow, clipboard, protocol } from "electron";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const data = mkdtempSync(join(tmpdir(), "chord-export-test-"));
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

// A take paused once: the whole display, then a followed window, with a camera and a microphone throughout.
const session = join(data, "recordings", "Export project", "20261020-120000-abcd");
mkdirSync(session, { recursive: true });
const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "testsrc=size=864x558:rate=30:duration=2",
  "-pix_fmt",
  "yuv420p",
  join(session, "screen-1-001.mov"),
);
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=864x558:rate=30:duration=2",
  "-pix_fmt",
  "yuv420p",
  join(session, "screen-1-002.mov"),
);
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=320x240:rate=30:duration=5",
  "-pix_fmt",
  "yuv420p",
  join(session, "camera-1-001.mp4"),
);
ffmpeg(
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000:duration=5",
  "-c:a",
  "alac",
  "-movflags",
  "frag_keyframe+empty_moov",
  join(session, "mic-1-001.m4a"),
);
writeFileSync(
  join(session, "screen-1-bounds.jsonl"),
  `${JSON.stringify({ time: 3, window: 7, frame: { x: 200, y: 150, width: 900, height: 600 } })}\n`,
);
writeFileSync(
  join(session, "session.json"),
  JSON.stringify({
    version: 1,
    id: "20261020-120000-abcd",
    createdAt: "2026-10-20T16:00:00Z",
    hostTimeOrigin: 0,
    config: {},
    pauses: [{ start: 2, end: 3 }],
    marks: [],
    stoppedAt: 5,
    stopReason: "requested",
    tracks: [
      {
        id: "screen-1",
        kind: "screen",
        source: "display:1",
        display: { id: 1, frame: { x: 0, y: 0, width: 1728, height: 1116 }, scale: 0.5 },
        bounds: "screen-1-bounds.jsonl",
        segments: [
          {
            file: "screen-1-001.mov",
            start: 0,
            end: 2,
            endReason: "paused",
            screenMode: { type: "display" },
          },
          {
            file: "screen-1-002.mov",
            start: 3,
            end: 5,
            endReason: "stopped",
            screenMode: { type: "focusedWindow" },
          },
        ],
      },
      {
        id: "mic-1",
        kind: "microphone",
        source: "mic",
        segments: [{ file: "mic-1-001.m4a", start: 0, end: 5 }],
      },
      {
        id: "camera-1",
        kind: "camera",
        source: "cam",
        segments: [{ file: "camera-1-001.mp4", start: 0, end: 5 }],
      },
    ],
  }),
);

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => unknown | Promise<unknown>, message = "UI state", tries = 600) {
  for (let i = 0; i < tries; i++) {
    if (await check()) return;
    await pause(50);
  }
  throw new Error(`Timed out waiting for ${message}`);
}
const evaluate = (win: BrowserWindow, expression: string) =>
  win.webContents.executeJavaScript(expression);
async function screenshot(win: BrowserWindow, label: string) {
  if (!process.env.CHORD_TEST_SCREENSHOTS) return;
  mkdirSync(process.env.CHORD_TEST_SCREENSHOTS, { recursive: true });
  writeFileSync(
    join(process.env.CHORD_TEST_SCREENSHOTS, `${label}.png`),
    (await win.webContents.capturePage()).toPNG(),
  );
}
const probe = (file: string, entries: string) =>
  JSON.parse(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", entries, "-of", "json", file], {
      encoding: "utf8",
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
    const rendererExceptions: string[] = [];
    main.webContents.on("console-message", (event) => {
      if (/TypeError|ReferenceError|Uncaught|ResizeObserver loop/.test(event.message))
        rendererExceptions.push(event.message);
      if (event.level === "error" || /^Uncaught/.test(event.message))
        console.error("Renderer:", event.message);
    });
    await until(() => evaluate(main, '!!document.querySelector("[aria-label=Settings]")'));
    const now = new Date().toISOString();
    const setup = await evaluate(
      main,
      `window.chord.desktop.getState().then(state => state.defaults)`,
    );
    const putProject = (
      audio:
        | Record<string, { volume: number; muted: boolean; leveled?: boolean; levelGain?: number }>
        | undefined,
    ) =>
      evaluate(
        main,
        `window.chord.desktop.projects.load().then(() => window.chord.desktop.projects.put([{
      id:'export', name:'Export: project', createdAt:'${now}', updatedAt:'${now}', notes:[], setup:${JSON.stringify(setup ?? {})},
      pieces:[{id:'take',recordingId:'take',start:0,end:null,cameraLayout:{position:'top-left',width:0.3}}],
      recordings:[{id:'take', createdAt:'${now}', duration:4, mode:'display', hasMicrophone:true, hasCamera:true,
        hasSystemAudio:false, markCount:0, pageChanges:[], directory:${JSON.stringify(session)},
        annotations:{laser:[], clicks:[], keys:[]}, audio:${JSON.stringify(audio)}}],
    }]))`,
      );
    await putProject(undefined);
    main.webContents.reload();
    await until(() =>
      evaluate(main, '!!document.querySelector("[data-projects] > div > button:first-child")'),
    );
    await evaluate(
      main,
      `document.querySelector('[data-projects] > div > button:first-child').click()`,
    );
    const exportButton = `[...document.querySelectorAll('header button')].find(b => b.textContent.trim() === 'Export')`;
    await until(
      () => evaluate(main, `!!${exportButton} && !${exportButton}.disabled`),
      "the project to load for export",
    );

    const dialogButton = (label: string) =>
      `[...document.querySelectorAll('dialog button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
    const select = async (label: string, option: string) => {
      await evaluate(
        main,
        `document.querySelector('dialog [aria-label=${JSON.stringify(label)}]').click()`,
      );
      await until(
        () =>
          evaluate(
            main,
            `[...document.querySelectorAll('[role=option]')].some(o => o.textContent.trim() === ${JSON.stringify(option)})`,
          ),
        `the ${option} option`,
      );
      await evaluate(
        main,
        `[...document.querySelectorAll('[role=option]')].find(o => o.textContent.trim() === ${JSON.stringify(option)}).click()`,
      );
    };
    const radio = (label: string, option: string) =>
      evaluate(
        main,
        `[...document.querySelectorAll('dialog [aria-label=${JSON.stringify(label)}] [role=radio]')].find(b => b.textContent.trim() === ${JSON.stringify(option)}).click()`,
      );
    // Exports are saved in the project's folder, named for the project and when they were exported.
    const exportsFolder = join(data, "recordings", "Export project", "Exports");
    const exported = () => (existsSync(exportsFolder) ? readdirSync(exportsFolder) : []);
    async function exportAs(extension: string, choose: () => Promise<unknown>, gif = false) {
      const before = new Set(exported());
      await evaluate(main, `${exportButton}.click()`);
      await until(
        () =>
          evaluate(main, `document.querySelector('dialog')?.open && !!${dialogButton("Export")}`),
        "the export dialog",
      );
      await choose();
      await pause(200);
      await screenshot(main, `export-settings-${extension}`);
      await evaluate(main, `${dialogButton("Export")}.click()`);
      await until(
        () =>
          evaluate(
            main,
            `!['Export video', 'Exporting video', 'Exporting GIF'].includes(document.querySelector('dialog h2')?.textContent.trim())`,
          ),
        "the export to finish",
      );
      const title = await evaluate(main, `document.querySelector('dialog h2').textContent.trim()`);
      assert.equal(
        title,
        gif ? "GIF exported" : "Video exported",
        await evaluate(main, `document.querySelector('dialog p')?.textContent`),
      );
      await screenshot(main, `export-done-${extension}`);
      await evaluate(main, `${dialogButton("Done")}.click()`);
      await until(() => evaluate(main, `!document.querySelector('dialog')`), "the dialog to close");
      const allAdded = exported().filter((name: string) => !before.has(name));
      const added = allAdded.filter((name: string) => name.endsWith(`.${extension}`));
      if (gif) {
        assert.deepEqual(allAdded, added, "A GIF has no transcript sidecars");
      } else {
        assert.equal(allAdded.length, 4, "Video and three transcript sidecars");
        const stem = join(exportsFolder, added[0].slice(0, -extension.length - 1));
        assert.equal(readFileSync(`${stem}.vtt`, "utf8"), "WEBVTT\n\n");
        assert.equal(readFileSync(`${stem}.srt`, "utf8"), "");
        assert.equal(readFileSync(`${stem}.txt`, "utf8"), "");
      }
      assert.equal(added.length, 1, `One new export (${added})`);
      assert.match(
        added[0],
        new RegExp(
          `^Export- project \\d{4}-\\d{2}-\\d{2} at \\d{2}\\.\\d{2}\\.\\d{2}( \\d+)?\\.${extension}$`,
        ),
      );
      // It's listed in the project's sidebar.
      await until(
        () =>
          evaluate(
            main,
            `[...document.querySelectorAll('[data-exports] button')].some(b => b.title === ${JSON.stringify(added[0])})`,
          ),
        "the export to be listed",
      );
      return join(exportsFolder, added[0]);
    }

    // The default: H.264 MP4 at 1080p and 30 fps, 16:9 as the stage follows a window, with the microphone.
    const mp4 = await exportAs("mp4", async () => {});
    const { streams, format } = probe(
      mp4,
      "stream=codec_type,codec_name,width,height,avg_frame_rate,nb_frames,sample_rate,channels:format=duration",
    );
    const video = streams.find(
      (s: { codec_type: string; codec_name?: string; nb_frames?: string }) =>
        s.codec_type === "video",
    );
    const audio = streams.find(
      (s: { codec_type: string; codec_name?: string; nb_frames?: string }) =>
        s.codec_type === "audio",
    );
    assert.deepEqual(
      [video.codec_name, video.width, video.height, video.avg_frame_rate],
      ["h264", 1920, 1080, "30/1"],
    );
    assert.equal(Number(video.nb_frames), 120, "Four seconds at 30 fps, with the pause left out");
    assert.deepEqual([audio.codec_name, audio.sample_rate, audio.channels], ["aac", "48000", 2]);
    assert.ok(
      Math.abs(Number(format.duration) - 4) < 0.1,
      `Four seconds long (${format.duration})`,
    );
    // The microphone's tone is in the mix.
    const stats = execFileSync(
      "sh",
      ["-c", `ffmpeg -i "${mp4}" -af volumedetect -vn -f null - 2>&1 | grep mean_volume`],
      { encoding: "utf8" },
    );
    const plainVolume = Number(/mean_volume: (-?[\d.]+)/.exec(stats)![1]);
    assert.ok(plainVolume > -30, `The microphone is audible (${stats.trim()})`);
    // The first frame is the whole display, pillarboxed on the backdrop; later the window fills the stage.
    const frameAt = (time: number) =>
      execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-ss",
          String(time),
          "-i",
          mp4,
          "-frames:v",
          "1",
          "-vf",
          "scale=192:108",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "-",
        ],
        { maxBuffer: 1 << 24 },
      );
    const columnShown = (pixels: Buffer, x: number) =>
      [...Array(108).keys()].some((y: number) => {
        const i = (y * 192 + x) * 3;
        return Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 64;
      });
    const first = frameAt(0.5);
    assert.equal(columnShown(first, 2), false, "The display is pillarboxed");
    const cameraPixel = first.subarray((30 * 192 + 10) * 3, (30 * 192 + 10) * 3 + 3);
    assert.ok(
      Math.max(...cameraPixel) - Math.min(...cameraPixel) > 40,
      `The clip camera is exported at the top left over the pillarbox (${[...cameraPixel]})`,
    );
    assert.equal(columnShown(first, 96), true, "The display is drawn");
    const window = frameAt(3);
    assert.equal(
      columnShown(window, 2) && columnShown(window, 189),
      true,
      "The followed window is zoomed to fill the stage",
    );

    // Vertical, transparent WebM at 720p and 24 fps.
    const webm = await exportAs("webm", async () => {
      await select("Aspect ratio", "9:16");
      await radio("Resolution", "720p");
      await radio("Frame rate", "24");
      await select("File type", "WebM (VP9)");
      await until(
        () =>
          evaluate(
            main,
            `!!document.querySelector('dialog [aria-label="Transparent background"]')`,
          ),
        "the transparency switch",
      );
      await evaluate(
        main,
        `document.querySelector('dialog [aria-label="Transparent background"]').click()`,
      );
      await until(
        () =>
          evaluate(
            main,
            `[...document.querySelectorAll('dialog span')].some(s => s.textContent.trim() === '720 × 1280')`,
          ),
        "the vertical size",
      );
    });
    const vertical = probe(
      webm,
      "stream=codec_type,codec_name,width,height,r_frame_rate:stream_tags=alpha_mode",
    );
    const vp9 = vertical.streams.find(
      (s: { codec_type: string; codec_name?: string; nb_frames?: string }) =>
        s.codec_type === "video",
    );
    assert.deepEqual([vp9.codec_name, vp9.width, vp9.height], ["vp9", 720, 1280]);
    assert.equal(vp9.tags?.alpha_mode ?? vp9.tags?.ALPHA_MODE, "1", "The video keeps its alpha");
    assert.equal(
      vertical.streams.find(
        (s: { codec_type: string; codec_name?: string; nb_frames?: string }) =>
          s.codec_type === "audio",
      )?.codec_name,
      "opus",
    );

    // Cancelling removes the unfinished file.
    const finished = exported().length;
    await evaluate(main, `${exportButton}.click()`);
    await until(() => evaluate(main, `!!${dialogButton("Export")}`), "the export dialog again");
    await select("File type", "MP4 (H.264)");
    await radio("Resolution", "4K");
    await evaluate(main, `${dialogButton("Export")}.click()`);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('dialog h2')?.textContent.trim() === 'Exporting video'`,
        ),
      "the export to start",
    );
    await until(
      () =>
        evaluate(
          main,
          `Number(document.querySelector('[role=progressbar]').getAttribute('aria-valuenow')) > 0`,
        ),
      "progress",
    );
    assert.equal(exported().length, finished + 1, "The export is written as it goes");
    await screenshot(main, "export-progress");
    await evaluate(main, `${dialogButton("Cancel")}.click()`);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('dialog h2')?.textContent.trim() === 'Export video'`,
        ),
      "cancelling to return to the settings",
    );
    await until(() => exported().length === finished, "the unfinished file to be removed");
    assert.equal(
      await evaluate(main, `document.querySelectorAll('[data-exports] li').length`),
      2,
      "Only finished exports are listed",
    );

    // A GIF of a range: from 1 to 3 seconds, 480 wide at 10 fps, played once, with no sound or sidecars.
    const setTime = (label: string, value: string | number) =>
      evaluate(
        main,
        `(() => { const input = document.querySelector('dialog [aria-label=${JSON.stringify(label)}]'); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('change', { bubbles: true })); })()`,
      );
    const summary = () =>
      evaluate(
        main,
        `document.querySelector('[data-export-summary]')?.textContent.replace(/\\s+/g, ' ').trim()`,
      );
    const gif = await exportAs(
      "gif",
      async () => {
        await select("File type", "GIF");
        await select("Aspect ratio", "16:9");
        await until(
          () => evaluate(main, `!!document.querySelector('dialog [aria-label=Width]')`),
          "the GIF settings",
        );
        assert.equal(
          await evaluate(
            main,
            `!!document.querySelector('dialog [aria-label=Resolution]') || !!document.querySelector('dialog [aria-label="Transparent background"]')`,
          ),
          false,
          "Video-only settings are hidden",
        );
        await radio("Width", "480");
        await radio("Frame rate", "10");
        await evaluate(main, `document.querySelector('dialog [aria-label=Loop]').click()`);
        await evaluate(main, `document.querySelector('dialog [aria-label=Range]').click()`);
        await until(
          () => evaluate(main, `!!document.querySelector('dialog [aria-label="Start time"]')`),
          "the range fields",
        );
        await setTime("Start time", "1");
        await setTime("End time", "0:03");
        await until(
          async () => /^480 × 270 0:02 20 frames About \d+/.test(await summary()),
          `the GIF summary (${await summary()})`,
        );
      },
      true,
    );
    const gifBytes = readFileSync(gif);
    assert.equal(gifBytes.subarray(0, 6).toString(), "GIF89a");
    assert.equal(
      gifBytes.includes(Buffer.from("NETSCAPE2.0")),
      false,
      "Played once, the GIF has no loop extension",
    );
    const gifInfo = probe(gif, "stream=codec_name,width,height:format=duration");
    assert.deepEqual(
      [gifInfo.streams[0].codec_name, gifInfo.streams[0].width, gifInfo.streams[0].height],
      ["gif", 480, 270],
    );
    assert.equal(gifInfo.streams.length, 1, "A GIF has no audio");
    assert.ok(
      Math.abs(Number(gifInfo.format.duration) - 2) < 0.05,
      `Two seconds long (${gifInfo.format.duration})`,
    );
    const decoded = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-count_frames",
        "-show_entries",
        "stream=nb_read_frames",
        "-of",
        "csv=p=0",
        gif,
      ],
      { encoding: "utf8" },
    ).trim();
    assert.ok(
      Number(decoded) > 10 && Number(decoded) <= 20,
      `The moving test pattern keeps most of its 20 frames (${decoded})`,
    );
    // Half a second in, it's 1.5 seconds into the project: the display pillarboxed, with the camera at the top left.
    const gifFrame = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-ss",
        "0.5",
        "-i",
        gif,
        "-frames:v",
        "1",
        "-vf",
        "scale=192:108",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ],
      { maxBuffer: 1 << 24 },
    );
    assert.equal(columnShown(gifFrame, 2), false, "The GIF is pillarboxed as the video is");
    assert.equal(columnShown(gifFrame, 96), true, "The display is drawn in the GIF");
    const gifCamera = gifFrame.subarray((30 * 192 + 10) * 3, (30 * 192 + 10) * 3 + 3);
    assert.ok(
      Math.max(...gifCamera) - Math.min(...gifCamera) > 40,
      `The camera is in the GIF (${[...gifCamera]})`,
    );
    // It matches the MP4 export at the same moment of the project.
    const mp4Frame = frameAt(1.5);
    const difference =
      gifFrame.reduce(
        (total, value: number, index: number) => total + Math.abs(value - mp4Frame[index]),
        0,
      ) / gifFrame.length;
    assert.ok(
      difference < 12,
      `The GIF shows what the video does at that moment (mean difference ${difference.toFixed(1)})`,
    );

    // A ranged video keeps only that stretch, sound included.
    const ranged = await exportAs("mp4", async () => {
      await select("File type", "MP4 (H.264)");
      await select("Aspect ratio", "Original");
      await evaluate(main, `document.querySelector('dialog [aria-label=Range]').click()`);
      await until(
        () => evaluate(main, `!!document.querySelector('dialog [aria-label="Start time"]')`),
        "the range fields for a video",
      );
      await setTime("Start time", "0:02.5");
      await setTime("End time", "4");
    });
    const rangedInfo = probe(ranged, "stream=codec_type,nb_frames:format=duration");
    assert.equal(
      Number(
        rangedInfo.streams.find(
          (s: { codec_type: string; codec_name?: string; nb_frames?: string }) =>
            s.codec_type === "video",
        ).nb_frames,
      ),
      36,
      "A second and a half at the 24 fps chosen before",
    );
    assert.ok(
      rangedInfo.streams.some(
        (s: { codec_type: string; codec_name?: string; nb_frames?: string }) =>
          s.codec_type === "audio",
      ),
      "The range keeps its sound",
    );
    assert.ok(
      Math.abs(Number(rangedInfo.format.duration) - 1.5) < 0.1,
      `A second and a half long (${rangedInfo.format.duration})`,
    );

    // Cancelling a GIF removes it too.
    const beforeGifCancel = exported().length;
    await evaluate(main, `${exportButton}.click()`);
    await until(() => evaluate(main, `!!${dialogButton("Export")}`), "the export dialog for a GIF");
    await select("File type", "GIF");
    await until(
      () => evaluate(main, `!!document.querySelector('dialog [aria-label=Width]')`),
      "the GIF settings again",
    );
    await radio("Width", "1080");
    await radio("Frame rate", "24");
    await evaluate(main, `${dialogButton("Export")}.click()`);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('dialog h2')?.textContent.trim() === 'Exporting GIF'`,
        ),
      "the GIF to start",
    );
    await until(
      () => exported().length === beforeGifCancel + 1,
      "the GIF to be written as it goes",
    );
    await evaluate(main, `${dialogButton("Cancel")}.click()`);
    await until(
      () =>
        evaluate(
          main,
          `document.querySelector('dialog h2')?.textContent.trim() === 'Export video'`,
        ),
      "cancelling the GIF",
    );
    await until(() => exported().length === beforeGifCancel, "the unfinished GIF to be removed");
    await evaluate(main, `${dialogButton("Cancel")}.click()`);
    await until(
      () => evaluate(main, `!document.querySelector('dialog')`),
      "the dialog to close after cancelling",
    );

    // Leveling: the gain measured from the recording's own audio is applied to the exported mix, and a quiet tone gets louder.
    const gain = await evaluate(
      main,
      `window.chord.desktop.recording.levelAudio(${JSON.stringify(session)}, 'microphone', 0)`,
    );
    // ffmpeg's ebur128 reads the tone at -21.8 LUFS, so reaching the -16 LUFS target takes 5.8 dB.
    assert.ok(Math.abs(20 * Math.log10(gain) - 5.8) < 0.2, `Measured gain (${gain})`);
    await putProject({
      "microphone:0": { volume: 1, muted: false, leveled: true, levelGain: gain },
    });
    main.webContents.reload();
    await until(() =>
      evaluate(main, '!!document.querySelector("[data-projects] > div > button:first-child")'),
    );
    await evaluate(
      main,
      `document.querySelector('[data-projects] > div > button:first-child').click()`,
    );
    await until(
      () => evaluate(main, `!!${exportButton} && !${exportButton}.disabled`),
      "the leveled project to load",
    );
    const leveled = await exportAs("mp4", async () => {});
    const leveledStats = execFileSync(
      "sh",
      ["-c", `ffmpeg -i "${leveled}" -af volumedetect -vn -f null - 2>&1 | grep mean_volume`],
      { encoding: "utf8" },
    );
    const boost = Number(/mean_volume: (-?[\d.]+)/.exec(leveledStats)![1]) - plainVolume;
    assert.ok(
      Math.abs(boost - 20 * Math.log10(gain)) < 0.3,
      `Export is ${boost} dB louder (${leveledStats.trim()})`,
    );

    // Frames: a still of the preview at the playhead, saved to Exports or copied, shaped as the preview is and at the
    // recording's own pixels (864 × 558 here, so 16:9 keeps the width and gives 864 × 486).
    const frameButton = `document.querySelector('[aria-label=Frame]')`;
    const seekTo = (time: number) =>
      evaluate(
        main,
        `(() => { const slider = document.querySelector('[aria-label="Playback position"]'); slider.value = '${time}'; slider.dispatchEvent(new Event('input', { bubbles: true })); slider.dispatchEvent(new Event('change', { bubbles: true })); })()`,
      );
    const frames = () => exported().filter((name: string) => name.endsWith(".png"));
    const pngSize = (buffer: Buffer) => [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
    const rawFrame = (file: string) =>
      execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-i",
          file,
          "-frames:v",
          "1",
          "-vf",
          "scale=192:108",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "-",
        ],
        { maxBuffer: 1 << 24 },
      );
    await until(
      () => evaluate(main, `!!${frameButton} && !${frameButton}.disabled`),
      "the frame button",
    );
    for (const [time, label] of [
      [0.5, "the display"],
      [3, "the followed window"],
    ] as const) {
      await seekTo(time);
      await until(
        () =>
          evaluate(
            main,
            `Math.abs(Number(document.querySelector('[aria-label="Playback position"]').value) - ${time}) < 0.01`,
          ),
        `the playhead at ${time}`,
      );
      await pause(500);
      const before = new Set(frames());
      await evaluate(main, `${frameButton}.click()`);
      await until(
        () =>
          evaluate(
            main,
            `[...document.querySelectorAll('[role=menuitem]')].some(i => i.textContent.includes('Save frame'))`,
          ),
        "the frame menu",
      );
      await evaluate(
        main,
        `[...document.querySelectorAll('[role=menuitem]')].find(i => i.textContent.includes('Save frame')).click()`,
      );
      await until(
        () => frames().some((name: string) => !before.has(name)),
        `the frame at ${time}s to be saved`,
      );
      const saved = frames().filter((name: string) => !before.has(name));
      assert.equal(saved.length, 1);
      assert.match(
        saved[0],
        new RegExp(
          `^Export- project \\d{4}-\\d{2}-\\d{2} at \\d{2}\\.\\d{2}\\.\\d{2} frame 00\\.0${Math.floor(time)}( \\d+)?\\.png$`,
        ),
      );
      const file = join(exportsFolder, saved[0]);
      assert.deepEqual(
        pngSize(readFileSync(file)),
        [864, 486],
        `${label} is drawn 16:9 within the recording's pixels`,
      );
      await until(
        () =>
          evaluate(
            main,
            `[...document.querySelectorAll('[data-exports] button')].some(b => b.title === ${JSON.stringify(saved[0])})`,
          ),
        "the frame to be listed",
      );
      const pixels = rawFrame(file);
      const lit = (x: number) =>
        [...Array(108).keys()].some((y: number) => {
          const i = (y * 192 + x) * 3;
          return Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 64;
        });
      if (time < 1) {
        assert.equal(lit(2), false, "The display is pillarboxed in the frame");
        assert.equal(lit(96), true, "The display is drawn");
        const corner = pixels.subarray((30 * 192 + 10) * 3, (30 * 192 + 10) * 3 + 3);
        assert.ok(
          Math.max(...corner) - Math.min(...corner) > 40,
          `The camera is in the frame (${[...corner]})`,
        );
      } else {
        assert.equal(
          lit(2) && lit(189),
          true,
          "The followed window fills the frame, with nothing left over from the earlier one",
        );
      }
    }
    // Copying puts the same kind of image on the clipboard, and the shortcut does it too.
    clipboard.clear();
    await seekTo(0.5);
    await pause(500);
    await evaluate(
      main,
      `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', metaKey: true, shiftKey: true, bubbles: true }))`,
    );
    await until(async () => await clipboard.has("image/png"), "the frame to be copied");
    const [copied] = await clipboard.read();
    const copiedPng = Buffer.from(await (await copied.getType("image/png")).arrayBuffer());
    assert.deepEqual(pngSize(copiedPng), [864, 486], "The copied frame is the same size");
    // A PNG in Exports is opened and trashed like a video, but has no transcript files.
    assert.equal(
      await evaluate(
        main,
        `window.chord.desktop.export.list(${JSON.stringify("Export project")}).then(list => list.filter(item => item.name.endsWith('.png')).length)`,
      ),
      2,
      "Both frames are listed",
    );
    await screenshot(main, "frame-saved");
    assert.deepEqual(rendererExceptions, [], "Export must not produce renderer exceptions");

    console.log(
      "PASS: exports the edit to its project folder as H.264 MP4 and transparent vertical VP9 WebM with mixed audio, a ranged GIF and MP4, framing as the preview does, cancels cleanly, and saves and copies frames at the source pixels",
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
