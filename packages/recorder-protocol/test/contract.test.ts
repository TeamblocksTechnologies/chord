/**
 * Runs a built helper against the contract. Point RECORDER_HELPER at any platform's binary; on macOS it
 * defaults to the release build from `native/macos/scripts/build.sh`.
 *
 * Set RECORDER_CONTRACT_CAPTURE=1 to also record a short microphone session (needs microphone permission).
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  ErrorReasonCode,
  MANIFEST_FILE,
  type Manifest,
  PROTOCOL_VERSION,
  type RpcFailure,
  RpcErrorCode,
  type RpcSuccess,
  type ScreenMode,
} from "../src/index.ts";
import { HelperClient } from "./helper-client.ts";

const binary =
  process.env.RECORDER_HELPER ??
  resolve(import.meta.dirname, "../../../native/macos/.build/release/recorder-helper");
const skip = existsSync(binary) ? false : `helper not built: ${binary}`;
if (process.env.RECORDER_CONTRACT_REQUIRED === "1") {
  assert.ok(existsSync(binary), `required recorder helper not built: ${binary}`);
}
const capture = process.env.RECORDER_CONTRACT_CAPTURE === "1";

function success<R>(reply: RpcSuccess<R> | RpcFailure): R {
  assert.ok("result" in reply, `expected success, got ${JSON.stringify(reply)}`);
  return reply.result;
}

function failure(reply: RpcSuccess | RpcFailure): RpcFailure["error"] {
  assert.ok("error" in reply, `expected error, got ${JSON.stringify(reply)}`);
  return reply.error;
}

const permissionStatuses = ["granted", "denied", "notDetermined", "restricted"];

describe("recorder helper contract", { skip }, () => {
  let helper: HelperClient;
  let output: string;

  beforeEach(() => {
    helper = new HelperClient(binary);
    output = mkdtempSync(join(tmpdir(), "chord-contract-"));
  });

  afterEach(async () => {
    await helper.close();
    rmSync(output, { recursive: true, force: true });
  });

  test("announces itself first with the protocol version", async () => {
    const ready = await helper.notification("ready");
    assert.equal(ready.protocolVersion, PROTOCOL_VERSION);
    assert.equal(typeof ready.version, "string");
    const first = helper.received[0];
    assert.ok(
      first && "method" in first && first.method === "ready",
      "ready must be the first message",
    );
  });

  test("ping returns null", async () => {
    assert.equal(success(await helper.request("ping")), null);
  });

  test("getPermissions reports every permission", async () => {
    const permissions = success(await helper.request("getPermissions"));
    assert.deepEqual(Object.keys(permissions).sort(), [
      "accessibility",
      "camera",
      "microphone",
      "screen",
    ]);
    for (const status of Object.values(permissions)) assert.ok(permissionStatuses.includes(status));
  });

  test("listSources returns every source kind", async () => {
    const sources = success(await helper.request("listSources"));
    assert.deepEqual(Object.keys(sources).sort(), [
      "applications",
      "cameras",
      "displays",
      "microphones",
      "windows",
    ]);
    assert.ok(sources.displays.length > 0);
    for (const display of sources.displays) {
      assert.equal(typeof display.id, "number");
      assert.ok(typeof display.name === "string" && display.name.length > 0);
      assert.ok(display.width > 0 && display.height > 0);
      assert.equal(typeof display.isMain, "boolean");
      assert.ok(display.scale >= 1);
    }
    for (const device of sources.microphones) {
      assert.deepEqual(Object.keys(device).sort(), ["id", "isDefault", "name"]);
    }
    for (const camera of sources.cameras) {
      assert.deepEqual(Object.keys(camera).sort(), ["formats", "id", "isDefault", "name"]);
      for (const format of camera.formats)
        assert.ok(format.width > 0 && format.height > 0 && format.maxFps > 0);
      const areas = camera.formats.map((f) => f.width * f.height);
      assert.deepEqual(
        areas,
        [...areas].sort((a, b) => b - a),
      );
    }
  });

  test("rejects malformed input with standard codes", async () => {
    assert.equal(failure(await helper.raw("not json", null)).code, RpcErrorCode.parseError);
    assert.equal(
      failure(await helper.raw(`{"id":1,"method":"ping"}`, 1)).code,
      RpcErrorCode.invalidRequest,
    );
    assert.equal(
      failure(await helper.raw(`{"jsonrpc":"2.0","id":2,"method":"nope"}`, 2)).code,
      RpcErrorCode.methodNotFound,
    );
    assert.equal(
      // @ts-expect-error outputDirectory is required
      failure(await helper.request("startSession", {})).code,
      RpcErrorCode.invalidParams,
    );
  });

  test("reports helper errors with a code and reason", async () => {
    for (const [method, params] of [
      ["stopSession"],
      ["pauseSession"],
      ["resumeSession"],
      ["addMark"],
      ["setScreenMode", { mode: { type: "display" } }],
      ["updateSession", { systemAudio: true }],
    ] as const) {
      const error = failure(await helper.request(method, params));
      assert.equal(error.code, ErrorReasonCode.no_session, method);
      assert.equal(error.data?.reason, "no_session");
    }
    const empty = failure(await helper.request("startSession", { outputDirectory: output }));
    assert.equal(empty.code, ErrorReasonCode.invalid_config);
    assert.equal(empty.data?.reason, "invalid_config");
    const invalidModes: ScreenMode[] = [
      { type: "applications", bundleIds: [] },
      { type: "focusedWindow", bundleIds: [] },
      { type: "area", areas: [] },
      { type: "area", areas: [{ displayId: 1, x: 0, y: 0, width: 0, height: 100 }] },
    ];
    for (const mode of invalidModes) {
      const error = failure(
        await helper.request("startSession", { outputDirectory: output, screen: { mode } }),
      );
      assert.equal(error.code, ErrorReasonCode.invalid_config, mode.type);
    }
  });

  test("never replies to notifications", async () => {
    helper.notify("ping");
    helper.notify("setMetering", { enabled: false });
    success(await helper.request("ping"));
    assert.equal(helper.received.filter((m) => !("method" in m)).length, 1);
  });

  test("setAudioPreview reports sources that can't start and stops on an empty list", async () => {
    const source = { kind: "microphone", deviceId: "chord-contract-missing" } as const;
    const { failures } = success(await helper.request("setAudioPreview", { sources: [source] }));
    assert.deepEqual(
      failures.map((f) => f.source),
      [source],
    );
    assert.equal(typeof failures[0]?.message, "string");
    assert.deepEqual(success(await helper.request("setAudioPreview", { sources: [] })), {
      failures: [],
    });
  });

  test("setScreenPreview reports displays that can't start and stops on an empty list", async () => {
    const previews = [{ id: "missing", displayId: 0xfffffff0, background: "transparent" as const }];
    const { failures } = success(await helper.request("setScreenPreview", { previews }));
    assert.deepEqual(
      failures.map((f) => f.id),
      ["missing"],
    );
    assert.equal(typeof failures[0]?.message, "string");
    assert.deepEqual(success(await helper.request("setScreenPreview", { previews: [] })), {
      failures: [],
    });
  });

  test("setWindowPreview reports a window or null, and stops when disabled", async () => {
    const { window } = success(await helper.request("setWindowPreview", { enabled: true }));
    if (window !== null) {
      assert.equal(typeof window.id, "number");
      assert.equal(typeof window.bundleId, "string");
      assert.equal(typeof window.appName, "string");
    }
    assert.deepEqual(success(await helper.request("setWindowPreview", { enabled: false })), {
      window: null,
    });
  });

  test("setMouseWatch replies null, whether enabled or not", async () => {
    assert.equal(success(await helper.request("setMouseWatch", { enabled: true })), null);
    assert.equal(success(await helper.request("setMouseWatch", { enabled: false })), null);
  });

  test("setKeyWatch replies null, whether enabled or not", async () => {
    assert.equal(success(await helper.request("setKeyWatch", { enabled: true })), null);
    assert.equal(success(await helper.request("setKeyWatch", { enabled: false })), null);
  });

  test("warmUp replies null, whether it warms devices or releases them", async () => {
    assert.equal(
      success(await helper.request("warmUp", { microphones: [{ deviceId: "missing" }] })),
      null,
    );
    assert.equal(success(await helper.request("warmUp", {})), null);
  });

  test("shutdown replies, then exits cleanly", async () => {
    assert.equal(success(await helper.request("shutdown")), null);
    assert.equal(await helper.exited(), 0);
  });

  test(
    "records a session described by its manifest",
    { skip: !capture && "set RECORDER_CONTRACT_CAPTURE=1" },
    async () => {
      const sources = success(await helper.request("listSources"));
      const mic = sources.microphones.find((m) => m.isDefault) ?? sources.microphones[0];
      assert.ok(mic, "no microphone available");

      const started = success(
        await helper.request("startSession", {
          outputDirectory: output,
          microphones: [{ deviceId: mic.id }],
        }),
      );
      assert.equal(started.state, "recording");
      assert.equal(
        failure(await helper.request("startSession", { outputDirectory: output })).data?.reason,
        "session_active",
      );

      await helper.notification("segmentStarted", (s) => s.trackId === "mic-1");
      success(await helper.request("setMetering", { enabled: true }));
      const { levels } = await helper.notification("levels");
      assert.equal(levels[0]?.trackId, "mic-1");
      assert.ok(levels[0].averageDb >= -160 && levels[0].averageDb <= 0);

      const mark = success(await helper.request("addMark", { kind: "retake", note: "again" }));
      assert.equal(mark.kind, "retake");
      success(await helper.request("pauseSession"));
      assert.equal(
        failure(await helper.request("updateSession", {})).data?.reason,
        "invalid_config",
      );
      // The same source, so nothing changes.
      assert.equal(
        success(await helper.request("updateSession", { microphones: [{ deviceId: mic.id }] })),
        null,
      );
      success(await helper.request("resumeSession"));
      await helper.notification("segmentStarted", (s) => s.file === "mic-1-002.m4a");
      const stopped = success(await helper.request("stopSession"));
      assert.equal(stopped.state, "stopped");
      assert.equal(stopped.stopReason, "requested");

      const manifest = JSON.parse(
        readFileSync(join(stopped.directory, MANIFEST_FILE), "utf8"),
      ) as Manifest;
      assert.equal(manifest.version, 1);
      assert.equal(manifest.id, started.id);
      assert.equal(manifest.stopReason, "requested");
      assert.deepEqual(manifest.marks, [mark]);
      assert.equal(manifest.pauses.length, 1);
      const [track] = manifest.tracks;
      assert.equal(track?.kind, "microphone");
      assert.deepEqual(
        track.segments.map((s) => [s.file, s.endReason]),
        [
          ["mic-1-001.m4a", "paused"],
          ["mic-1-002.m4a", "stopped"],
        ],
      );
      for (const segment of track.segments) {
        assert.ok(existsSync(join(stopped.directory, segment.file)));
        assert.ok(segment.end! > segment.start);
      }
    },
  );
});
