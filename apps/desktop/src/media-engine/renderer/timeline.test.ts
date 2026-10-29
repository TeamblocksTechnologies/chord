import assert from "node:assert/strict";
import { test } from "node:test";
import type { InputEvent, Manifest, ManifestTrack } from "@teamblocks.dev/chord-recorder-protocol";
import {
  buildTimeline,
  clipIndexAt,
  cropOf,
  followerAt,
  groupLayersOf,
  inputOnPlayback,
  layersOf,
  marksOf,
  marksOnPlayback,
  partIndexAt,
  sequence,
  snap,
  spanBlocks,
  splitAt,
  toProject,
  toRecording,
  wholeLayersOf,
  withCuts,
  type Timeline,
} from "./timeline.ts";
import { audioPeaks, waveformPath } from "./waveform.ts";
import { noAnnotations } from "#features/editing/domain/annotations";
import { annotationTracksOf } from "./annotations.ts";
import { mediaUrl, parseBounds, parseInput } from "../contracts/playback.ts";
import { piecesOf } from "#project-document/domain/recording";

const display = { id: 1, frame: { x: 0, y: 0, width: 1728, height: 1117 }, scale: 2 };

function session(tracks: ManifestTrack[], bounds = {}, input: InputEvent[] = []) {
  const manifest: Manifest = {
    version: 1,
    id: "s",
    createdAt: "2026-10-20T00:00:00Z",
    hostTimeOrigin: 0,
    config: {} as Manifest["config"],
    tracks,
    pauses: [],
    marks: [],
  };
  return { directory: "/r/s", manifest, bounds, input };
}

const noProbe = async () => assert.fail("nothing to probe");

test("annotation tracks belong to each recording, and missing layers can still be added", async () => {
  const timeline = await buildTimeline(
    session(
      [
        {
          id: "screen-1",
          kind: "screen",
          source: "display:1",
          display,
          segments: [{ file: "screen.mov", start: 0, end: 2 }],
        },
      ],
      {},
      [{ type: "move", time: 0, x: 1, y: 1 }],
    ),
    noProbe,
  );
  const { parts } = sequence([
    { recordingId: "first", timeline: timeline! },
    { recordingId: "second", timeline: timeline! },
  ]);
  const project = {
    recordings: [
      {
        id: "first",
        annotations: { laser: [{ start: 0, end: 1 }], clicks: [], keys: [{ start: 0, end: 1 }] },
        annotationTracks: ["clicks"],
      },
      { id: "second", annotations: { ...noAnnotations(), clicks: [{ start: 0.5, end: 1 }] } },
      { id: "outside", annotations: { ...noAnnotations(), laser: [{ start: 0, end: 1 }] } },
    ] as Parameters<typeof annotationTracksOf>[1]["recordings"],
  };
  const added = (timelineParts = parts) =>
    annotationTracksOf(timelineParts, project)
      .filter((track) => track.added)
      .map((track) => track.kind);
  assert.deepEqual(added(parts.slice(0, 1)), ["laser", "clicks", "keys"]);
  assert.deepEqual(
    added(parts.slice(1)),
    ["clicks"],
    "A second recording only shows the effect used during that recording",
  );
  assert.deepEqual(
    added(),
    ["clicks"],
    "Effects missing from some recordings remain available to add",
  );
  project.recordings[1]!.annotationTracks = ["keys"];
  assert.deepEqual(
    added(parts.slice(1)),
    ["clicks", "keys"],
    "Explicit additions show even without spans",
  );
  assert.deepEqual(added(), ["clicks", "keys"]);
  project.recordings[1]!.annotations.clicks = [{ start: 3, end: 4 }];
  assert.deepEqual(
    added(parts.slice(1)),
    ["keys"],
    "Spans outside the playable timeline do not create layers",
  );
  assert.deepEqual(
    annotationTracksOf([], project).map(({ kind, added, available }) => [kind, added, available]),
    [
      ["laser", false, false],
      ["clicks", false, false],
      ["keys", false, false],
      ["cursor", false, false],
    ],
  );
  const withoutInput = parts.map((part) => ({
    ...part,
    timeline: { ...part.timeline, input: undefined },
  }));
  assert.equal(
    annotationTracksOf(withoutInput, project).some((track) => track.added || track.available),
    false,
  );
});

test("the screen leads, laid end to end across a pause, with camera and audio following", async () => {
  const timeline = await buildTimeline(
    session([
      {
        id: "mic-1",
        kind: "microphone",
        source: "m",
        segments: [{ file: "mic-1-001.m4a", start: 0.5, end: 10 }],
      },
      {
        id: "camera-1",
        kind: "camera",
        source: "c",
        segments: [{ file: "camera-1-001.mp4", start: 0.7, end: 10 }],
      },
      {
        id: "screen-1",
        kind: "screen",
        source: "display:1",
        display,
        segments: [
          {
            file: "screen-1-001.mov",
            start: 0.2,
            end: 4,
            endReason: "paused",
            screenMode: { type: "display" },
          },
          { file: "screen-1-002.mov", start: 6, end: 9, screenMode: { type: "focusedWindow" } },
        ],
      },
    ]),
    noProbe,
  );
  assert.ok(timeline);
  assert.equal(timeline.lead, "screen");
  assert.deepEqual(
    timeline.clips.map((clip) => [clip.offset, clip.focused]),
    [
      [0, false],
      [3.8, true],
    ],
  );
  assert.equal(timeline.duration, 6.8);
  assert.equal(timeline.clips[0]!.url, mediaUrl("/r/s", "screen-1-001.mov"));
  assert.equal(timeline.camera.length, 1);
  assert.equal(timeline.audio.length, 1);
  assert.equal(clipIndexAt(timeline.clips, 5), 1);
});

test("a pinned window's track follows the mode's screen, named for its window and cropped to where it was", async () => {
  const pinned: ManifestTrack = {
    id: "window-1-screen-1",
    kind: "screen",
    source: "window:41",
    display,
    window: { id: 41, bundleId: "com.apple.Safari", title: "Docs" },
    bounds: "window-1-screen-1-bounds.jsonl",
    segments: [{ file: "window-1-screen-1-001.mov", start: 0, end: 4 }],
  };
  const timeline = await buildTimeline(
    session(
      [
        pinned,
        {
          id: "screen-1",
          kind: "screen",
          source: "display:1",
          display,
          segments: [
            { file: "screen-1-001.mov", start: 0, end: 4, screenMode: { type: "focusedWindow" } },
          ],
        },
      ],
      {
        "window-1-screen-1": [
          { time: 0, window: 41, frame: { x: 172.8, y: 111.7, width: 864, height: 558.5 } },
          { time: 2, window: 41, frame: { x: 345.6, y: 111.7, width: 864, height: 558.5 } },
        ],
      },
    ),
    noProbe,
  );
  assert.ok(timeline);
  assert.deepEqual(
    timeline.video!.map((source) => [source.id, source.index, source.lead, source.window?.title]),
    [
      ["screen-1", 0, true, undefined],
      ["window-1-screen-1", 1, false, "Docs"],
    ],
  );
  const crop = timeline.video![1]!.clips[0]!.crop!;
  assert.deepEqual(
    [crop.x, crop.y, crop.width, crop.height].map((n) => Math.round(n * 100) / 100),
    [0.1, 0.1, 0.6, 0.5],
    "Everywhere it was over the clip",
  );
  const { parts } = sequence([{ recordingId: "r", timeline }]);
  assert.deepEqual(
    layersOf(parts[0]!).map((layer) => [layer.kind, layer.index, layer.window?.id]),
    [
      ["screen", 0, undefined],
      ["screen", 1, 41],
    ],
  );
});

test("a pinned window is cropped to what of it was on the display while the clip ran", () => {
  const area = { x: 0, y: 0, width: 100, height: 100 };
  const bounds = [
    { time: 0, frame: { x: 10, y: 10, width: 20, height: 20 } },
    { time: 5, frame: { x: 90, y: 50, width: 40, height: 20 } },
    { time: 8 },
  ];
  assert.deepEqual(
    cropOf(bounds, area, 1, 4),
    { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    "The sample before the clip still applies",
  );
  assert.deepEqual(
    cropOf(bounds, area, 6, 10),
    { x: 0.9, y: 0.5, width: 0.1, height: 0.2 },
    "Clipped to the display",
  );
  assert.equal(cropOf(bounds, area, 9, 10), undefined, "Not on the display");
});

test("without a screen the camera leads, and audio follows", async () => {
  const timeline = await buildTimeline(
    session([
      {
        id: "mic-1",
        kind: "microphone",
        source: "m",
        segments: [{ file: "mic-1-001.m4a", start: 0, end: 5 }],
      },
      {
        id: "camera-1",
        kind: "camera",
        source: "c",
        segments: [{ file: "camera-1-001.mp4", start: 0.3, end: 5 }],
      },
    ]),
    noProbe,
  );
  assert.equal(timeline?.lead, "camera");
  assert.deepEqual(timeline?.camera, []);
  assert.equal(timeline?.audio.length, 1);
});

test("audio alone leads; nothing recorded plays nothing", async () => {
  const audio = await buildTimeline(
    session([
      {
        id: "system-audio",
        kind: "systemAudio",
        source: "system",
        segments: [{ file: "system-audio-001.m4a", start: 0, end: 2 }],
      },
    ]),
    noProbe,
  );
  assert.equal(audio?.lead, "systemAudio");
  assert.deepEqual(audio?.audio, []);
  assert.equal(await buildTimeline(session([]), noProbe), null);
});

test("unfinished segments are measured from their files", async () => {
  const timeline = await buildTimeline(
    session([
      {
        id: "camera-1",
        kind: "camera",
        source: "c",
        segments: [{ file: "camera-1-001.mp4", start: 1 }],
      },
    ]),
    async () => 3.5,
  );
  assert.equal(timeline?.duration, 3.5);
});

test("followers hold their first frame just before they start, and stop where they weren't recording", () => {
  const clips = [{ url: "a", file: "a", start: 2, duration: 3, offset: 0, focused: false }];
  assert.deepEqual(followerAt(clips, 1.5), { clip: clips[0], time: 0, early: true });
  assert.deepEqual(followerAt(clips, 3), { clip: clips[0], time: 1, early: false });
  assert.equal(followerAt(clips, 0.5), undefined);
  assert.equal(followerAt(clips, 5), undefined);
});

test("bounds lines that can't be read are skipped", () => {
  assert.deepEqual(parseBounds('{"time":0,"window":1}\n\n{"time":1,"fr'), [{ time: 0, window: 1 }]);
});

test("a project's recordings play one after another", async () => {
  const take = (end: number) =>
    buildTimeline(
      session([
        {
          id: "camera-1",
          kind: "camera",
          source: "c",
          segments: [{ file: "camera-1-001.mp4", start: 0, end }],
        },
      ]),
      noProbe,
    );
  const { parts, duration } = sequence([
    { recordingId: "a", timeline: (await take(3))! },
    { recordingId: "b", timeline: (await take(2))! },
  ]);
  assert.deepEqual(
    parts.map((part) => [part.recordingId, part.offset]),
    [
      ["a", 0],
      ["b", 3],
    ],
  );
  assert.equal(duration, 5);
  assert.equal(partIndexAt(parts, 2.9), 0);
  assert.equal(partIndexAt(parts, 3), 1);
});

test("each piece's files are laid on the project's timeline by layer, cut where the leading track skips", async () => {
  const first = await buildTimeline(
    session([
      {
        id: "screen-1",
        kind: "screen",
        source: "display:1",
        display,
        segments: [
          { file: "screen-1-001.mov", start: 0, end: 2, screenMode: { type: "display" } },
          {
            file: "screen-1-002.mov",
            start: 2,
            end: 4,
            endReason: "paused",
            screenMode: { type: "focusedWindow" },
          },
          { file: "screen-1-003.mov", start: 6, end: 8, screenMode: { type: "display" } },
        ],
      },
      // Runs on across the mode change, and on through the pause.
      {
        id: "camera-1",
        kind: "camera",
        source: "c",
        segments: [{ file: "camera-1-001.mp4", start: 0.5, end: 8 }],
      },
      {
        id: "mic-1",
        kind: "microphone",
        source: "m",
        segments: [
          { file: "mic-1-001.m4a", start: 0, end: 4 },
          { file: "mic-1-002.m4a", start: 6, end: 8 },
        ],
      },
    ]),
    noProbe,
  );
  const second = await buildTimeline(
    session([
      {
        id: "camera-1",
        kind: "camera",
        source: "c",
        segments: [{ file: "camera-1-001.mp4", start: 0, end: 3 }],
      },
      {
        id: "system-audio",
        kind: "systemAudio",
        source: "s",
        segments: [{ file: "system-audio-001.m4a", start: 1, end: 3 }],
      },
    ]),
    noProbe,
  );
  const { parts } = sequence([
    { recordingId: "a", timeline: first! },
    { recordingId: "b", timeline: second! },
  ]);
  const layers = parts.map((part) =>
    layersOf(part).map((layer) => [
      layer.kind,
      layer.blocks.map((block) => [block.file, block.start, block.end]),
    ]),
  );
  assert.deepEqual(layers, [
    [
      [
        "screen",
        [
          ["screen-1-001.mov", 0, 2],
          ["screen-1-002.mov", 2, 4],
          ["screen-1-003.mov", 4, 6],
        ],
      ],
      [
        "camera",
        [
          ["camera-1-001.mp4", 0.5, 4],
          ["camera-1-001.mp4", 4, 6],
        ],
      ],
      [
        "microphone",
        [
          ["mic-1-001.m4a", 0, 4],
          ["mic-1-002.m4a", 4, 6],
        ],
      ],
    ],
    [
      ["camera", [["camera-1-001.mp4", 6, 9]]],
      ["systemAudio", [["system-audio-001.m4a", 7, 9]]],
    ],
  ]);
});

test("input lines are sorted into time order, skipping any that can't be read", () => {
  const text =
    '{"type":"move","time":1,"x":0,"y":0}\n{"type":"key","time":0.5,"key":8,"modifiers":["command"],"duration":0.6}\n{"type":"mo';
  assert.deepEqual(
    parseInput(text).map((event) => event.time),
    [0.5, 1],
  );
});

test("marks move onto the playback timeline, follow cuts and land where each piece plays them", () => {
  const clips = [
    { url: "a", file: "a", start: 0, duration: 4, offset: 0, focused: false },
    { url: "b", file: "b", start: 6, duration: 4, offset: 4, focused: false },
  ];
  const marks = marksOnPlayback(clips, [
    { id: "late", time: 12, kind: "mark" },
    { id: "first", time: 1, kind: "mark" },
    // Added while paused: where the recording picks up again.
    { id: "paused", time: 5, kind: "retake", note: "again" },
    { id: "second", time: 7, kind: "mark" },
  ]);
  assert.deepEqual(
    marks.map((mark) => [mark.id, mark.time]),
    [
      ["first", 1],
      ["paused", 4],
      ["second", 5],
      ["late", 8],
    ],
  );
  assert.equal(marks[1]!.note, "again");

  const timeline = { clips, duration: 8, marks } as unknown as Timeline;
  const cut = withCuts(timeline, [
    { start: 0.5, end: 2 },
    { start: 4.5, end: 6 },
  ]);
  assert.deepEqual(
    cut.marks!.map((mark) => [mark.id, mark.time]),
    [
      ["paused", 2.5],
      ["late", 5],
    ],
  );

  const { parts } = sequence([
    { id: "a", recordingId: "r", timeline, start: 3, end: 6 },
    { id: "b", recordingId: "r", timeline, start: 0, end: 2 },
  ]);
  assert.deepEqual(
    marksOf(parts).map((mark) => [mark.pieceId, mark.id, mark.time]),
    [
      ["a", "paused", 1],
      ["a", "second", 2],
      ["b", "first", 4],
    ],
  );
});

test("the recorded mouse and keys move onto the playback timeline, leaving out the pause", () => {
  const clips = [
    { url: "a", file: "a", start: 0, duration: 4, offset: 0, focused: false },
    { url: "b", file: "b", start: 6, duration: 4, offset: 4, focused: false },
  ];
  const input = inputOnPlayback(clips, [
    { type: "move", time: 0, x: 1, y: 1 },
    { type: "move", time: 3, x: 2, y: 2 },
    { type: "down", time: 3, button: "left", x: 2, y: 2 },
    // Let go during the pause.
    { type: "up", time: 5, button: "left", x: 2, y: 2 },
    { type: "move", time: 5, x: 3, y: 3 },
    { type: "key", time: 5.5, key: 36, modifiers: [], duration: 0.1 },
    { type: "down", time: 7, button: "right", x: 3, y: 3 },
    { type: "up", time: 7.25, button: "right", x: 3, y: 3 },
    { type: "key", time: 9, key: 8, modifiers: ["command"], duration: 2 },
  ]);
  assert.deepEqual(input.cursor, [
    { time: 0, x: 1, y: 1, cut: true },
    { time: 3, x: 2, y: 2 },
    // Where the cursor went while paused is where the next clip starts.
    { time: 4, x: 3, y: 3, cut: true },
  ]);
  assert.deepEqual(input.clicks, [
    { time: 3, end: 4, button: "left", x: 2, y: 2 },
    { time: 5, end: 5.25, button: "right", x: 3, y: 3 },
  ]);
  assert.deepEqual(input.keys, [{ time: 7, end: 8, key: 8, modifiers: ["command"] }]);
});

test("area clips show their area of the display, and only screen-led recordings with input get effects", async () => {
  const timeline = await buildTimeline(
    session(
      [
        {
          id: "area-2-screen-1",
          kind: "screen",
          source: "display:1",
          display: { ...display, frame: { x: 100, y: 0, width: 1728, height: 1117 } },
          segments: [
            {
              file: "area-2-screen-1-001.mov",
              start: 0,
              end: 2,
              screenMode: {
                type: "area",
                areas: [
                  { displayId: 1, x: 0, y: 0, width: 10, height: 10 },
                  { displayId: 2, x: 0, y: 0, width: 5, height: 5 },
                  { displayId: 1, x: 50, y: 60, width: 300, height: 200 },
                ],
              },
            },
          ],
        },
      ],
      {},
      [{ type: "move", time: 0, x: 1, y: 1 }],
    ),
    noProbe,
  );
  assert.deepEqual(timeline?.clips[0]!.region, { x: 150, y: 60, width: 300, height: 200 });
  assert.ok(timeline?.input);
  const cameraOnly = await buildTimeline(
    session(
      [
        {
          id: "camera-1",
          kind: "camera",
          source: "c",
          segments: [{ file: "camera-1-001.mp4", start: 0, end: 3 }],
        },
      ],
      {},
      [{ type: "move", time: 0, x: 1, y: 1 }],
    ),
    noProbe,
  );
  assert.equal(cameraOnly?.input, undefined);

  const { parts } = sequence([
    { recordingId: "b", timeline: cameraOnly! },
    { recordingId: "a", timeline: timeline! },
  ]);
  const annotations = {
    ...noAnnotations(),
    laser: [
      { start: 0.5, end: 9 },
      { start: 5, end: 6 },
    ],
  };
  assert.deepEqual(
    spanBlocks(parts, (id) => (id === "a" ? annotations : undefined), "laser"),
    [
      // Cut at the end of the recording; a span past it isn't shown.
      { pieceId: "a", recordingId: "a", index: 0, start: 3.5, end: 5 },
    ],
  );
});

test("waveform peaks preserve silence, short transients and opposite-phase stereo", () => {
  const left = new Float32Array(45);
  const right = new Float32Array(45);
  left[11] = -0.25;
  right[11] = 0.25;
  left[29] = 0.75;
  right[44] = -1;
  const waveform = audioPeaks([left, right], 1000);
  assert.equal(waveform.secondsPerPeak, 0.01);
  assert.deepEqual([...waveform.peaks], [0, 0.25, 0.75, 0, 1]);
  assert.deepEqual([...audioPeaks([], 24000).peaks], []);
});

test("waveform envelopes use source time, leave silence flat and only draw the visible range", () => {
  const waveform = { peaks: new Float32Array([0, 0, 1, 1, 0.25, 0.25]), secondsPerPeak: 1 };
  assert.equal(waveformPath(waveform, 0, 2, 6, 0, 6), "");
  const loud = waveformPath(waveform, 2, 2, 6, 0, 6);
  assert.match(loud, /^M0.00,2.00C/);
  assert.match(loud, /L6.00,22.00C/);
  assert.ok(loud.endsWith("Z"), "The envelope is a closed shape");
  const quiet = waveformPath(waveform, 4, 2, 6, 0, 6);
  assert.match(quiet, /^M0.00,7.00C/);
  assert.match(quiet, /L6.00,17.00C/);
  const visible = waveformPath(waveform, 2, 2, 600000, 300000, 300006);
  assert.ok(visible.length < 1000, "Only the visible curve and its edge neighbors are generated");
  assert.match(visible, /C/);
  assert.equal(waveformPath(waveform, 0, 2, 0, 0, 6), "");
});

test("waveform pieces retain source offsets across pauses, mode changes and later recordings", async () => {
  const timeline = (await buildTimeline(
    session([
      {
        id: "screen",
        kind: "screen",
        source: "display:1",
        display,
        segments: [
          { file: "screen-a.mov", start: 1, end: 3 },
          { file: "screen-b.mov", start: 3, end: 5 },
          { file: "screen-c.mov", start: 7, end: 9 },
        ],
      },
      {
        id: "mic",
        kind: "microphone",
        source: "m",
        segments: [{ file: "mic.m4a", start: 0.5, end: 9 }],
      },
    ]),
    noProbe,
  ))!;
  const { parts } = sequence([
    { recordingId: "a", timeline },
    { recordingId: "b", timeline },
  ]);
  const mic = parts.flatMap(
    (part) => layersOf(part).find((layer) => layer.kind === "microphone")!.blocks,
  );
  assert.deepEqual(
    mic.map(({ start, end, sourceStart, url }) => [start, end, sourceStart, url]),
    [
      [0, 4, 0.5, mediaUrl("/r/s", "mic.m4a")],
      [4, 6, 6.5, mediaUrl("/r/s", "mic.m4a")],
      [6, 10, 0.5, mediaUrl("/r/s", "mic.m4a")],
      [10, 12, 6.5, mediaUrl("/r/s", "mic.m4a")],
    ],
  );
  const audioOnly = (await buildTimeline(
    session([
      {
        id: "mic",
        kind: "microphone",
        source: "m",
        segments: [{ file: "mic.m4a", start: 4, end: 6 }],
      },
    ]),
    noProbe,
  ))!;
  const block = layersOf(sequence([{ recordingId: "audio", timeline: audioOnly }]).parts[0]!)[0]!
    .blocks[0]!;
  assert.equal(block.sourceStart, 0);
  assert.equal(block.url, mediaUrl("/r/s", "mic.m4a"));
});

test("pieces play stretches of their recordings in any order, cutting each layer and effect to what they play", async () => {
  const timeline = (await buildTimeline(
    session(
      [
        {
          id: "screen",
          kind: "screen",
          source: "display:1",
          display,
          segments: [
            { file: "screen-a.mov", start: 0, end: 4 },
            { file: "screen-b.mov", start: 6, end: 10 },
          ],
        },
        {
          id: "mic",
          kind: "microphone",
          source: "m",
          segments: [{ file: "mic.m4a", start: 0, end: 10 }],
        },
      ],
      {},
      [{ type: "move", time: 0, x: 1, y: 1 }],
    ),
    noProbe,
  ))!;
  // Split at 3, the end trimmed from 8 to 7 and played first, and a piece left with nothing of its recording.
  const { parts, duration } = sequence([
    { id: "tail", recordingId: "a", timeline, start: 3, end: 7 },
    { id: "head", recordingId: "a", timeline, start: 0, end: 3 },
    { id: "gone", recordingId: "a", timeline, start: 9, end: null },
  ]);
  assert.deepEqual(
    parts.map(({ pieceId, offset, start, end }) => [pieceId, offset, start, end]),
    [
      ["tail", 0, 3, 7],
      ["head", 4, 0, 3],
    ],
  );
  assert.equal(duration, 7);
  assert.equal(partIndexAt(parts, 4), 1);
  assert.equal(toRecording(parts[0]!, 1.5), 4.5);
  assert.equal(toProject(parts[1]!, 2), 6);

  const [screen, mic] = layersOf(parts[0]!);
  assert.deepEqual(
    screen!.blocks.map(({ file, start, end, sourceStart }) => [file, start, end, sourceStart]),
    [
      ["screen-a.mov", 0, 1, 3],
      ["screen-b.mov", 1, 4, 0],
    ],
  );
  // The microphone runs through the pause, so after it, it plays from further into its file.
  assert.deepEqual(
    mic!.blocks.map(({ start, end, sourceStart }) => [start, end, sourceStart]),
    [
      [0, 1, 3],
      [1, 4, 6],
    ],
  );

  // Around a trimmed piece, the rest of each file shows where it would play.
  const [wholeScreen, wholeMic] = wholeLayersOf(parts[0]!);
  const shape = ({
    file,
    start,
    end,
    sourceStart,
    trimmed,
    joinsBefore,
    joinsAfter,
  }: ReturnType<typeof layersOf>[number]["blocks"][number]) => [
    file,
    start,
    end,
    sourceStart,
    !!trimmed,
    !!joinsBefore,
    !!joinsAfter,
  ];
  // Cut where the piece starts and ends, each file runs on into what's trimmed off it.
  assert.deepEqual(wholeScreen!.blocks.map(shape), [
    ["screen-a.mov", -3, 0, 0, true, false, true],
    ["screen-a.mov", 0, 1, 3, false, true, false],
    ["screen-b.mov", 1, 4, 0, false, false, true],
    ["screen-b.mov", 4, 5, 3, true, true, false],
  ]);
  assert.deepEqual(
    wholeMic!.blocks
      .filter((block) => !block.trimmed)
      .map(({ start, end, sourceStart }) => [start, end, sourceStart]),
    mic!.blocks.map(({ start, end, sourceStart }) => [start, end, sourceStart]),
    "What plays matches the piece's layers",
  );
  assert.deepEqual(
    wholeLayersOf({ ...parts[0]!, start: 0, end: 8 })
      .flatMap((layer) => layer.blocks)
      .filter((block) => block.trimmed),
    [],
  );

  const annotations = { ...noAnnotations(), clicks: [{ start: 2, end: 5 }] };
  assert.deepEqual(
    spanBlocks(parts, () => annotations, "clicks"),
    [
      { pieceId: "tail", recordingId: "a", index: 0, start: 0, end: 2 },
      { pieceId: "head", recordingId: "a", index: 0, start: 6, end: 7 },
    ],
  );
});

test("a piece splits in two at a time inside it, leaving the rest of the edit as it was", async () => {
  const timeline = (await buildTimeline(
    session([
      {
        id: "screen",
        kind: "screen",
        source: "display:1",
        display,
        segments: [{ file: "screen.mov", start: 0, end: 10 }],
      },
    ]),
    noProbe,
  ))!;
  const { parts } = sequence([
    { id: "first", recordingId: "a", timeline, start: 2, end: 6 },
    { id: "second", recordingId: "b", timeline, start: 0, end: 3 },
  ]);
  const split = splitAt(parts, "first", 1.5, "new")!;
  assert.deepEqual(
    split.map(({ pieceId, recordingId, offset, start, end }) => [
      pieceId,
      recordingId,
      offset,
      start,
      end,
    ]),
    [
      ["first", "a", 0, 2, 3.5],
      ["new", "a", 1.5, 3.5, 6],
      ["second", "b", 4, 0, 3],
    ],
  );
  assert.deepEqual(
    sequence(split.map((part) => ({ ...part, id: part.pieceId }))).duration,
    7,
    "Splitting doesn't change what plays",
  );
  assert.equal(
    splitAt(parts, "second", 5, "new")?.[2]?.start,
    1,
    "A later piece splits on its own recording's time",
  );
  assert.equal(splitAt(parts, "first", 5, "new"), undefined, "Only where the piece is");
  assert.equal(
    splitAt(parts, "first", 0, "new"),
    undefined,
    "Nothing to split at the start of a piece",
  );
  assert.equal(splitAt(parts, "first", 4, "new"), undefined, "Nor at its end");
  assert.equal(splitAt(parts, "second", 5, "new", 0.2)?.length, 3);
  assert.equal(
    splitAt(parts, "second", 4.1, "new", 0.2),
    undefined,
    "Too close to an edge leaves a piece too short",
  );
});

test("a split recording's pieces share its layers, cut where they meet", async () => {
  const timeline = (await buildTimeline(
    session([
      {
        id: "screen",
        kind: "screen",
        source: "display:1",
        display,
        segments: [{ file: "screen.mov", start: 0, end: 10 }],
      },
    ]),
    noProbe,
  ))!;
  const { parts } = sequence([{ id: "first", recordingId: "a", timeline, start: 2, end: 6 }]);
  const shape = ({
    pieceId,
    start,
    end,
    sourceStart,
    trimmed,
    joinsBefore,
    joinsAfter,
  }: ReturnType<typeof groupLayersOf>[number]["blocks"][number]) => [
    pieceId,
    start,
    end,
    sourceStart,
    !!trimmed,
    !!joinsBefore,
    !!joinsAfter,
  ];
  const split = splitAt(parts, "first", 1.5, "new")!;
  const [screen, ...rest] = groupLayersOf(split);
  assert.equal(rest.length, 0, "One layer per track, not per piece");
  assert.deepEqual(
    screen!.blocks.map(shape),
    [
      ["first", -2, 0, 0, true, false, true],
      ["first", 0, 1.5, 2, false, true, false],
      ["new", 1.5, 4, 3.5, false, false, true],
      ["new", 4, 8, 6, true, true, false],
    ],
    "Nothing trimmed shows between the halves, so the cut shows",
  );
  // Moved apart, the first's trimmed end fills the gap, and the second's trimmed start only what's left of it.
  const apart = split.map((part) => (part.pieceId === "new" ? { ...part, offset: 3 } : part));
  assert.deepEqual(
    groupLayersOf(apart)[0]!
      .blocks.filter((block) => block.trimmed)
      .map(shape),
    [
      ["first", -2, 0, 0, true, false, true],
      ["first", 1.5, 3, 3.5, true, true, false],
      ["new", 5.5, 9.5, 6, true, true, false],
    ],
  );
});

test("placed pieces keep their time, leaving gaps and overlapping with the one above on top", async () => {
  const timeline = (await buildTimeline(
    session([
      {
        id: "screen",
        kind: "screen",
        source: "display:1",
        display,
        segments: [{ file: "screen.mov", start: 0, end: 4 }],
      },
    ]),
    noProbe,
  ))!;
  const { parts, duration } = sequence([
    { id: "top", recordingId: "a", timeline, offset: 6 },
    { id: "under", recordingId: "b", timeline, start: 1, offset: 1 },
    { id: "after", recordingId: "a", timeline, end: 1 },
  ]);
  assert.deepEqual(
    parts.map(({ pieceId, offset }) => [pieceId, offset]),
    [
      ["top", 6],
      ["under", 1],
      ["after", 10],
    ],
    "Without a place, a piece goes after everything before it",
  );
  assert.equal(duration, 11);
  assert.equal(partIndexAt(parts, 0.5), -1, "Nothing plays before the first piece");
  assert.equal(partIndexAt(parts, 1), 1);
  assert.equal(partIndexAt(parts, 4.5), -1, "Nor in a gap");
  assert.equal(partIndexAt(parts, 6), 0);
  assert.equal(partIndexAt(parts, 10.5), 2);
  assert.equal(partIndexAt(parts, 11), -1);
  const overlapping = sequence([
    { id: "top", recordingId: "a", timeline, offset: 2 },
    { id: "under", recordingId: "b", timeline, offset: 0 },
  ]);
  assert.deepEqual(
    [1, 3, 5].map((time) => partIndexAt(overlapping.parts, time)),
    [1, 0, 0],
    "The piece above plays where they overlap",
  );
  assert.equal(overlapping.duration, 6);
  assert.equal(
    sequence([{ recordingId: "a", timeline, offset: -2 }]).parts[0]!.offset,
    0,
    "Nothing starts before the timeline",
  );
});

test("dragged edges snap to the nearest target within reach", () => {
  assert.deepEqual(snap([2.05], [1, 2, 3], 0.1), { shift: 2 - 2.05, at: 2 });
  assert.equal(snap([2.5], [1, 2, 3], 0.1), undefined);
  // Either edge of a moved span can snap; the closer one wins.
  const moved = snap([1.08, 3.03], [1, 3], 0.1)!;
  assert.equal(moved.at, 3);
  assert.ok(Math.abs(moved.shift + 0.03) < 1e-9);
});

test("an unedited project plays each recording whole", () => {
  const recordings = [{ id: "a" }, { id: "b" }] as Parameters<typeof piecesOf>[0]["recordings"];
  assert.deepEqual(piecesOf({ recordings }), [
    { id: "a", recordingId: "a", start: 0, end: null },
    { id: "b", recordingId: "b", start: 0, end: null },
  ]);
  const pieces = [{ id: "p", recordingId: "b", start: 1, end: 2 }];
  assert.equal(piecesOf({ recordings, pieces }), pieces);
});
