import assert from "node:assert/strict";
import { test } from "node:test";
import { noAnnotations } from "../domain/annotations.ts";
import {
  initialSetup,
  isPiece,
  sequencedPieces,
  type Project,
  type Recording,
} from "#project-document/domain/recording";
import type { TranscriptionState } from "#features/transcription/domain/captions";
import type { BackgroundState } from "#features/background-removal/contracts/backgroundRemoval";
import {
  hasTrack,
  isSelectedTrack,
  selectedRecording,
  selectedTrack,
  selectedTrackIndex,
  selectedLayerId,
  withTrack,
} from "../renderer/selection.ts";
import { recordingTrackSections } from "#media-engine/renderer/recordingTracks";
import { visualLayersOf } from "../domain/visualLayers.ts";
import type { GroupLayer } from "#media-engine/renderer/timeline";
import {
  audioDenoised,
  audioGain,
  audioLevel,
  audioTrackSettings,
  withAudioSettings,
} from "../domain/audioSettings.ts";
import {
  unprocessedRecordings,
  untranscribedRecordings,
} from "#project-document/renderer/recordingJobs";
import { sequence, splitAt, type Timeline } from "#media-engine/renderer/timeline";

const recording = (id: string, changes: Partial<Recording> = {}): Recording => ({
  id,
  createdAt: "2026-10-21T12:00:00Z",
  duration: 10,
  mode: "display",
  hasCamera: true,
  hasMicrophone: true,
  hasSystemAudio: false,
  markCount: 0,
  pageChanges: [],
  annotations: noAnnotations(),
  directory: `/${id}`,
  ...changes,
});
const project: Project = {
  id: "project",
  name: "Demo",
  createdAt: "",
  updatedAt: "",
  notes: [],
  setup: initialSetup(),
  recordings: [recording("one"), recording("two")],
  pieces: [{ id: "clip", recordingId: "two", start: 1, end: 3 }],
};

test("recording tracks follow setup source order with effects under Screen", () => {
  const source = recording("layers", { hasSystemAudio: true, annotationTracks: ["laser"] });
  const media: GroupLayer[] = [
    { kind: "screen", index: 0, blocks: [] },
    { kind: "camera", index: 0, blocks: [] },
    { kind: "microphone", index: 0, blocks: [] },
    { kind: "microphone", index: 1, blocks: [] },
    { kind: "systemAudio", index: 0, blocks: [] },
  ];
  const layers = visualLayersOf(source);
  const sections = recordingTrackSections(media, layers);
  assert.deepEqual(
    sections.map((section) => section.label),
    ["Screen", "Camera", "Microphone", "System audio"],
  );
  assert.deepEqual(
    sections.map((section) => section.rows.map((row) => row.id)),
    [["screen:0", "laser:0"], ["camera:0"], ["microphone:0", "microphone:1"], ["systemAudio:0"]],
  );
  assert.deepEqual(
    recordingTrackSections(media, [...layers].reverse()),
    sections,
    "Saved visual ordering does not change source groups",
  );
  assert.deepEqual(
    recordingTrackSections(
      media.filter((layer) => layer.kind === "camera"),
      [],
    ),
    [{ id: "camera", label: "Camera", rows: [{ id: "camera:0", type: "media", layer: media[1] }] }],
    "Empty source sections are omitted",
  );
  assert.equal(
    selectedLayerId({
      type: "span",
      recordingId: "layers",
      kind: "laser",
      index: 0,
      layerId: "copy",
    }),
    "copy",
  );
  assert.equal(
    selectedLayerId({
      type: "recording",
      recordingId: "layers",
      track: "laser",
      layerId: "original",
    }),
    "original",
  );
});

test("recording, clip and annotation selections resolve the same source independently of playback", () => {
  assert.equal(selectedRecording(project, null), undefined);
  assert.equal(selectedRecording(project, { type: "recording", recordingId: "one" })?.id, "one");
  assert.equal(selectedRecording(project, { type: "piece", pieceId: "clip" })?.id, "two");
  assert.equal(
    selectedRecording(project, { type: "span", recordingId: "two", kind: "clicks", index: 0 })?.id,
    "two",
  );
  assert.equal(selectedRecording(project, { type: "piece", pieceId: "deleted" }), undefined);
  assert.equal(
    selectedRecording({ ...project, recordings: [] }, { type: "piece", pieceId: "clip" }),
    undefined,
  );
  assert.equal(
    selectedRecording({ ...project, pieces: undefined }, { type: "piece", pieceId: "one" })?.id,
    "one",
    "Unedited projects use recording ids for their implicit clips",
  );
});

test("every media and annotation track has its own selection and controls", () => {
  assert.equal(selectedTrack(null), undefined);
  assert.equal(
    selectedTrack({ type: "recording", recordingId: "one" }),
    undefined,
    "A recording on its own shows its general settings",
  );
  assert.equal(
    selectedTrack({ type: "piece", pieceId: "clip", track: "microphone" }),
    "microphone",
  );
  assert.equal(
    selectedTrack({ type: "span", recordingId: "two", kind: "laser", index: 0 }),
    "laser",
  );
  for (const track of ["screen", "camera", "microphone", "systemAudio", "laser", "clicks", "keys"])
    assert.equal(isSelectedTrack(track), true);
  assert.equal(isSelectedTrack("unknown"), false);
  assert.equal(
    selectedTrackIndex({
      type: "recording",
      recordingId: "one",
      track: "microphone",
      trackIndex: 1,
    }),
    1,
  );
  assert.deepEqual(withTrack({ type: "piece", pieceId: "clip" }, "camera"), {
    type: "piece",
    pieceId: "clip",
    track: "camera",
  });
  assert.deepEqual(withTrack({ type: "piece", pieceId: "clip", track: "camera" }, undefined), {
    type: "piece",
    pieceId: "clip",
  });
  assert.deepEqual(
    withTrack({ type: "span", recordingId: "two", kind: "keys", index: 1 }, "microphone"),
    { type: "recording", recordingId: "two", track: "microphone" },
    "Leaving an effect for another track keeps its recording",
  );
  const cameraOnly = recording("camera-only", {
    mode: null,
    hasMicrophone: false,
    hasCamera: true,
  });
  assert.deepEqual(
    [
      hasTrack(cameraOnly, "screen"),
      hasTrack(cameraOnly, "camera"),
      hasTrack(cameraOnly, "microphone"),
    ],
    [false, true, false],
  );
  const effects = recording("effects", {
    annotationTracks: ["keys"],
    annotations: { ...noAnnotations(), laser: [{ start: 0, end: 1 }] },
    hasSystemAudio: true,
  });
  assert.deepEqual(
    [
      hasTrack(effects, "keys"),
      hasTrack(effects, "laser"),
      hasTrack(effects, "clicks"),
      hasTrack(effects, "systemAudio"),
    ],
    [true, true, false, true],
  );
});

test("audio levels preserve each source's volume while muted and default older recordings to full volume", () => {
  const settings = {
    "microphone:0": { volume: 0.45, muted: false },
    "microphone:1": { volume: 0.8, muted: true },
    "systemAudio:0": { volume: 0.3, muted: false },
  };
  assert.equal(audioLevel(settings, "microphone", 0), 0.45);
  assert.equal(audioLevel(settings, "microphone", 1), 0);
  assert.deepEqual(audioTrackSettings(settings, "microphone", 1), {
    volume: 0.8,
    muted: true,
    leveled: false,
    denoised: false,
  });
  assert.equal(audioLevel(settings, "systemAudio", 0), 0.3);
  assert.equal(audioLevel(undefined, "microphone", 0), 1);
  assert.equal(audioLevel({ "microphone:0": { volume: NaN, muted: false } }, "microphone"), 1);
  assert.equal(audioLevel({ "microphone:0": { volume: 3, muted: false } }, "microphone"), 1);
});

test("leveling applies only when on and measured, and a measurement outlives turning it off", () => {
  assert.equal(audioGain(undefined, "microphone", 0), 1);
  assert.equal(
    audioGain({ "microphone:0": { volume: 1, muted: false } }, "microphone"),
    1,
    "Older projects are not leveled",
  );
  const settings = {
    "microphone:0": { volume: 0.5, muted: false, leveled: true, levelGain: 3 },
    "microphone:1": { volume: 1, muted: false, leveled: true },
  };
  assert.equal(audioGain(settings, "microphone", 0), 3);
  assert.equal(audioLevel(settings, "microphone", 0), 0.5, "Volume stays separate from the gain");
  assert.equal(audioGain(settings, "microphone", 1), 1, "On without a measurement does nothing");
  const off = { "microphone:0": { ...settings["microphone:0"], leveled: false } };
  assert.equal(audioGain(off, "microphone"), 1);
  assert.equal(audioTrackSettings(off, "microphone").levelGain, 3);
  for (const levelGain of [0, -1, NaN, Infinity]) {
    assert.equal(
      audioGain(
        { "microphone:0": { volume: 1, muted: false, leveled: true, levelGain } },
        "microphone",
      ),
      1,
    );
  }
});

test("a cleaned track is leveled by the gain measured on its cleaned copy, and each gain outlives the other", () => {
  const track = { volume: 1, muted: false, leveled: true, levelGain: 3, denoisedLevelGain: 1.5 };
  assert.equal(
    audioGain({ "microphone:0": track }, "microphone"),
    3,
    "Noise reduction off: the original's gain",
  );
  assert.equal(
    audioGain({ "microphone:0": { ...track, denoised: true } }, "microphone"),
    1.5,
    "On: the cleaned copy's",
  );
  assert.equal(audioDenoised({ "microphone:0": { ...track, denoised: true } }, "microphone"), true);
  assert.equal(audioDenoised({ "microphone:0": track }, "microphone"), false);
  assert.equal(audioDenoised(undefined, "microphone"), false, "Older projects are not cleaned");
  // Leveling on a cleaned track whose copy hasn't been measured does nothing, rather than applying the original's gain.
  const unmeasured = {
    "microphone:0": { volume: 1, muted: false, leveled: true, levelGain: 3, denoised: true },
  };
  assert.equal(audioGain(unmeasured, "microphone"), 1);
  assert.equal(audioTrackSettings(unmeasured, "microphone").leveled, false);
  assert.equal(
    audioTrackSettings({ "microphone:0": { ...track, denoised: true } }, "microphone").levelGain,
    3,
    "The original's gain is kept",
  );
});

test("changing one setting of a track keeps what else is stored for it, including leveling not yet measured", () => {
  const before = {
    "microphone:0": {
      volume: 0.7,
      muted: false,
      leveled: true,
      denoised: true,
      levelGain: 2,
      denoisedLevelFor: "abc",
    },
    "systemAudio:0": { volume: 0.2, muted: true },
  };
  const after = withAudioSettings(before, "microphone", 0, { volume: 0.4 });
  assert.deepEqual(
    after["microphone:0"],
    {
      volume: 0.4,
      muted: false,
      leveled: true,
      denoised: true,
      levelGain: 2,
      denoisedLevelFor: "abc",
    },
    "leveling stays on though the cleaned copy has no gain yet",
  );
  assert.deepEqual(after["systemAudio:0"], before["systemAudio:0"], "other tracks are untouched");
  assert.equal(before["microphone:0"].volume, 0.7, "the original is not changed");
  assert.deepEqual(
    withAudioSettings(undefined, "microphone", 1, { denoised: true })["microphone:1"],
    { volume: 1, muted: false, denoised: true },
  );
  assert.equal(audioTrackSettings(before, "microphone").denoisedLevelFor, "abc");
});

test("bulk transcription preserves corrected and silent transcripts, skips unknown and busy jobs, and retries failures", () => {
  const states: Record<string, TranscriptionState> = {
    "/new": { directory: "/new", phase: "idle" },
    "/corrected": {
      directory: "/corrected",
      phase: "failed",
      transcript: {
        version: 1,
        model: "speech",
        cues: [{ id: "cue", trackId: "mic", start: 0, end: 1, text: "Corrected" }],
      },
    },
    "/silent": {
      directory: "/silent",
      phase: "done",
      transcript: { version: 1, model: "speech", cues: [] },
    },
    "/queued": { directory: "/queued", phase: "queued" },
    "/busy": { directory: "/busy", phase: "transcribing" },
    "/failed": { directory: "/failed", phase: "failed", error: "Try again" },
    "/no-microphone": { directory: "/no-microphone", phase: "idle" },
  };
  const recordings = ["new", "corrected", "silent", "queued", "busy", "failed", "loading"].map(
    (id) => recording(id),
  );
  recordings.push(
    recording("no-microphone", { hasMicrophone: false }),
    recording("missing", { directory: null }),
  );
  assert.deepEqual(
    untranscribedRecordings(recordings, states).map((take) => take.id),
    ["new", "failed"],
  );
});

test("bulk background processing preserves saved treatments and only queues eligible camera recordings", () => {
  const states: Record<string, BackgroundState> = {
    "/new": { directory: "/new", phase: "idle" },
    "/saved": {
      directory: "/saved",
      phase: "failed",
      result: {
        version: 1,
        model: "modnet",
        masks: {},
        settings: { enabled: false, replacement: "blur", blur: 20, color: "#000000" },
      },
    },
    "/queued": { directory: "/queued", phase: "queued" },
    "/busy": { directory: "/busy", phase: "processing" },
    "/failed": { directory: "/failed", phase: "failed" },
    "/audio": { directory: "/audio", phase: "idle" },
  };
  const recordings = ["new", "saved", "queued", "busy", "failed", "loading"].map((id) =>
    recording(id),
  );
  recordings.push(
    recording("audio", { hasCamera: false }),
    recording("missing", { directory: null }),
  );
  assert.deepEqual(
    unprocessedRecordings(recordings, states).map((take) => take.id),
    ["new", "failed"],
  );
});

test("clip camera layouts survive serialization and splitting", () => {
  const layout = { position: "top-left" as const, width: 0.3 };
  const piece = { id: "clip", recordingId: "one", start: 0, end: 10, cameraLayout: layout };
  assert.equal(isPiece(JSON.parse(JSON.stringify(piece))), true);
  assert.equal(isPiece({ ...piece, cameraLayout: { position: "unknown", width: 0.3 } }), false);
  assert.equal(isPiece({ ...piece, cameraLayout: { ...layout, width: NaN } }), false);
  assert.equal(isPiece({ ...piece, cameraLayout: { ...layout, width: 1 } }), false);
  const timeline = { duration: 10 } as Timeline;
  const { parts } = sequence([{ ...piece, timeline }]);
  assert.deepEqual(parts[0].cameraLayout, layout);
  const split = splitAt(parts, "clip", 4, "right")!;
  assert.deepEqual(
    split.map((part) => part.cameraLayout),
    [layout, layout],
  );
});

test("pieces placed anywhere become a sequence in the order they played", () => {
  const piece = (id: string, offset?: number) => ({
    id,
    recordingId: "one",
    start: 0,
    end: 1,
    ...(offset !== undefined && { offset }),
  });
  assert.deepEqual(sequencedPieces([piece("late", 9), piece("early", 0), piece("middle", 4)]), [
    { id: "early", recordingId: "one", start: 0, end: 1 },
    { id: "middle", recordingId: "one", start: 0, end: 1 },
    { id: "late", recordingId: "one", start: 0, end: 1 },
  ]);
  // Without a position for each, they already played in order.
  assert.deepEqual(
    sequencedPieces([piece("first"), piece("second", 0)]).map((p) => p.id),
    ["first", "second"],
  );
});
