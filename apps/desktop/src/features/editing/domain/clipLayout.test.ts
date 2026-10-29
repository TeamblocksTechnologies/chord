import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FEED_FRAMING,
  LAYOUT_PRESETS,
  defaultClipLayout,
  frameFeed,
  gridCells,
  isClipLayout,
  layoutCells,
  layoutSources,
  pictureCount,
  upgradeClipLayout,
  type ClipBackground,
} from "./clipLayout.ts";
import { isPiece } from "#project-document/domain/recording";
import {
  buildTimeline,
  followerAt,
  groupLayersOf,
  layersOf,
  sequence,
  splitAt,
  withCuts,
} from "#media-engine/renderer/timeline";
import { recordingTrackSections } from "#media-engine/renderer/recordingTracks";
import { upgradeProject } from "#project-document/renderer/projectUpgrade";
import type { Project } from "#project-document/domain/recording";
import type { LoadedSession } from "#media-engine/contracts/playback";

const sources = [
  { id: "screen-1", kind: "screen" },
  { id: "cam-1", kind: "camera" },
  { id: "cam-2", kind: "camera" },
] as const;

test("old camera placements seed layouts, and source selection can isolate any of three feeds", () => {
  assert.equal(defaultClipLayout(sources.slice(0, 1)).preset, "single");
  const old = defaultClipLayout(sources.slice(0, 2), { position: "top-left", width: 0.3 });
  assert.equal(old.preset, "pip");
  assert.equal(old.pip.position, "top-left");
  assert.equal(old.pip.width, 0.3);
  assert.equal(defaultClipLayout(sources, { position: "hidden", width: 0.22 }).preset, "single");
  const layout = {
    ...defaultClipLayout(sources),
    preset: "split" as const,
    sources: ["cam-2", "cam-1"],
  };
  assert.deepEqual(layoutSources(layout, sources), ["cam-2", "cam-1"]);
  assert.deepEqual(layoutSources({ ...layout, preset: "single" }, sources), ["cam-2"]);
  assert.deepEqual(layoutSources({ ...layout, sources: ["removed", "cam-1"] }, sources), [
    "cam-1",
    "screen-1",
  ]);
});

test("pinned windows stay out of a recording's layout until chosen", () => {
  const pinned = { id: "window-1-screen-1", kind: "screen" as const, window: {} };
  assert.deepEqual(defaultClipLayout([...sources, pinned]).sources, ["screen-1", "cam-1", "cam-2"]);
  assert.deepEqual(defaultClipLayout([sources[0], pinned, sources[1]]).sources, [
    "screen-1",
    "cam-1",
  ]);
});

test("every feed gets a cell, as many to a row as gives them the most room, each row centered", () => {
  const round = (cells: ReturnType<typeof gridCells>) =>
    cells.map(({ x, y, width, height }) => [x, y, width, height].map(Math.round));
  assert.deepEqual(gridCells(0, 1600, 900), []);
  assert.deepEqual(round(gridCells(1, 1600, 900)), [[18, 18, 1564, 864]]);
  // Three 16:9 feeds on a 16:9 stage: two over one, the one centered.
  assert.deepEqual(round(gridCells(3, 1600, 900)), [
    [18, 18, 773, 423],
    [809, 18, 773, 423],
    [414, 459, 773, 423],
  ]);
  assert.equal(
    gridCells(3, 2400, 600)[2]!.y,
    gridCells(3, 2400, 600)[0]!.y,
    "A wide stage puts them in one row",
  );
});

test("every preset fits landscape, portrait, and square outputs with proportional padding and gaps", () => {
  const variants = ["horizontal", "vertical"].flatMap((direction) =>
    ["start", "end"].flatMap((stack) =>
      [false, true].map((apart) => ({ direction, stack, apart })),
    ),
  );
  for (const preset of LAYOUT_PRESETS)
    for (const { direction, stack, apart } of variants)
      for (const [width, height] of [
        [1920, 1080],
        [1080, 1920],
        [720, 720],
      ]) {
        const base = defaultClipLayout(sources);
        const layout = {
          ...base,
          preset: preset.value,
          padding: 0.1,
          gap: 0.04,
          split: 0.35,
          secondarySplit: 0.7,
          direction: direction as "horizontal",
          stack: stack as "end",
          pip: { ...base.pip, width: 0.6, apart },
        };
        const cells = layoutCells(layout, width, height, preset.count);
        assert.equal(cells.length, preset.count, preset.value);
        for (const cell of cells) {
          assert.ok(cell.width > 0 && cell.height > 0);
          assert.ok(cell.x >= Math.min(width, height) * 0.1 - 1e-6);
          assert.ok(cell.y >= Math.min(width, height) * 0.1 - 1e-6);
          assert.ok(cell.x + cell.width <= width - Math.min(width, height) * 0.1 + 1e-6);
          assert.ok(cell.y + cell.height <= height - Math.min(width, height) * 0.1 + 1e-6);
        }
        if (preset.value === "double-pip") {
          const [, a, b] = cells;
          assert.ok(
            a.x + a.width <= b.x + 1e-6 ||
              b.x + b.width <= a.x + 1e-6 ||
              a.y + a.height <= b.y + 1e-6 ||
              b.y + b.height <= a.y + 1e-6,
            "pictures never overlap",
          );
        }
        assert.deepEqual(
          layoutCells(layout, width * 2, height * 2, preset.count),
          cells.map((cell) => ({
            x: cell.x * 2,
            y: cell.y * 2,
            width: cell.width * 2,
            height: cell.height * 2,
          })),
        );
      }
  const layout = {
    ...defaultClipLayout(sources),
    preset: "split-stack" as const,
    stack: "start" as const,
    gap: 0,
    split: 0.4,
    secondarySplit: 0.25,
  };
  assert.deepEqual(layoutCells(layout, 1000, 500, 3), [
    { x: 0, y: 0, width: 400, height: 125 },
    { x: 0, y: 125, width: 400, height: 375 },
    { x: 400, y: 0, width: 600, height: 500 },
  ]);
  assert.deepEqual(layoutCells({ ...layout, direction: "vertical", stack: "end" }, 1000, 500, 3), [
    { x: 0, y: 0, width: 1000, height: 200 },
    { x: 0, y: 200, width: 250, height: 300 },
    { x: 250, y: 200, width: 750, height: 300 },
  ]);
});

test("two pictures sit beside each other in one corner, or apart in the next corner along the direction", () => {
  const base = defaultClipLayout(sources);
  const layout = {
    ...base,
    preset: "double-pip" as const,
    pip: { width: 0.2, aspect: 2, inset: 0.1, position: "bottom-right" as const, apart: false },
  };
  assert.deepEqual(layoutCells(layout, 1000, 500, 3), [
    { x: 0, y: 0, width: 1000, height: 500 },
    { x: 750, y: 350, width: 200, height: 100 },
    { x: 500, y: 350, width: 200, height: 100 },
  ]);
  assert.deepEqual(layoutCells({ ...layout, direction: "vertical" }, 1000, 500, 3)[2], {
    x: 750,
    y: 200,
    width: 200,
    height: 100,
  });
  assert.deepEqual(
    layoutCells({ ...layout, pip: { ...layout.pip, apart: true } }, 1000, 500, 3)[2],
    { x: 50, y: 350, width: 200, height: 100 },
  );
  assert.deepEqual(
    layoutCells(
      { ...layout, direction: "vertical", pip: { ...layout.pip, apart: true } },
      1000,
      500,
      3,
    )[2],
    { x: 750, y: 50, width: 200, height: 100 },
  );
});

test("layouts saved with one preset per direction and side upgrade to modes with settings", () => {
  const { direction: _, stack: __, ...current } = defaultClipLayout(sources);
  const old = { ...current, pip: { width: 0.2, aspect: 1, inset: 0.04, position: "top-left" } };
  for (const [preset, expected] of [
    ["split-vertical", ["split", "vertical", "end"]],
    ["three-columns", ["three-split", "horizontal", "end"]],
    ["three-rows", ["three-split", "vertical", "end"]],
    ["stack-left", ["split-stack", "horizontal", "start"]],
    ["pip", ["pip", "horizontal", "end"]],
  ] as const) {
    const upgraded = upgradeClipLayout({ ...old, preset }) as ReturnType<typeof defaultClipLayout>;
    assert.ok(isClipLayout(upgraded), preset);
    assert.deepEqual([upgraded.preset, upgraded.direction, upgraded.stack], expected);
    assert.equal(upgraded.pip.apart, false);
  }
  const piece = {
    id: "clip",
    recordingId: "take",
    start: 0,
    end: null,
    layout: { ...old, preset: "stack-right" },
  };
  const stored = {
    id: "p",
    name: "P",
    notes: [],
    setup: {},
    recordings: [],
    pieces: [piece],
  } as unknown as Project;
  assert.equal(upgradeProject(stored).pieces![0].layout!.preset, "split-stack");
});

test("contain, cover, zoom, and focal points keep aspect ratio and produce the requested crop", () => {
  const cell = { x: 10, y: 20, width: 200, height: 200 };
  const contained = frameFeed(cell, 400, 200, DEFAULT_FEED_FRAMING);
  assert.deepEqual(contained.frame, { x: 10, y: 70, width: 200, height: 100 });
  assert.deepEqual(contained.image, contained.frame);
  const covered = frameFeed(cell, 400, 200, { ...DEFAULT_FEED_FRAMING, fit: "cover" });
  assert.deepEqual(
    [covered.frame, covered.image],
    [cell, { x: -90, y: 20, width: 400, height: 200 }],
  );
  assert.deepEqual(
    frameFeed(cell, 400, 200, { ...DEFAULT_FEED_FRAMING, fit: "cover", x: 1, scale: 2 }).image,
    { x: -590, y: -80, width: 800, height: 400 },
  );
  // A square crop in a wide cell is a centered square, so full corners make a circle.
  const square = frameFeed({ x: 0, y: 0, width: 400, height: 100 }, 400, 300, {
    ...DEFAULT_FEED_FRAMING,
    aspect: 1,
  });
  assert.deepEqual(square.frame, { x: 150, y: 0, width: 100, height: 100 });
  assert.deepEqual(Object.values(square.image).map(Math.round), [133, 0, 133, 100]);
  // Zoom crops within a contained frame instead of spilling into the rest of the cell.
  assert.deepEqual(
    frameFeed(cell, 400, 200, { ...DEFAULT_FEED_FRAMING, scale: 2 }).frame,
    contained.frame,
  );
});

test("persisted layouts validate numeric bounds and survive project upgrades without losing clips", () => {
  const layout = defaultClipLayout(sources);
  const piece = { id: "clip", recordingId: "take", start: 0, end: null, layout };
  assert.ok(isClipLayout(layout));
  assert.ok(
    isClipLayout({
      ...layout,
      feeds: { "cam-1": { ...DEFAULT_FEED_FRAMING, radius: [0, 0.25, 0.5, 1] } },
    }),
  );
  assert.ok(isPiece(piece));
  for (const patch of [
    { padding: NaN },
    { gap: -1 },
    { split: 1 },
    { sources: ["cam-1", "cam-1"] },
    { preset: "unknown" },
    { direction: "diagonal" },
    { stack: "middle" },
    { pip: { ...layout.pip, aspect: 0 } },
    { feeds: { "cam-1": { ...DEFAULT_FEED_FRAMING, scale: Infinity } } },
    { feeds: { "cam-1": { ...DEFAULT_FEED_FRAMING, radius: [0, 0.5, 1] } } },
    { feeds: { "cam-1": { ...DEFAULT_FEED_FRAMING, radius: [0, 0.5, 1, 2] } } },
  ]) {
    assert.equal(isClipLayout({ ...layout, ...patch }), false);
  }
  const stored = {
    id: "p",
    name: "P",
    notes: [],
    setup: {},
    recordings: [],
    pieces: [piece],
  } as unknown as Project;
  assert.deepEqual(upgradeProject(JSON.parse(JSON.stringify(stored))).pieces, [piece]);
});

test("clip backgrounds validate and survive saving, splitting, trimming and rearranging", () => {
  const timeline = { duration: 10 } as Parameters<typeof sequence>[0][number]["timeline"];
  for (const background of [
    { type: "solid", color: "#fAfAfA" },
    { type: "teamblocks" },
  ] satisfies ClipBackground[]) {
    const layout = { ...defaultClipLayout(sources), background };
    const piece = { id: "clip", recordingId: "take", start: 2, end: 8, layout };
    assert.ok(isPiece(piece));
    const stored = {
      id: "p",
      name: "P",
      notes: [],
      setup: {},
      recordings: [],
      pieces: [piece],
    } as unknown as Project;
    const saved = upgradeProject(JSON.parse(JSON.stringify(stored))).pieces!;
    assert.deepEqual(saved[0].layout?.background, background);
    const { parts } = sequence(saved.map((piece) => ({ ...piece, timeline })));
    const split = splitAt(parts, "clip", 3, "other")!;
    const moved = sequence(
      split
        .reverse()
        .map((part) => ({ ...part, id: part.pieceId, offset: undefined, start: part.start + 0.1 })),
    );
    assert.deepEqual(
      moved.parts.map((part) => part.layout?.background),
      [background, background],
    );
    moved.parts[0] = {
      ...moved.parts[0],
      layout: { ...layout, background: { type: "solid", color: "#123456" } },
    };
    assert.deepEqual(
      moved.parts[1].layout?.background,
      background,
      "editing one occurrence leaves the other alone",
    );
  }
  for (const background of [
    null,
    "teamblocks",
    {},
    { type: "unknown" },
    { type: "solid" },
    { type: "solid", color: "red" },
    { type: "solid", color: "#fff" },
    { type: "solid", color: "#00000000" },
    { type: "solid", color: 123 },
  ]) {
    assert.equal(
      isClipLayout({ ...defaultClipLayout(sources), background }),
      false,
      JSON.stringify(background),
    );
  }
});

test("all screen and camera tracks follow session time through cuts; split clips retain independent layouts", async () => {
  const session: LoadedSession = {
    directory: "/r",
    bounds: {},
    input: [],
    manifest: {
      version: 1,
      id: "take",
      createdAt: "",
      hostTimeOrigin: 0,
      config: {} as LoadedSession["manifest"]["config"],
      pauses: [],
      marks: [],
      tracks: sources.map((source, index) => ({
        id: source.id,
        kind: source.kind,
        source: source.id,
        ...(source.kind === "screen" && {
          display: { id: 1, frame: { x: 0, y: 0, width: 640, height: 360 }, scale: 1 },
        }),
        segments: [{ file: `${source.id}.mp4`, start: index * 0.1, end: 5 }],
      })),
    },
  };
  const timeline = (await buildTimeline(session, async () => 5))!;
  assert.deepEqual(
    timeline.video?.map((source) => source.id),
    sources.map((source) => source.id),
  );
  assert.deepEqual(
    timeline.video?.map((source) => source.index),
    [0, 0, 1],
  );
  const cut = withCuts(timeline, [{ start: 1, end: 2 }]);
  assert.equal(cut.video![0].clips, cut.clips);
  assert.equal(cut.video![2].clips, timeline.video![2].clips, "followers remain on session time");
  assert.equal(followerAt(cut.video![2].clips, 2.5)!.time, 2.3);
  const layout = defaultClipLayout(sources);
  const { parts } = sequence([{ id: "clip", recordingId: "take", timeline: cut, layout }]);
  assert.deepEqual(
    layersOf(parts[0])
      .filter((layer) => layer.kind === "camera")
      .map((layer) => layer.index),
    [0, 1],
  );
  const rows = recordingTrackSections(groupLayersOf(parts), [
    { id: "camera:0", kind: "camera" },
    { id: "screen:0", kind: "screen" },
  ]).flatMap((section) => section.rows);
  assert.equal(
    new Set(rows.map((row) => row.id)).size,
    rows.length,
    "Additional cameras have distinct recording-editor row identities",
  );
  const split = splitAt(parts, "clip", 2, "other")!;
  assert.deepEqual(
    split.map((part) => part.layout),
    [layout, layout],
  );
  split[0] = { ...split[0], layout: { ...layout, sources: ["cam-2"], preset: "single" } };
  assert.deepEqual(split[1].layout, layout, "editing one occurrence keeps the other unchanged");
  // A second screen is also retained, rather than silently dropped by the primary-screen path.
  session.manifest.tracks.push({ ...session.manifest.tracks[0], id: "screen-2" });
  assert.equal((await buildTimeline(session, async () => 5))!.video!.length, 4);
});

test("pictures are the last cells a layout draws over the others", () => {
  assert.equal(pictureCount("pip", 2), 1);
  assert.equal(pictureCount("pip", 1), 0, "a lone feed fills the stage");
  assert.equal(pictureCount("double-pip", 3), 2);
  assert.equal(pictureCount("double-pip", 2), 1);
  assert.equal(pictureCount("split-pip", 3), 1);
  assert.equal(pictureCount("split-pip", 2), 0, "two feeds only make the split");
  assert.equal(pictureCount("split-stack", 3), 0);
});
