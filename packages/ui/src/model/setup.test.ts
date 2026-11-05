import assert from "node:assert/strict";
import { test } from "node:test";
import { initialSetup, recordsAnything, usableSetup } from "./setup.ts";

test("a usable setup switches off what isn't allowed, keeping its settings for later", () => {
  const setup = {
    ...initialSetup(),
    cameraEnabled: true,
    cameraIds: ["camera"],
    systemAudio: true,
  };
  const cameraOnly = usableSetup(setup, (need) => need === "camera");
  assert.equal(cameraOnly.recordsScreen, false);
  assert.equal(cameraOnly.systemAudio, false);
  assert.equal(cameraOnly.cameraEnabled, true);
  assert.equal(cameraOnly.mode, setup.mode);
  assert.ok(recordsAnything(cameraOnly));

  assert.equal(recordsAnything(usableSetup(setup, () => false)), false);
  assert.deepEqual(
    usableSetup(setup, () => true),
    setup,
  );
});
