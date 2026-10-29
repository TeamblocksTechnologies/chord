import assert from "node:assert/strict";
import { test } from "node:test";
import type { Manifest, ManifestTrack } from "@teamblocks.dev/chord-recorder-protocol";
import { noAnnotations } from "./annotations.ts";
import {
  cutEdgeBounds,
  moveCutEdge,
  cutsOutside,
  editedAnnotations,
  editedPiece,
  isCut,
  keptRanges,
  normalizeCuts,
  recordedPiece,
  rippleCuts,
  toEdited,
  toRecorded,
} from "./cuts.ts";
import type { Piece } from "#project-document/domain/recording";
import {
  buildTimeline,
  fileTime,
  layersOf,
  sequence,
  withCuts,
} from "#media-engine/renderer/timeline";

const display = { id: 1, frame: { x: 0, y: 0, width: 1728, height: 1117 }, scale: 2 };

function session(tracks: ManifestTrack[]) {
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
  return {
    directory: "/r/s",
    manifest,
    bounds: {},
    input: [
      { type: "move" as const, time: 1, x: 1, y: 1 },
      { type: "move" as const, time: 3, x: 2, y: 2 },
      { type: "down" as const, time: 3.2, button: "left" as const, x: 2, y: 2 },
      { type: "up" as const, time: 3.4, button: "left" as const, x: 2, y: 2 },
      { type: "move" as const, time: 7, x: 3, y: 3 },
    ],
  };
}

const noProbe = async () => assert.fail("nothing to probe");

test("cuts are kept in order and apart, and what they keep is the rest", () => {
  assert.deepEqual(
    normalizeCuts([
      { start: 5, end: 6 },
      { start: -1, end: 1 },
      { start: 0.5, end: 2 },
      { start: 3, end: 3 },
    ]),
    [
      { start: 0, end: 2 },
      { start: 5, end: 6 },
    ],
  );
  assert.equal(isCut({ start: 1, end: 1 }), false);
  assert.equal(isCut({ start: 1, end: 2 }), true);
  const cuts = [
    { start: 1, end: 2 },
    { start: 4, end: 5 },
  ];
  const kept = keptRanges(cuts, 8);
  assert.deepEqual(kept, [
    { start: 0, end: 1, offset: 0 },
    { start: 2, end: 4, offset: 1 },
    { start: 5, end: 8, offset: 3 },
  ]);
  assert.deepEqual(
    cutsOutside(kept, 8),
    cuts,
    "Cutting everything a recording doesn't keep gives back its cuts",
  );
  assert.deepEqual(
    cutsOutside([{ start: 2, end: 6 }], 8),
    [
      { start: 0, end: 2 },
      { start: 6, end: 8 },
    ],
    "including at its ends",
  );
  assert.deepEqual(
    keptRanges([{ start: 0, end: 8 }], 8),
    [],
    "A recording can be cut away entirely",
  );
});

test("times map either way across cuts, keeping a piece's ends off what's cut", () => {
  const cuts = [
    { start: 1, end: 2 },
    { start: 4, end: 5 },
  ];
  assert.equal(toEdited(cuts, 0.5), 0.5);
  assert.equal(toEdited(cuts, 1.5), 1, "Inside a cut is where it closes");
  assert.equal(toEdited(cuts, 6), 4);
  assert.equal(toRecorded(cuts, 4, "start"), 6);
  assert.equal(toRecorded(cuts, 1, "start"), 2, "Where a cut closes, a start is after it");
  assert.equal(toRecorded(cuts, 1, "end"), 1, "and an end before it");
  assert.equal(toRecorded(cuts, 3, "end"), 4);
  const piece: Piece = { id: "p", recordingId: "r", start: 0.5, end: 6, offset: 2 };
  const edited = editedPiece(piece, cuts);
  assert.deepEqual(edited, { ...piece, start: 0.5, end: 4 });
  assert.deepEqual(recordedPiece(edited, cuts, 6), piece, "and back");
  assert.deepEqual(
    recordedPiece({ ...piece, start: 0, end: 6 }, cuts, 6),
    { ...piece, start: 0, end: null },
    "A piece to the end of what's kept plays to the end",
  );
});

test("cutting a recording shortens its pieces in the edit and moves what's after them back", () => {
  const recordings = {
    r: { duration: 10, cuts: [{ start: 2, end: 3 }] },
    s: { duration: 4, cuts: [] },
  };
  const pieces: Piece[] = [
    { id: "a", recordingId: "r", start: 0, end: 5, offset: 0 },
    { id: "b", recordingId: "s", start: 0, end: null, offset: 5 },
    { id: "c", recordingId: "r", start: 5, end: null, offset: 9 },
    { id: "over", recordingId: "s", start: 0, end: 1, offset: 1 },
  ];
  const after = rippleCuts(
    pieces,
    "r",
    [],
    recordings.r.cuts,
    (id) => recordings[id as keyof typeof recordings],
  );
  assert.deepEqual(
    after.map((piece) => [piece.id, piece.offset]),
    [
      ["a", 0],
      ["b", 4],
      ["c", 8],
      ["over", 1],
    ],
    "Pieces after the shortened one move back by what's cut; one over it stays",
  );
  const restored = rippleCuts(after, "r", recordings.r.cuts, [], (id) => ({
    ...recordings[id as keyof typeof recordings],
    cuts: [],
  }));
  assert.deepEqual(restored, pieces, "Putting the cut back moves them out again");
  const unplaced: Piece[] = [
    { id: "a", recordingId: "r", start: 0, end: null },
    { id: "b", recordingId: "s", start: 0, end: null },
  ];
  assert.deepEqual(
    rippleCuts(
      unplaced,
      "r",
      [],
      recordings.r.cuts,
      (id) => recordings[id as keyof typeof recordings],
    ),
    unplaced,
    "Pieces played one after another already follow",
  );
});

test("effects play where they were once cuts close up, joined across a cut", () => {
  const annotations = {
    ...noAnnotations(),
    laser: [{ start: 0.5, end: 3 }],
    clicks: [{ start: 1.2, end: 1.8 }],
  };
  const edited = editedAnnotations(annotations, [{ start: 1, end: 2 }]);
  assert.deepEqual(edited.laser, [{ start: 0.5, end: 2 }]);
  assert.deepEqual(edited.clicks, [], "A span inside a cut is gone");
  assert.equal(editedAnnotations(annotations, []), annotations);
});

test("a timeline with cuts closes them up like pauses, starting clips partway into their files", async () => {
  const timeline = (await buildTimeline(
    session([
      {
        id: "mic-1",
        kind: "microphone",
        source: "m",
        segments: [{ file: "mic.m4a", start: 0, end: 10 }],
      },
      {
        id: "screen-1",
        kind: "screen",
        source: "display:1",
        display,
        segments: [
          {
            file: "one.mov",
            start: 0,
            end: 4,
            endReason: "paused",
            screenMode: { type: "display" },
          },
          { file: "two.mov", start: 6, end: 10, screenMode: { type: "display" } },
        ],
      },
    ]),
    noProbe,
  ))!;
  // Recorded 0–4 is one.mov and 4–8 two.mov. Cut 1–2 inside one.mov, and 3.5–5 across the pause.
  const cut = withCuts(timeline, [
    { start: 1, end: 2 },
    { start: 3.5, end: 5 },
  ]);
  assert.deepEqual(
    cut.clips.map(({ file, start, duration, offset, fileStart, endsEarly }) => ({
      file,
      start,
      duration,
      offset,
      fileStart,
      endsEarly,
    })),
    [
      { file: "one.mov", start: 0, duration: 1, offset: 0, fileStart: 0, endsEarly: true },
      { file: "one.mov", start: 2, duration: 1.5, offset: 1, fileStart: 2, endsEarly: true },
      { file: "two.mov", start: 7, duration: 3, offset: 2.5, fileStart: 1, endsEarly: undefined },
    ],
  );
  assert.equal(cut.duration, 5.5);
  assert.equal(
    fileTime(cut.clips[1]!, 1.5),
    2.5,
    "Half a second into the second stretch is 2.5s into its file",
  );
  assert.equal(withCuts(timeline, []), timeline);
  // The cursor moved at 1s, 3s and, after the pause, 5s of recorded time.
  assert.deepEqual(
    cut.input!.cursor.map(({ time, x, cut: c }) => [time, x, !!c]),
    [
      [1, 1, true],
      [2, 2, false],
      [2.5, 3, true],
    ],
    "Each stretch cuts in to where the cursor was",
  );
  assert.deepEqual(
    cut.input!.clicks.map(({ time, end }) => [+time.toFixed(6), +end.toFixed(6)]),
    [[2.2, 2.4]],
    "A press in a stretch moves with it",
  );
  // Following tracks keep session time; their layers are cut where the leading clips are.
  const { parts } = sequence([{ recordingId: "r", timeline: cut }]);
  const mic = layersOf(parts[0]!).find((layer) => layer.kind === "microphone")!;
  assert.deepEqual(
    mic.blocks.map(({ sourceStart, start, end }) => [sourceStart, start, end]),
    [
      [0, 0, 1],
      [2, 1, 2.5],
      [7, 2.5, 5.5],
    ],
  );
  const screen = layersOf(parts[0]!).find((layer) => layer.kind === "screen")!;
  assert.deepEqual(
    screen.blocks.map(({ sourceStart }) => sourceStart),
    [0, 2, 1],
    "The screen's blocks start where their clips do in the file",
  );
});

test("cut edges stop at neighbours, allow collapsing a draft, and never change the original cuts", () => {
  const cuts = Object.freeze([
    Object.freeze({ start: 1, end: 2 }),
    Object.freeze({ start: 4, end: 5 }),
  ]);
  assert.deepEqual(cutEdgeBounds(cuts, 0, "start", 8), { min: 0, max: 2 });
  assert.deepEqual(cutEdgeBounds(cuts, 1, "start", 8), { min: 2, max: 5 });
  assert.deepEqual(cutEdgeBounds(cuts, 0, "end", 8), { min: 1, max: 4 });
  assert.deepEqual(cutEdgeBounds(cuts, 1, "end", 8), { min: 4, max: 8 });
  assert.deepEqual(moveCutEdge(cuts, 1, "start", -10, 8), [
    { start: 1, end: 2 },
    { start: 2, end: 5 },
  ]);
  assert.deepEqual(moveCutEdge(cuts, 0, "end", 99, 8), [
    { start: 1, end: 4 },
    { start: 4, end: 5 },
  ]);
  assert.deepEqual(moveCutEdge(cuts, 1, "end", 99, 8), [
    { start: 1, end: 2 },
    { start: 4, end: 8 },
  ]);
  const collapsed = moveCutEdge(cuts, 0, "start", 99, 8);
  assert.deepEqual(
    collapsed[0],
    { start: 2, end: 2 },
    "The draft can collapse without losing its edge indexes",
  );
  assert.deepEqual(
    normalizeCuts(collapsed),
    [{ start: 4, end: 5 }],
    "Saving removes a collapsed cut",
  );
  assert.deepEqual(cuts, [
    { start: 1, end: 2 },
    { start: 4, end: 5 },
  ]);
});
