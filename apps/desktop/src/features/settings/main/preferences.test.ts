import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PreferenceStore } from "./preferences.ts";
import {
  defaultPreferences,
  isPreferences,
  patchPreferences,
  preferencesFrom,
  withoutPreferences,
} from "../domain/preferences.ts";
import { initialSetup, isRecordingSetup } from "#project-document/domain/recording";

test("preferences default on, with a 3 second countdown and no transcription, and are validated", () => {
  const preferences = defaultPreferences();
  assert.deepEqual(preferences, {
    showsCursor: true,
    cameraMirrored: true,
    islandPreview: true,
    countdown: 3,
    hiddenApps: [],
    transcriptionModel: null,
    appleSpeechLocale: null,
    autoTranscribe: false,
    backgroundModel: null,
    autoRemoveBackground: false,
    backgroundReplacement: "blur",
    backgroundBlur: 40,
    backgroundColor: "#00b140",
    noiseEngine: null,
    shortcuts: {},
  });
  assert.equal(isPreferences({ ...preferences, showsCursor: "yes" }), false);
  assert.equal(isPreferences({ ...preferences, countdown: 4 }), false);
  assert.equal(isPreferences({ ...preferences, cameraMirrored: "yes" }), false);
  assert.equal(isPreferences({ ...preferences, hiddenApps: [1] }), false);
  assert.equal(isPreferences({ ...preferences, transcriptionModel: "parakeet-tdt-0.6b-v3" }), true);
  assert.equal(isPreferences({ ...preferences, transcriptionModel: "whisper" }), false);
  assert.equal(isPreferences({ ...preferences, autoTranscribe: 1 }), false);
  assert.equal(isPreferences({ ...preferences, appleSpeechLocale: "fr-CA" }), true);
  assert.equal(isPreferences({ ...preferences, appleSpeechLocale: "fr CA" }), false);
  assert.equal(isPreferences({ ...preferences, backgroundModel: "modnet" }), true);
  assert.equal(isPreferences({ ...preferences, backgroundModel: "u2net" }), false);
  assert.equal(isPreferences({ ...preferences, autoRemoveBackground: "yes" }), false);
  assert.equal(isPreferences({ ...preferences, backgroundReplacement: "image" }), false);
  assert.equal(isPreferences({ ...preferences, backgroundBlur: 101 }), false);
  assert.equal(isPreferences({ ...preferences, backgroundBlur: 2.5 }), false);
  assert.equal(isPreferences({ ...preferences, backgroundColor: "green" }), false);
  assert.equal(isPreferences({ ...preferences, noiseEngine: "apple" }), true);
  assert.equal(isPreferences({ ...preferences, noiseEngine: "deepfilternet3" }), true);
  assert.equal(isPreferences({ ...preferences, noiseEngine: "rnnoise" }), false);
});

test("preferences saved before newer ones were added keep their choices, and take defaults for the rest", () => {
  const root = mkdtempSync(join(tmpdir(), "chord-preferences-"));
  try {
    const path = join(root, "preferences.json");
    writeFileSync(
      path,
      JSON.stringify({
        cameraMirrored: false,
        islandPreview: true,
        countdown: 0,
        hiddenApps: ["com.a"],
      }),
    );
    const store = new PreferenceStore(path, () => assert.fail("seeded over saved preferences"));
    assert.deepEqual(store.value, {
      ...defaultPreferences(),
      cameraMirrored: false,
      countdown: 0,
      hiddenApps: ["com.a"],
    });
    store.update({ transcriptionModel: "apple-speech", autoTranscribe: true });
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), store.value);

    writeFileSync(path, JSON.stringify({ ...defaultPreferences(), countdown: 9 }));
    assert.deepEqual(
      new PreferenceStore(path, () => ({ ...defaultPreferences(), countdown: 5 })).value.countdown,
      5,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a patch changes only known fields, and an invalid one is refused", () => {
  const base = defaultPreferences();
  assert.deepEqual(patchPreferences(base, { countdown: 0, other: true }), {
    ...base,
    countdown: 0,
  });
  assert.equal(patchPreferences(base, { countdown: 10 }), null);
  assert.equal(patchPreferences(base, null), null);
});

test("background removal opacity persists in preferences, including fully transparent colors", (context) => {
  const root = mkdtempSync(join(tmpdir(), "chord-background-opacity-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "preferences.json");
  const store = new PreferenceStore(path, defaultPreferences);
  for (const backgroundColor of ["#123abc80", "#123abc00", "#123abc"]) {
    store.update({ backgroundColor });
    assert.equal(store.value.backgroundColor, backgroundColor);
    assert.equal(
      new PreferenceStore(path, defaultPreferences).value.backgroundColor,
      backgroundColor,
    );
  }
  assert.equal(patchPreferences(store.value, { backgroundColor: "#123abc8" }), null);
});

test("first-launch preferences keep the quick-start choices, but not its hidden apps", () => {
  const defaults = {
    ...initialSetup(),
    showsCursor: false,
    cameraMirrored: false,
    islandPreview: false,
    countdown: 0,
    hiddenApps: ["com.a"],
  };
  assert.deepEqual(preferencesFrom(defaults), {
    ...defaultPreferences(),
    showsCursor: false,
    cameraMirrored: false,
    islandPreview: false,
    countdown: 0,
  });
  assert.deepEqual(preferencesFrom(undefined), defaultPreferences());
});

test("setups saved with the preferences in them lose them, keeping their own hidden apps", () => {
  const stored = {
    ...initialSetup(),
    showsCursor: false,
    cameraMirrored: false,
    islandPreview: true,
    countdown: 5,
    hiddenApps: ["com.a"],
  };
  const setup = withoutPreferences(stored);
  assert.deepEqual(setup, { ...initialSetup(), hiddenApps: ["com.a"] });
  assert.equal(isRecordingSetup(setup), true);
});
