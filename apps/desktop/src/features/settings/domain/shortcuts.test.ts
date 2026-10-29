import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPreferences, patchPreferences } from "./preferences.ts";
import {
  SHORTCUTS,
  assignShortcut,
  bindingFromEvent,
  bindingLabel,
  bindingProblem,
  isShortcutOverrides,
  matchesBinding,
  resolveShortcuts,
  toAccelerator,
} from "./shortcuts.ts";

const press = (
  code: string,
  modifiers: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {},
) => ({ code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers });

test("defaults don't clash and every one is a valid binding", () => {
  const seen = new Map<string, string>();
  for (const shortcut of SHORTCUTS) {
    assert.equal(bindingProblem(shortcut.id, shortcut.binding, true), null, shortcut.id);
    const key = `${shortcut.scope}:${shortcut.binding}`;
    assert.equal(seen.has(key), false, `${shortcut.id} clashes with ${seen.get(key)}`);
    seen.set(key, shortcut.id);
  }
  assert.equal(resolveShortcuts({}).toolbar, "Mod+Shift+KeyR");
  assert.equal(resolveShortcuts({ toolbar: null }).toolbar, null);
});

test("key presses become bindings, with command on macOS and control elsewhere", () => {
  assert.equal(
    bindingFromEvent(press("KeyR", { metaKey: true, shiftKey: true }), true),
    "Mod+Shift+KeyR",
  );
  assert.equal(
    bindingFromEvent(press("KeyR", { ctrlKey: true, shiftKey: true }), false),
    "Mod+Shift+KeyR",
  );
  assert.equal(
    bindingFromEvent(press("KeyK", { ctrlKey: true, metaKey: true }), true),
    "Mod+Ctrl+KeyK",
  );
  assert.equal(bindingFromEvent(press("ShiftLeft", { shiftKey: true }), true), null);
  assert.equal(bindingFromEvent(press("KeyK", { metaKey: true }), false), null);
  assert.equal(matchesBinding(press("KeyK", { metaKey: true }), "Mod+KeyK", true), true);
  assert.equal(
    matchesBinding(press("KeyK", { metaKey: true, shiftKey: true }), "Mod+KeyK", true),
    false,
  );
  assert.equal(matchesBinding(press("KeyK", { ctrlKey: true }), "Mod+KeyK", false), true);
  assert.equal(matchesBinding(press("KeyK", { ctrlKey: true }), "Ctrl+KeyK", false), true);
  assert.equal(matchesBinding(press("Space"), null, true), false);
});

test("bindings are labelled per platform and become accelerators", () => {
  assert.equal(bindingLabel("Mod+Shift+KeyR", true), "⇧⌘R");
  assert.equal(bindingLabel("Mod+Shift+KeyR", false), "Ctrl+Shift+R");
  assert.equal(bindingLabel("Ctrl+Alt+ArrowLeft", true), "⌃⌥←");
  assert.equal(toAccelerator("Mod+Shift+KeyR"), "CommandOrControl+Shift+R");
  assert.equal(toAccelerator("Ctrl+Alt+F5"), "Control+Alt+F5");
});

test("reserved keys and global shortcuts without a modifier are refused", () => {
  assert.equal(bindingProblem("split", "Mod+KeyC", true), "reserved");
  assert.equal(bindingProblem("playPause", "Escape", true), "reserved");
  assert.equal(bindingProblem("toolbar", "KeyR", true), "needsModifier");
  assert.equal(bindingProblem("toolbar", "Shift+KeyR", true), "needsModifier");
  assert.equal(bindingProblem("toolbar", "F5", true), null);
  assert.equal(bindingProblem("snapping", "KeyN", true), null);
  // Recording shortcuts work in every app while recording, so they need a modifier too.
  assert.equal(bindingProblem("pauseRecording", "Space", true), "needsModifier");
  assert.equal(bindingProblem("addMark", "Alt+KeyM", true), null);
  // The app menu's shortcuts.
  assert.equal(bindingProblem("copyFrame", "Mod+Ctrl+KeyF", true), "reserved");
  assert.equal(bindingProblem("copyFrame", "Mod+Alt+KeyH", true), "reserved");
});

test("assigning a shortcut turns off the ones it clashes with, and defaults aren't stored", () => {
  const taken = assignShortcut({}, "snapping", "Alt+Shift+KeyM", true);
  // Add mark only works while recording, so it can keep its keys.
  assert.deepEqual(taken, { overrides: { snapping: "Alt+Shift+KeyM" }, cleared: [] });
  const clash = assignShortcut({}, "split", "KeyS", true);
  assert.deepEqual(clash, { overrides: { split: "KeyS", snapping: null }, cleared: ["snapping"] });
  // A global shortcut clashes everywhere.
  assert.deepEqual(assignShortcut({}, "toolbar", "Mod+KeyK", true).cleared, ["split"]);
  assert.deepEqual(assignShortcut({ split: "Mod+KeyJ" }, "split", "Mod+KeyK", true).overrides, {});
  assert.deepEqual(assignShortcut({}, "split", null, true).overrides, { split: null });
});

test("preferences keep valid shortcut overrides and ignore ones from newer versions", () => {
  assert.equal(isShortcutOverrides({ split: "Mod+KeyJ", toolbar: null }), true);
  assert.equal(isShortcutOverrides({ split: "Mod+Banana" }), false);
  assert.equal(isShortcutOverrides({ split: "Shift+Mod+KeyJ" }), false);
  assert.deepEqual(
    patchPreferences(defaultPreferences(), { shortcuts: { split: "Mod+KeyJ", later: "KeyL" } })
      ?.shortcuts,
    { split: "Mod+KeyJ" },
  );
  assert.equal(patchPreferences(defaultPreferences(), { shortcuts: { split: 3 } }), null);
});
