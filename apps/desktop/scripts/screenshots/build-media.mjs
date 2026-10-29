// Node step: builds a session folder per demo project in $CHORD_SCREENSHOTS_WORK/recordings, as the recorder helper
// writes them: screen and camera video from the rendered frames, narrated microphone audio, system audio, pointer
// input, session.json and a transcript with word timings. Writes media.json describing them. Started by run.mjs.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECTS, VOICE } from "./demo.mjs";
import { DISPLAY } from "./scenes.mjs";

const work = process.env.CHORD_SCREENSHOTS_WORK;
const frames = join(work, "frames");
const recordings = join(work, "recordings");
const scratch = join(work, "scratch");
mkdirSync(scratch, { recursive: true });

const run = (command, args) =>
  execFileSync(command, args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const ffmpeg = (...args) => run("ffmpeg", ["-v", "error", "-y", ...args]);
const duration = (file) =>
  Number(
    run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]),
  );
/** A still sequence: each frame held for `seconds`, as 30 fps H.264. */
function slideshow(files, seconds, length, output, tune = []) {
  const list = join(scratch, "slideshow.txt");
  writeFileSync(
    list,
    files.map((file) => `file '${file}'\nduration ${seconds.toFixed(3)}`).join("\n") +
      `\nfile '${files.at(-1)}'\n`,
  );
  ffmpeg(
    ...["-f", "concat", "-safe", "0", "-i", list, "-vf", "fps=30,format=yuv420p"],
    ...["-t", String(length), "-c:v", "libx264", "-preset", "veryfast", "-g", "30", ...tune],
    output,
  );
}

// Silence before the first line and between lines.
const LEAD = 0.6;
const GAP = 0.45;
const ALAC = ["-c:a", "alac", "-movflags", "frag_keyframe+empty_moov"];

const index = {};
PROJECTS.forEach((project, p) => {
  const id = `20261028-${String(100000 + p * 1111).slice(-6)}-${(0xa1b2 + p).toString(16)}`;
  const session = join(recordings, project.name, id);
  mkdirSync(session, { recursive: true });

  // Narration a line at a time, so each line's timing is known; its words share its time by length.
  const silence = (seconds, name) => {
    const file = join(scratch, name);
    ffmpeg("-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", String(seconds), file);
    return file;
  };
  const parts = [silence(LEAD, "lead.wav")];
  const gap = silence(GAP, "gap.wav");
  const cues = [];
  let time = LEAD;
  project.lines.forEach((line, i) => {
    const aiff = join(scratch, `${p}-${i}.aiff`);
    const wav = join(scratch, `${p}-${i}.wav`);
    run("say", ["-v", VOICE.name, "-r", String(VOICE.rate), "-o", aiff, line]);
    // Trim the synthesizer's own leading and trailing silence so the timings line up.
    const trim = "silenceremove=start_periods=1:start_threshold=-45dB";
    ffmpeg("-i", aiff, "-af", `${trim},areverse,${trim},areverse,aresample=48000`, "-ac", "1", wav);
    const length = duration(wav);
    const tokens = line.split(" ");
    const weights = tokens.map((token) => token.replace(/[^\w']/g, "").length + 1.5);
    const total = weights.reduce((a, b) => a + b, 0);
    let at = time;
    const words = tokens.map((text, w) => {
      const span = (weights[w] / total) * length;
      const word = { text, start: +at.toFixed(3), end: +(at + span * 0.92).toFixed(3) };
      at += span;
      return word;
    });
    cues.push({
      id: `cue-${i}`,
      trackId: "mic-1",
      start: words[0].start,
      end: words.at(-1).end,
      text: line,
      words,
    });
    parts.push(wav, gap);
    time += length + GAP;
  });
  const end = +(time + 0.4).toFixed(3);
  const list = join(scratch, "voice.txt");
  writeFileSync(list, parts.map((file) => `file '${file}'`).join("\n"));
  const voice = join(scratch, `${p}-voice.wav`);
  ffmpeg("-f", "concat", "-safe", "0", "-i", list, "-af", `apad=whole_dur=${end}`, voice);
  ffmpeg("-i", voice, ...ALAC, join(session, "mic-1-001.m4a"));

  // The screen shows the scene's three moments, a third of the take each.
  slideshow(
    [0, 1, 2].map((v) => join(frames, `${project.scene}-${v}.png`)),
    end / 3,
    end,
    join(session, "screen-1-001.mov"),
    ["-tune", "stillimage"],
  );
  const tracks = [
    {
      id: "screen-1",
      kind: "screen",
      source: "display:1",
      display: { id: 1, frame: { x: 0, y: 0, ...DISPLAY }, scale: 1 },
      segments: [
        {
          file: "screen-1-001.mov",
          start: 0,
          end,
          endReason: "stopped",
          screenMode: { type: "display" },
        },
      ],
    },
  ];

  const hasCamera = project.camera !== undefined;
  if (hasCamera) {
    slideshow(
      [0, 1, 2, 1, 0, 2].map((v) => join(frames, `presenter${project.camera}-${v}.png`)),
      end / 6,
      end,
      join(session, "camera-1-001.mp4"),
    );
    tracks.push({
      id: "camera-1",
      kind: "camera",
      source: "cam",
      segments: [{ file: "camera-1-001.mp4", start: 0, end }],
    });
  }
  tracks.push({
    id: "mic-1",
    kind: "microphone",
    source: "mic",
    segments: [{ file: "mic-1-001.m4a", start: 0, end }],
  });

  if (project.systemAudio) {
    // A quiet, slowly swelling chord, like music playing in another app.
    const tone = (frequency) => ["-f", "lavfi", "-i", `sine=f=${frequency}:r=48000:d=${end}`];
    ffmpeg(
      ...tone(220),
      ...tone(277.18),
      ...tone(329.63),
      ...["-f", "lavfi", "-i", `anoisesrc=color=pink:r=48000:d=${end}:a=0.25`],
      "-filter_complex",
      "[0][1][2][3]amix=inputs=4,tremolo=f=0.35:d=0.7,volume=0.55,aformat=channel_layouts=stereo",
      ...ALAC,
      join(session, "system-1-001.m4a"),
    );
    tracks.push({
      id: "system-1",
      kind: "systemAudio",
      source: "system",
      segments: [{ file: "system-1-001.m4a", start: 0, end }],
    });
  }

  // The pointer drifting around the screen, with a few clicks, for pointer effects to draw.
  const pointer = (t) => ({
    x: Math.round(DISPLAY.width / 2 + Math.sin(t / 3) * 520),
    y: Math.round(DISPLAY.height / 2 + Math.cos(t / 4.3) * 300),
  });
  const input = [];
  for (let t = 0.5; t < end; t += 0.1)
    input.push({ type: "move", time: +t.toFixed(2), ...pointer(t) });
  for (const t of [end * 0.22, end * 0.48, end * 0.71]) {
    input.push({ type: "down", time: +t.toFixed(2), button: "left", ...pointer(t) });
    input.push({ type: "up", time: +(t + 0.15).toFixed(2), button: "left", ...pointer(t) });
  }
  input.sort((a, b) => a.time - b.time);
  writeFileSync(
    join(session, "input.jsonl"),
    input.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );

  writeFileSync(
    join(session, "session.json"),
    JSON.stringify({
      version: 1,
      id,
      createdAt: "2026-10-28T15:00:00Z",
      hostTimeOrigin: 0,
      config: {},
      pauses: [],
      marks: [],
      stoppedAt: end,
      stopReason: "requested",
      input: "input.jsonl",
      tracks,
    }),
  );
  writeFileSync(
    join(session, "transcript.json"),
    JSON.stringify({ version: 1, model: "parakeet-tdt-0.6b-v3", cues }),
  );
  index[project.name] = {
    directory: session,
    duration: end,
    hasCamera,
    hasSystemAudio: !!project.systemAudio,
    lines: cues.map(({ start, end }) => ({ start, end })),
  };
  console.log(`  ${project.name}: ${end.toFixed(1)}s`);
});
writeFileSync(join(work, "media.json"), JSON.stringify(index, null, 2));
