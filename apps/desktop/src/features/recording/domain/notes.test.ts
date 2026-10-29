import assert from "node:assert/strict";
import { test } from "node:test";
import { NOTES_WINDOW, addPageChange, resizedBounds, upgradeNotes } from "./notes.ts";

test("page changes at the same moment keep only where it landed", () => {
  let changes = [{ at: 0, page: 0 }];
  changes = addPageChange(changes, 0, 1);
  assert.deepEqual(changes, [{ at: 0, page: 1 }]);
  changes = addPageChange(changes, 12, 2);
  changes = addPageChange(changes, 12, 1);
  assert.deepEqual(changes, [{ at: 0, page: 1 }]);
  changes = addPageChange(changes, 20, 0);
  assert.deepEqual(changes, [
    { at: 0, page: 1 },
    { at: 20, page: 0 },
  ]);
});

test("notes saved as text become one page", () => {
  const [page, ...rest] = upgradeNotes("Say hello\nShow the thing");
  assert.equal(page.title, "");
  assert.equal(page.body, "Say hello\nShow the thing");
  assert.equal(rest.length, 0);
  assert.deepEqual(upgradeNotes(""), []);
  assert.deepEqual(upgradeNotes(undefined), []);
});

test("resizing keeps the opposite edges put and stops at the smallest size", () => {
  const origin = { x: 100, y: 50, width: 640, height: 232 };
  assert.deepEqual(resizedBounds(origin, "se", 40, 20), { x: 100, y: 50, width: 680, height: 252 });
  assert.deepEqual(resizedBounds(origin, "nw", 40, 20), { x: 140, y: 70, width: 600, height: 212 });
  const smallest = resizedBounds(origin, "w", 1000, 0);
  assert.equal(smallest.width, NOTES_WINDOW.minWidth);
  assert.equal(smallest.x + smallest.width, origin.x + origin.width);
  assert.deepEqual(resizedBounds(origin, "n", 0, -30), { x: 100, y: 20, width: 640, height: 262 });
});
