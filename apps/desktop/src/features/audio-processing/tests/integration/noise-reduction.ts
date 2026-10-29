import type { Recording } from "#project-document/domain/recording";
// Run after building and after `native/macos/scripts/build.sh`:
//   env -u ELECTRON_RUN_AS_NODE pnpm exec electron src/features/audio-processing/tests/integration/noise-reduction.ts
// Needs macOS (say, afconvert), ffmpeg, and the audio helper. The DeepFilterNet3 networks are used from
// CHORD_NOISE_MODELS (a folder with enc.onnx, erb_dec.onnx and df_dec.onnx) or /tmp/dfn/official/tmp/export;
// without them the DeepFilterNet3 half is skipped and says so.
import { app, BrowserWindow, protocol } from "electron";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  readdirSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const data = mkdtempSync(join(tmpdir(), "chord-noise-ui-"));
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
// What the preview and export actually ask the media scheme for.
const requested: { url: string; at: number }[] = [];
const handle = protocol.handle.bind(protocol);
protocol.handle = (scheme, handler) =>
  handle(scheme, (request) => {
    if (scheme === "chord-media") requested.push({ url: request.url, at: Date.now() });
    return handler(request);
  });
const helper = join(data, "recorder.cjs");
writeFileSync(
  helper,
  `#!/usr/bin/env node
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
const r=JSON.parse(line); const result=r.method==='listSources'?{displays:[],applications:[],windows:[],microphones:[],cameras:[]}:r.method==='getPermissions'?{screen:'granted',microphone:'granted',camera:'granted',accessibility:'granted'}:null;
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});`,
  { mode: 0o755 },
);
process.env.CHORD_RECORDER_HELPER = helper;
process.env.CHORD_RECORDINGS_FOLDER = join(data, "recordings");
process.env.CHORD_AUDIO_HELPER =
  process.env.CHORD_AUDIO_HELPER ||
  resolve(import.meta.dirname, "../../../../../../../native/macos/.build/release/audio-helper");
assert.ok(
  existsSync(process.env.CHORD_AUDIO_HELPER),
  "Build the audio helper first: native/macos/scripts/build.sh",
);

const networks = process.env.CHORD_NOISE_MODELS || "/tmp/dfn/official/tmp/export";
const haveNetworks = ["enc.onnx", "erb_dec.onnx", "df_dec.onnx"].every((file: string) =>
  existsSync(join(networks, file)),
);
if (haveNetworks) {
  const folder = join(data, "models", "noise-reduction", "deepfilternet3");
  mkdirSync(folder, { recursive: true });
  for (const file of ["enc.onnx", "erb_dec.onnx", "df_dec.onnx"] as const)
    cpSync(join(networks, file), join(folder, file));
}

// A recording: noise, then speech, then noise. 1.5 s of noise-only at each end.
const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);
const work = join(data, "work");
mkdirSync(work, { recursive: true });
execFileSync("say", [
  "-v",
  "Samantha",
  "-o",
  join(work, "speech.aiff"),
  "The quick brown fox jumps over the lazy dog. We are testing noise reduction on a recorded voice take, with a fan running in the background.",
]);
ffmpeg(
  "-i",
  join(work, "speech.aiff"),
  "-f",
  "lavfi",
  "-i",
  "anoisesrc=color=brown:amplitude=0.2:seed=7:sample_rate=48000",
  "-filter_complex",
  "[0]aresample=48000,pan=mono|c0=c0,adelay=1500,apad=pad_dur=1.5[s];[1]pan=mono|c0=c0[n];[s][n]amix=inputs=2:duration=first:normalize=0",
  "-ac",
  "1",
  "-ar",
  "48000",
  "-c:a",
  "pcm_s16le",
  join(work, "noisy.wav"),
);
const DURATION = Number(
  execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    join(work, "noisy.wav"),
  ]).toString(),
);
const DEFAULT_SEGMENT = { start: 0, end: DURATION };
function recordingFolder(name: string, withCamera: boolean) {
  const folder = join(data, "recordings", "Noise demo", name);
  mkdirSync(folder, { recursive: true });
  execFileSync("afconvert", [
    "-f",
    "m4af",
    "-d",
    "alac",
    join(work, "noisy.wav"),
    join(folder, "mic-a.m4a"),
  ]);
  const tracks = [
    {
      id: "mic",
      kind: "microphone",
      source: "mic",
      segments: [{ file: "mic-a.m4a", ...DEFAULT_SEGMENT }],
    },
  ];
  if (withCamera) {
    ffmpeg(
      "-f",
      "lavfi",
      "-i",
      `color=gray:size=320x180:rate=30:duration=${DURATION}`,
      "-pix_fmt",
      "yuv420p",
      join(folder, "camera-a.mp4"),
    );
    tracks.unshift({
      id: "camera",
      kind: "camera",
      source: "cam",
      segments: [{ file: "camera-a.mp4", ...DEFAULT_SEGMENT }],
    });
  }
  writeFileSync(
    join(folder, "session.json"),
    JSON.stringify({
      version: 1,
      id: name,
      createdAt: "2026-10-21T12:00:00Z",
      hostTimeOrigin: 0,
      config: {},
      pauses: [],
      marks: [],
      stoppedAt: DURATION,
      tracks,
    }),
  );
  return folder;
}
const micOnly = recordingFolder("mic-only", false);
const withCamera = recordingFolder("with-camera", true);
execFileSync("afconvert", [
  "-f",
  "WAVE",
  "-d",
  "LEI24",
  join(micOnly, "mic-a.m4a"),
  join(work, "original.wav"),
]);

/** Mono samples from a PCM WAV, any of 16, 24 or 32 bits, as numbers from -1 to 1. */
function readWav(path: string) {
  const bytes = readFileSync(path);
  let offset = 12,
    format;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4),
      length = bytes.readUInt32LE(offset + 4);
    if (id === "fmt ")
      format = {
        channels: bytes.readUInt16LE(offset + 10),
        rate: bytes.readUInt32LE(offset + 12),
        bytes: bytes.readUInt16LE(offset + 22) / 8,
      };
    if (id === "data") {
      assert.ok(format, "WAV format precedes its samples");
      const frames = Math.floor(length / (format.channels * format.bytes));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const at = offset + 8 + i * format.channels * format.bytes;
        samples[i] =
          format.bytes === 3
            ? bytes.readIntLE(at, 3) / 0x800000
            : format.bytes === 2
              ? bytes.readInt16LE(at) / 0x8000
              : bytes.readInt32LE(at) / 0x80000000;
      }
      return { samples, rate: format.rate, channels: format.channels };
    }
    offset += 8 + length + (length % 2);
  }
  throw new Error("no data in " + path);
}
const rmsDb = (x: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i] * x[i];
  return 10 * Math.log10(Math.max(sum / (to - from), 1e-18));
};
function correlation(a: Float32Array, b: Float32Array, from: number, length: number, lag: number) {
  let ma = 0,
    mb = 0;
  for (let i = 0; i < length; i++) {
    ma += a[from + i];
    mb += b[from + i + lag];
  }
  ma /= length;
  mb /= length;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < length; i++) {
    const x = a[from + i] - ma,
      y = b[from + i + lag] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db);
}
const original = readWav(join(work, "original.wav"));
/** What a cleaned file must be: the same length, lined up with the original, quieter between the speech, and not silent. */
function checkCleaned(file: string, label: string) {
  const cleaned = readWav(file);
  assert.equal(cleaned.rate, 48000, `${label}: rate`);
  assert.equal(cleaned.samples.length, original.samples.length, `${label}: same number of samples`);
  const quiet = [4800, 62400] as const;
  const drop = rmsDb(original.samples, ...quiet) - rmsDb(cleaned.samples, ...quiet);
  assert.ok(
    drop > 15,
    `${label}: noise between speech falls by ${drop.toFixed(1)} dB, wanted more than 15`,
  );
  const speech = [96000, 384000] as const;
  const loss = rmsDb(original.samples, ...speech) - rmsDb(cleaned.samples, ...speech);
  assert.ok(loss < 8, `${label}: speech stays (${loss.toFixed(1)} dB lost)`);
  let best = { lag: 0, score: -1 };
  for (let lag = -1500; lag <= 1500; lag += 1) {
    const score = correlation(original.samples, cleaned.samples, 150000, 96000, lag);
    if (score > best.score) best = { lag, score };
  }
  assert.ok(
    Math.abs(best.lag) <= 1,
    `${label}: lined up with the original (best lag ${best.lag}, correlation ${best.score.toFixed(2)})`,
  );
  console.log(
    `  ${label}: noise down ${drop.toFixed(1)} dB, speech ${loss.toFixed(1)} dB, lag ${best.lag}, correlation ${best.score.toFixed(2)}`,
  );
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => unknown | Promise<unknown>, message = "UI state", tries = 1200) {
  for (let n = 0; n < tries; n++) {
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
    const errors: string[] = [];
    main.webContents.on("console-message", (event) => {
      if (/^Uncaught/.test(event.message)) errors.push(event.message);
    });
    await until(() => evaluate(main, '!!document.querySelector("[aria-label=Settings]")'));
    const api = "window.chord.desktop";
    await evaluate(main, `${api}.projects.load()`);
    const setup = await evaluate(main, `${api}.getState().then(s=>s.defaults)`);
    const now = new Date().toISOString();
    const recording = (
      id: string,
      directory: string,
      hasCamera: boolean,
      audio?: Recording["audio"],
    ) => ({
      id,
      createdAt: now,
      duration: DURATION,
      mode: null,
      hasMicrophone: true,
      hasCamera,
      hasSystemAudio: false,
      markCount: 0,
      pageChanges: [],
      directory,
      annotations: { laser: [], clicks: [], keys: [] },
      ...(audio && { audio }),
    });
    const project = (recordings: Recording[]) => ({
      id: "noise",
      name: "Noise demo",
      createdAt: now,
      updatedAt: now,
      notes: [],
      setup,
      recordings,
    });
    const saved = () =>
      evaluate(main, `${api}.projects.load().then(ps=>ps.find(p=>p.id==='noise'))`);
    await evaluate(
      main,
      `${api}.projects.put([${JSON.stringify(project([recording("mic", micOnly, false), recording("cam", withCamera, true)]))}])`,
    );
    const noise = (directory: string) =>
      evaluate(main, `${api}.noise.get(${JSON.stringify(directory)})`);
    const track = async (directory: string) => (await noise(directory)).tracks["microphone:0"];

    console.log("Engines");
    const engines = await evaluate(main, `${api}.noiseEngines.list()`);
    assert.deepEqual(
      engines.find((engine: { id: string; status: { state: string } }) => engine.id === "apple")
        .status,
      { state: "ready" },
      "Apple Sound Isolation is available on this Mac",
    );
    assert.equal(
      engines.find(
        (engine: { id: string; status: { state: string } }) => engine.id === "deepfilternet3",
      ).status.state,
      haveNetworks ? "ready" : "notDownloaded",
    );
    await evaluate(main, `${api}.updatePreferences({noiseEngine:null})`);

    console.log("Leveling a cleaned copy needs one");
    await assert.rejects(
      evaluate(
        main,
        `${api}.recording.levelAudio(${JSON.stringify(withCamera)},'microphone',0,true)`,
      ),
      /noise first/,
    );

    const open = async (directoryName: number) => {
      main.webContents.reload();
      await until(() =>
        evaluate(
          main,
          `[...document.querySelectorAll('[data-projects] > div > button:first-child')].some(b=>b.textContent.includes('Noise demo'))`,
        ),
      );
      await evaluate(
        main,
        `[...document.querySelectorAll('[data-projects] > div > button:first-child')].find(b=>b.textContent.includes('Noise demo')).click()`,
      );
      await until(() =>
        evaluate(
          main,
          `!!document.querySelector('[aria-label="Edit recording ${directoryName}"]')`,
        ),
      );
      await evaluate(
        main,
        `document.querySelector('[aria-label="Edit recording ${directoryName}"]').click()`,
      );
      await until(
        () => evaluate(main, `!!document.querySelector('[data-layer-label=microphone]')`),
        "the microphone track",
      );
      await evaluate(main, `document.querySelector('[data-layer-label=microphone]').click()`);
      await until(
        () =>
          evaluate(
            main,
            `!!document.querySelector('[aria-label="Reduce noise in microphone"]') && !document.querySelector('[aria-label="Reduce noise in microphone"]').disabled`,
          ),
        "the noise reduction toggle",
      );
      assert.equal(
        await evaluate(
          main,
          `[...document.querySelectorAll('[data-inspector] button')].some(b=>b.textContent.includes('Set up in settings') && b.closest('[aria-label="Microphone controls"]'))`,
        ),
        false,
        "no setup prompt while an engine can run",
      );
    };
    const toggle = (label: string) => `document.querySelector('[aria-label="${label}"]')`;
    const isOn = (label: string) =>
      evaluate(main, `${toggle(label)}.getAttribute('aria-checked')==='true'`);
    /** Whether the media scheme has been asked for a recorded file's cleaned copy, or for the file itself, since `since`. */
    const askedForCleaned = (since = 0) =>
      requested.some((r) => r.at >= since && r.url.includes(".m4a") && r.url.includes("clean="));
    const askedForOriginal = (since = 0) =>
      requested.some((r) => r.at >= since && r.url.includes(".m4a") && !r.url.includes("clean="));
    const leadSource = () => evaluate(main, `document.querySelector('audio')?.dataset.url ?? ''`);

    console.log("Apple Sound Isolation, microphone alone, from the inspector");
    await open(1);
    await screenshot(main, "noise-panel");
    assert.equal(await isOn("Reduce noise in microphone"), false);
    assert.equal(askedForCleaned(), false, "the original plays until noise reduction is on");
    await until(() => askedForOriginal(), "the recorded file to be loaded");
    await evaluate(main, `${toggle("Reduce noise in microphone")}.click()`);
    await until(async () => (await track(micOnly))?.phase === "done", "Apple noise reduction");
    const apple = (await track(micOnly)).result;
    assert.equal(apple.engine, "apple");
    checkCleaned(join(micOnly, apple.files["mic-a.m4a"]), "Apple");
    await until(() => askedForCleaned(), "the preview to play the cleaned copy");
    assert.match(
      await leadSource(),
      /mic-a\.m4a\?clean=/,
      "the audio element plays the cleaned copy",
    );
    assert.equal(await isOn("Reduce noise in microphone"), true);
    await until(
      async () =>
        (await saved()).recordings.find((r: Recording) => r.id === "mic").audio?.["microphone:0"]
          ?.denoised === true,
      "the setting to be saved",
    );
    assert.ok(existsSync(join(micOnly, "noise.json")));
    await screenshot(main, "noise-on");

    console.log("Leveling follows the audio that plays");
    const gainOriginal = await evaluate(
      main,
      `${api}.recording.levelAudio(${JSON.stringify(micOnly)},'microphone',0,false)`,
    );
    const gainCleaned = await evaluate(
      main,
      `${api}.recording.levelAudio(${JSON.stringify(micOnly)},'microphone',0,true)`,
    );
    assert.ok(
      Number.isFinite(gainOriginal) &&
        Number.isFinite(gainCleaned) &&
        Math.abs(gainOriginal - gainCleaned) > 0.01,
      `original ${gainOriginal} and cleaned ${gainCleaned} levels differ`,
    );
    await evaluate(main, `${toggle("Level microphone")}.click()`);
    await until(async () => {
      const audio = (await saved()).recordings.find((r: Recording) => r.id === "mic").audio?.[
        "microphone:0"
      ];
      return (
        audio?.leveled === true &&
        Math.abs(audio.denoisedLevelGain - gainCleaned) < 1e-6 &&
        audio.denoisedLevelFor === apple.id &&
        audio.levelGain === undefined
      );
    }, "the cleaned copy to be measured for leveling");
    console.log(
      `  gain on the original ${gainOriginal.toFixed(2)}, on the cleaned copy ${gainCleaned.toFixed(2)}`,
    );

    console.log("Turning it off plays the original again, and its own gain is measured");
    await evaluate(main, `${toggle("Reduce noise in microphone")}.click()`);
    await until(async () => {
      const a = (await saved()).recordings.find((r: Recording) => r.id === "mic").audio?.[
        "microphone:0"
      ];
      return a?.denoised === false && Math.abs(a.levelGain - gainOriginal) < 1e-6;
    }, "the original gain after turning noise reduction off");
    // The recorded file may come from the browser's cache, so the element's source is what tells.
    await until(
      async () => /mic-a\.m4a$/.test(await leadSource()),
      "the preview to go back to the recorded file",
    );
    await evaluate(main, `${toggle("Reduce noise in microphone")}.click()`);
    await until(
      async () =>
        (await saved()).recordings.find((r: Recording) => r.id === "mic").audio?.["microphone:0"]
          ?.denoised === true,
    );
    assert.equal((await track(micOnly)).result.id, apple.id, "turning it back on reuses the copy");

    console.log("Camera and microphone: the microphone follows the video");
    await open(2);
    const before = Date.now();
    await evaluate(main, `${toggle("Reduce noise in microphone")}.click()`);
    await until(
      async () => (await track(withCamera))?.phase === "done",
      "noise reduction for the second recording",
    );
    checkCleaned(
      join(withCamera, (await track(withCamera)).result.files["mic-a.m4a"]),
      "Apple, following the camera",
    );
    await until(
      () =>
        requested.some(
          (r) => r.at >= before && r.url.includes("with-camera") && r.url.includes("clean="),
        ),
      "the following microphone to play the cleaned copy",
    );

    if (haveNetworks) {
      console.log("DeepFilterNet3");
      await evaluate(main, `${api}.updatePreferences({noiseEngine:'deepfilternet3'})`);
      assert.equal(
        (await track(micOnly)).result.engine,
        "apple",
        "a copy keeps the engine that made it when the choice changes",
      );
      await open(1);
      await evaluate(main, `${toggle("Reduce noise in microphone")}.click()`); // off
      await until(async () => !(await isOn("Reduce noise in microphone")));
      await evaluate(main, `${toggle("Reduce noise in microphone")}.click()`); // on, with the other engine
      await until(
        async () => {
          const t = await track(micOnly);
          return t?.phase === "done" && t.result.engine === "deepfilternet3";
        },
        "DeepFilterNet3 noise reduction",
        4800,
      );
      const deep = (await track(micOnly)).result;
      checkCleaned(join(micOnly, deep.files["mic-a.m4a"]), "DeepFilterNet3");
      assert.notEqual(deep.id, apple.id);
      assert.equal(
        existsSync(join(micOnly, "noise", apple.id)),
        false,
        "the replaced copy is removed",
      );
      await screenshot(main, "noise-deepfilternet3");
    } else console.log("SKIPPED DeepFilterNet3: no networks at " + networks);

    console.log("Export uses the cleaned audio");
    // The same recording twice, with a cleaned copy each: noise reduction on in one project and off in the other.
    const exportRoot = (name: string) => join(data, "recordings", name, "take");
    for (const name of ["Export on", "Export off"] as const) {
      cpSync(withCamera, exportRoot(name), { recursive: true });
    }
    const exportProject = (name: string, denoised: boolean) => ({
      ...project([
        {
          ...recording("take", exportRoot(name), true, {
            "microphone:0": { volume: 1, muted: false, denoised },
          }),
        },
      ]),
      id: name.replace(" ", "-"),
      name,
    });
    await evaluate(
      main,
      `${api}.projects.put([${JSON.stringify(exportProject("Export on", true))},${JSON.stringify(exportProject("Export off", false))}])`,
    );
    const exportedNoiseFloor = async (name: string) => {
      main.webContents.reload();
      await until(() =>
        evaluate(
          main,
          `[...document.querySelectorAll('[data-projects] > div > button:first-child')].some(b=>b.textContent.includes(${JSON.stringify(name)}))`,
        ),
      );
      await evaluate(
        main,
        `[...document.querySelectorAll('[data-projects] > div > button:first-child')].find(b=>b.textContent.includes(${JSON.stringify(name)})).click()`,
      );
      // The page has to know the cleaned copy is there, as it does once a person has the project open.
      await until(
        () =>
          evaluate(
            main,
            `${api}.noise.get(${JSON.stringify(exportRoot(name))}).then(s=>s.tracks['microphone:0']?.phase==='done')`,
          ),
        "the saved copy",
      );
      await pause(800);
      const button = `[...document.querySelectorAll('header button')].find(b=>b.textContent.trim()==='Export')`;
      await until(() => evaluate(main, `!!${button} && !${button}.disabled`), "the export button");
      await evaluate(main, `${button}.click()`);
      await until(() =>
        evaluate(main, `!!document.querySelector('dialog [aria-label="Resolution"]')`),
      );
      await evaluate(
        main,
        `[...document.querySelectorAll('dialog [aria-label="Resolution"] [role=radio]')].find(b=>b.textContent.trim()==='720p').click()`,
      );
      await evaluate(
        main,
        `[...document.querySelectorAll('dialog button')].find(b=>b.textContent.trim()==='Export').click()`,
      );
      await until(
        () =>
          evaluate(
            main,
            `document.querySelector('dialog h2')?.textContent.trim()==='Video exported'`,
          ),
        `the export of ${name}`,
        2400,
      );
      const folder = join(data, "recordings", name, "Exports");
      const video = readdirSyncSafe(folder).find((file: string) => file.endsWith(".mp4"));
      assert.ok(video, `${name} exported`);
      const wavFile = join(work, `${name.replace(" ", "-")}.wav`);
      ffmpeg(
        "-i",
        join(folder, video),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "pcm_s16le",
        wavFile,
      );
      const exported = readWav(wavFile).samples;
      return { floor: rmsDb(exported, 9600, 62400), speech: rmsDb(exported, 96000, 384000) };
    };
    const exportedOff = await exportedNoiseFloor("Export off");
    const exportedOn = await exportedNoiseFloor("Export on");
    const exportDrop = exportedOff.floor - exportedOn.floor;
    assert.ok(
      exportDrop > 15,
      `the exported noise floor falls by ${exportDrop.toFixed(1)} dB with noise reduction on, wanted more than 15`,
    );
    assert.ok(exportedOff.speech - exportedOn.speech < 8, "the exported speech stays");
    console.log(
      `  exported noise floor ${exportedOff.floor.toFixed(1)} dB without, ${exportedOn.floor.toFixed(1)} dB with (${exportDrop.toFixed(1)} dB lower)`,
    );

    console.log("Cancelling");
    await evaluate(main, `${api}.updatePreferences({noiseEngine:'apple'})`);
    const long = join(data, "recordings", "Noise demo", "long");
    cpSync(withCamera, long, { recursive: true });
    rmSync(join(long, "noise"), { recursive: true, force: true });
    rmSync(join(long, "noise.json"), { force: true });
    // A long file (about twenty-five minutes) keeps the job busy long enough to cancel it, even at Apple's speed.
    ffmpeg(
      "-stream_loop",
      "149",
      "-i",
      join(work, "noisy.wav"),
      "-c:a",
      "pcm_s16le",
      join(work, "long.wav"),
    );
    execFileSync("afconvert", [
      "-f",
      "m4af",
      "-d",
      "alac",
      join(work, "long.wav"),
      join(long, "mic-a.m4a"),
    ]);
    const manifest = JSON.parse(readFileSync(join(long, "session.json"), "utf8"));
    manifest.tracks.find((t: { kind: string }) => t.kind === "microphone").segments[0].end =
      DURATION * 150;
    writeFileSync(join(long, "session.json"), JSON.stringify(manifest));
    await evaluate(
      main,
      `${api}.projects.put([${JSON.stringify(project([recording("mic", micOnly, false), recording("cam", withCamera, true), recording("long", long, true)]))}])`,
    );
    // The page keeps its own copy of the project, so it is loaded again rather than left to write the old one back.
    main.webContents.reload();
    await until(() => evaluate(main, `!!document.querySelector("[aria-label=Settings]")`));
    await evaluate(main, `${api}.noise.start(${JSON.stringify(long)},'microphone',0)`);
    await until(async () => (await track(long))?.phase === "processing", "the long job to start");
    await evaluate(main, `${api}.noise.cancel(${JSON.stringify(long)},'microphone',0)`);
    await until(async () => (await track(long))?.phase === "idle", "cancelling");
    await pause(500);
    assert.equal(
      existsSync(join(long, "noise")) ? readdirSyncSafe(join(long, "noise")).length : 0,
      0,
      "nothing is left of a cancelled job",
    );
    assert.equal(existsSync(join(long, "noise.json")), false);

    assert.deepEqual(errors, []);
    console.log(
      "PASS: Apple and DeepFilterNet3 noise reduction through the app, with the preview, leveling, engine changes and cancellation",
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes("surface=main"),
    )!;
    if (win)
      console.error(
        "State:",
        await evaluate(
          win,
          `Promise.all([window.chord.desktop.noiseEngines.list(), window.chord.desktop.projects.load(), window.chord.desktop.getState()]).then(([engines, projects, state]) => JSON.stringify({engines, audio: projects.find(p=>p.id==='noise')?.recordings.map(r=>[r.id,r.audio]), pref: state.preferences?.noiseEngine}))`,
        ).catch((e) => String(e)),
      );
    if (win)
      console.error(
        "On screen:",
        (await evaluate(win, "document.body.innerText.slice(0, 600)").catch(() => "?")).replace(
          /\n+/g,
          " | ",
        ),
      );
    app.exit(1);
  }
});
function readdirSyncSafe(path: string) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}
