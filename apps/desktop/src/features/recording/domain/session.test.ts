import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultPreferences } from "#features/settings/domain/preferences";
import { initialSetup } from "#project-document/domain/recording";
import { exportFileName, frameFileName, projectFolderName, sessionUpdate } from "./session.ts";

const camera = {
  id: "cam",
  name: "FaceTime HD Camera",
  isDefault: true,
  formats: [
    { width: 1920, height: 1080, maxFps: 60 },
    { width: 1280, height: 720, maxFps: 60 },
  ],
};

test("a setup becomes what the helper records", () => {
  const setup = {
    ...initialSetup(),
    microphoneIds: ["mic"],
    cameraIds: ["cam", "unplugged"],
    systemAudio: true,
    hiddenApps: ["com.1password.1password"],
    allowedApps: ["com.apple.Safari"],
  };
  // Always-hidden apps join the setup's own, once each.
  assert.deepEqual(
    sessionUpdate(setup, [camera], {
      ...defaultPreferences(),
      hiddenApps: ["com.apple.MobileSMS", "com.1password.1password"],
    }),
    {
      screen: {
        mode: { type: "focusedWindow", bundleIds: ["com.apple.Safari"] },
        showsCursor: true,
        excludedBundleIds: ["com.1password.1password", "com.apple.MobileSMS"],
        quality: { fps: 30, scale: 1, hdr: false },
      },
      microphones: [{ deviceId: "mic" }],
      // Cameras the helper doesn't list keep their own choice.
      cameras: [
        { deviceId: "cam", format: { width: 1920, height: 1080 }, fps: 30 },
        { deviceId: "unplugged" },
      ],
      systemAudio: true,
    },
  );
});

test("windows mode pins the windows still open, and other modes pin none", () => {
  const setup = { ...initialSetup(), pinnedWindowIds: [41, 42] };
  assert.deepEqual(sessionUpdate(setup, []).screen?.pinnedWindowIds, [41, 42]);
  assert.deepEqual(
    sessionUpdate(setup, [], defaultPreferences(), [42, 99]).screen?.pinnedWindowIds,
    [42],
    "Closed windows are left out",
  );
  assert.equal(
    "pinnedWindowIds" in sessionUpdate(setup, [], defaultPreferences(), []).screen!,
    false,
  );
  assert.equal(
    "pinnedWindowIds" in sessionUpdate({ ...setup, mode: "display" }, []).screen!,
    false,
  );
});

test("switched-off sources and an empty area mode record nothing", () => {
  const setup = {
    ...initialSetup(),
    mode: "area" as const,
    microphoneIds: ["mic"],
    microphoneEnabled: false,
    cameraIds: ["cam"],
    cameraEnabled: false,
  };
  assert.deepEqual(sessionUpdate(setup, [camera]), {
    microphones: [],
    cameras: [],
    systemAudio: false,
  });
});

test("display and area modes carry their background and system UI", () => {
  const area = { displayId: 2, x: 0, y: 0, width: 640, height: 360 };
  const display = sessionUpdate(
    { ...initialSetup(), mode: "display", background: "transparent", showsSystemUI: false },
    [],
  );
  assert.deepEqual(display.screen?.mode, {
    type: "display",
    background: "transparent",
    showsSystemUI: false,
  });
  const areas = sessionUpdate(
    {
      ...initialSetup(),
      mode: "area",
      areas: [area, { ...area, displayId: 3 }],
      inactiveAreaDisplayIds: [3],
    },
    [],
  );
  assert.deepEqual(areas.screen?.mode, {
    type: "area",
    areas: [area],
    background: "desktop",
    showsSystemUI: true,
  });
});

test("mouse visibility is independent of Mac UI and background in every capture mode", () => {
  const area = { displayId: 2, x: 0, y: 0, width: 640, height: 360 };
  for (const mode of ["window", "display", "area"] as const) {
    for (const background of ["desktop", "transparent"] as const) {
      for (const showsSystemUI of [true, false]) {
        for (const showsCursor of [true, false]) {
          const setup = { ...initialSetup(), mode, background, showsSystemUI, areas: [area] };
          const screen = sessionUpdate(setup, [], { ...defaultPreferences(), showsCursor }).screen;
          assert.equal(screen?.showsCursor, showsCursor);
          if (screen?.mode?.type === "display" || screen?.mode?.type === "area") {
            assert.equal(screen.mode.showsSystemUI, showsSystemUI);
            assert.equal(screen.mode.background, background);
          }
        }
      }
    }
  }
});

test("project folder names are safe in Finder and the shell", () => {
  assert.equal(projectFolderName("Recording Oct 17, 3:42 PM"), "Recording Oct 17, 3-42 PM");
  assert.equal(projectFolderName("../../etc"), "-..-etc");
  assert.equal(projectFolderName("  a/b\\c\n"), "a-b c");
  assert.equal(projectFolderName("   "), "Untitled project");
});

test("export file names carry the project's name and when it was exported", () => {
  assert.equal(
    exportFileName("Demo: take 2", new Date(2026, 9, 21, 9, 5, 7), "mp4"),
    "Demo- take 2 2026-10-21 at 09.05.07.mp4",
  );
  assert.equal(
    exportFileName("", new Date(2026, 0, 1, 23, 59, 0), "webm"),
    "Untitled project 2026-01-01 at 23.59.00.webm",
  );
  const at = new Date(2026, 9, 21, 9, 5, 7);
  assert.equal(
    frameFileName("Demo: take 2", at, 83.9),
    "Demo- take 2 2026-10-21 at 09.05.07 frame 01.23.png",
    "A frame is named for where it is, in whole seconds",
  );
  assert.equal(frameFileName("Demo", at, 0), "Demo 2026-10-21 at 09.05.07 frame 00.00.png");
  assert.equal(
    frameFileName("Demo", at, 3725),
    "Demo 2026-10-21 at 09.05.07 frame 1.02.05.png",
    "Hours come first once there are any",
  );
  assert.equal(frameFileName("Demo", at, -1), "Demo 2026-10-21 at 09.05.07 frame 00.00.png");
});
