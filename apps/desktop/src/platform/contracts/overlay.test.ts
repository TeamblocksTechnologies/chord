import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DROPDOWN,
  MENUBAR,
  contains,
  dropdownSide,
  menubarFrame,
  overlayFrame,
} from "./overlay.ts";

const workArea = { x: 0, y: 25, width: 1440, height: 875 };

test("dropdowns open toward the larger part of the screen", () => {
  assert.equal(dropdownSide({ x: 300, y: 800, width: 832, height: 56 }, workArea), "above");
  assert.equal(dropdownSide({ x: 300, y: 40, width: 832, height: 56 }, workArea), "below");
});

test("the window keeps room for a dropdown beside the surface, within the work area", () => {
  const bar = { x: 300, y: 820, width: 832, height: 56 };
  assert.deepEqual(overlayFrame(bar, "above", "left", workArea), {
    x: 300,
    y: 820 - DROPDOWN.room,
    width: 832,
    height: 56 + DROPDOWN.room,
  });
  const top = { x: 300, y: 25, width: 832, height: 56 };
  assert.deepEqual(overlayFrame(top, "below", "left", workArea), {
    x: 300,
    y: 25,
    width: 832,
    height: 56 + DROPDOWN.room,
  });
  // Near the edge it takes what room there is.
  const near = { x: 300, y: 200, width: 832, height: 56 };
  assert.equal(overlayFrame(near, "above", "left", workArea).y, workArea.y + DROPDOWN.edge);
});

test("a narrow surface's window widens for the widest dropdown, away from its pinned edge", () => {
  const island = { x: 1000, y: 700, width: 392, height: 180 };
  const right = overlayFrame(island, "above", "right", workArea);
  assert.equal(right.width, DROPDOWN.width);
  assert.equal(right.x + right.width, island.x + island.width, "Pinned right, it grows left");
  assert.equal(
    right.y + right.height,
    island.y + island.height,
    "Pinned to the bottom, its room is above",
  );
  assert.equal(overlayFrame(island, "below", "left", workArea).x, island.x);
});

test("points on an edge belong to one side only", () => {
  const rect = { x: 10, y: 10, width: 20, height: 20 };
  assert.ok(contains(rect, { x: 10, y: 10 }));
  assert.ok(!contains(rect, { x: 30, y: 15 }));
});

test("the menu bar panel sits under its icon, with dropdown room on the roomier side", () => {
  const icon = { x: 1200, y: 0, width: 24, height: 24 };
  const { panel, frame, side } = menubarFrame(icon, workArea);
  assert.equal(panel.x + panel.width / 2, icon.x + icon.width / 2);
  assert.equal(panel.y, workArea.y + MENUBAR.gap);
  assert.equal(side, "left");
  assert.equal(frame.x + frame.width, panel.x + panel.width, "The room is left of the panel");
  assert.ok(panel.x - frame.x >= DROPDOWN.width + MENUBAR.dropdownGap);
  assert.equal(frame.height, panel.height);
  const left = menubarFrame({ x: 100, y: 0, width: 24, height: 24 }, workArea);
  assert.equal(left.side, "right");
  assert.equal(left.frame.x, left.panel.x);
});

test("the menu bar panel stays on screen near an edge and on a short screen", () => {
  const short = { x: 0, y: 25, width: 1280, height: 500 };
  const { panel } = menubarFrame({ x: 1270, y: 0, width: 24, height: 24 }, short);
  assert.equal(panel.x + panel.width, short.width - DROPDOWN.edge);
  assert.ok(panel.y + panel.height <= short.y + short.height - DROPDOWN.edge);
});
