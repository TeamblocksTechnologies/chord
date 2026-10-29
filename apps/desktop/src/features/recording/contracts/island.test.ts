import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_ANCHOR,
  ISLAND,
  anchorFor,
  islandBounds,
  nextIslandMode,
  showsCamera,
  surfaceIn,
  type IslandAnchor,
  type IslandInput,
} from "./island.ts";

const workArea = { x: 0, y: 25, width: 1440, height: 875 };
const compact = islandBounds("compact", DEFAULT_ANCHOR, false, workArea);
const open = islandBounds("open", DEFAULT_ANCHOR, false, workArea);
const input = (patch: Partial<IslandInput>): IslandInput => ({
  mode: "compact",
  cursor: { x: 0, y: 0 },
  bounds: compact,
  dropdownOpen: false,
  ...patch,
});
const right = (r: { x: number; width: number }) => r.x + r.width;
const bottom = (r: { y: number; height: number }) => r.y + r.height;

test("the island sits bottom right by default, and opens in place from the same corner", () => {
  assert.equal(right(compact), workArea.width - ISLAND.margin);
  assert.equal(bottom(compact), workArea.y + workArea.height - ISLAND.margin);
  for (const camera of [false, true]) {
    const opened = islandBounds("open", DEFAULT_ANCHOR, camera, workArea);
    assert.equal(right(opened), right(compact));
    assert.equal(bottom(opened), bottom(compact));
  }
  const withCamera = islandBounds("compact", DEFAULT_ANCHOR, true, workArea);
  assert.equal(
    withCamera.height,
    ISLAND.compactCamera.height + ISLAND.compactBar,
    "A camera sits above the timer",
  );
  assert.ok(withCamera.width < open.width, "The compact camera is small");
  const topLeft: IslandAnchor = { horizontal: "left", vertical: "top", x: 40, y: 30 };
  assert.deepEqual(
    [
      islandBounds("open", topLeft, true, workArea).x,
      islandBounds("open", topLeft, true, workArea).y,
    ],
    [40, 55],
  );
});

test("dragging pins the island to the nearest corner and keeps it on screen", () => {
  const dragged = {
    x: 100,
    y: 700,
    width: ISLAND.openWidth,
    height: ISLAND.bar + ISLAND.cells + ISLAND.tools,
  };
  const anchor = anchorFor(dragged, workArea);
  assert.deepEqual(anchor, {
    horizontal: "left",
    vertical: "bottom",
    x: 100,
    y: 900 - 700 - dragged.height,
  });
  assert.deepEqual(islandBounds("open", anchor, false, workArea), dragged);
  const compactThere = islandBounds("compact", anchor, false, workArea);
  assert.deepEqual([compactThere.x, bottom(compactThere)], [100, bottom(dragged)]);
  const far = islandBounds(
    "open",
    { horizontal: "right", vertical: "bottom", x: 5000, y: 5000 },
    true,
    workArea,
  );
  assert.deepEqual([far.x, far.y], [workArea.x, workArea.y]);
});

test("hovering the compact island opens it, and leaving the open island closes it, right away", () => {
  assert.equal(nextIslandMode(input({ cursor: { x: compact.x + 10, y: compact.y + 10 } })), "open");
  assert.equal(
    nextIslandMode(input({ cursor: { x: compact.x - 1, y: compact.y } })),
    null,
    "Nearby isn't hovering",
  );

  const away = { x: 300, y: 300 };
  assert.equal(
    nextIslandMode(input({ mode: "open", bounds: open, cursor: { x: open.x + 5, y: open.y + 5 } })),
    null,
  );
  assert.equal(
    nextIslandMode(
      input({ mode: "open", bounds: open, cursor: { x: open.x - ISLAND.slop, y: open.y } }),
    ),
    null,
    "Straying just past the edge keeps it open",
  );
  assert.equal(
    nextIslandMode(input({ mode: "open", bounds: open, cursor: away, dropdownOpen: true })),
    null,
    "A source dropdown keeps the island open",
  );
  assert.equal(nextIslandMode(input({ mode: "open", bounds: open, cursor: away })), "compact");
});

test("the drawn surface follows the window, wherever it has been moved", () => {
  // The window is always the open island's size; the compact surface sits in its pinned corner.
  const frame = { x: 720, y: 247, width: ISLAND.openWidth, height: 356 };
  assert.deepEqual(surfaceIn(frame, { horizontal: "right", vertical: "top" }, "compact", true), {
    x: 720 + ISLAND.openWidth - ISLAND.compactCamera.width,
    y: 247,
    ...{
      width: ISLAND.compactCamera.width,
      height: ISLAND.compactCamera.height + ISLAND.compactBar,
    },
  });
  assert.deepEqual(surfaceIn(open, DEFAULT_ANCHOR, "open", false), open);
  assert.deepEqual(surfaceIn(open, DEFAULT_ANCHOR, "compact", false), compact);
});

test("the compact island shows the camera only while previewing, but opening it always does", () => {
  assert.equal(showsCamera("compact", { camera: true, preview: true }), true);
  assert.equal(showsCamera("compact", { camera: true, preview: false }), false);
  assert.equal(showsCamera("open", { camera: true, preview: false }), true);
  assert.equal(showsCamera("open", { camera: false, preview: true }), false);
});
