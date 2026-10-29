import type {
  CameraSource,
  ScreenConfig,
  ScreenMode,
  SessionUpdate,
} from "@teamblocks.dev/chord-recorder-protocol";
import {
  defaultPreferences,
  excludedApps,
  type Preferences,
} from "#features/settings/domain/preferences";
import { cameraConfig, resolveScreen, screenVideoQuality } from "./quality.ts";
import {
  activeAreas,
  activeCameraIds,
  activeMicrophoneIds,
  capturesScreen,
  type Project,
  type RecordingSetup,
} from "#project-document/domain/recording";

/** The helper's screen mode for a setup that records the screen. */
export function screenMode(setup: RecordingSetup): ScreenMode {
  const { background, showsSystemUI } = setup;
  switch (setup.mode) {
    case "window":
      return {
        type: "focusedWindow",
        ...(setup.allowedApps.length > 0 && { bundleIds: setup.allowedApps }),
      };
    case "display":
      return {
        type: "display",
        ...(setup.displayIds.length > 0 && { displayIds: setup.displayIds }),
        background,
        showsSystemUI,
      };
    case "area":
      return { type: "area", areas: activeAreas(setup), background, showsSystemUI };
  }
}

/** The windows a setup pins, among `openWindowIds` when given, since pinning one that has closed fails. */
export function pinnedWindows(setup: RecordingSetup, openWindowIds?: readonly number[]): number[] {
  if (setup.mode !== "window") return [];
  return openWindowIds
    ? setup.pinnedWindowIds.filter((id) => openWindowIds.includes(id))
    : setup.pinnedWindowIds;
}

function screenConfig(
  setup: RecordingSetup,
  preferences: Preferences,
  openWindowIds?: readonly number[],
): ScreenConfig {
  const pinned = pinnedWindows(setup, openWindowIds);
  return {
    mode: screenMode(setup),
    ...(pinned.length > 0 && { pinnedWindowIds: pinned }),
    showsCursor: preferences.showsCursor,
    excludedBundleIds: excludedApps(setup.hiddenApps, preferences.hiddenApps),
    quality: screenVideoQuality(resolveScreen(setup.quality, setup.screenQuality)),
  };
}

/**
 * What the helper records for `setup`, for `startSession` (with an output directory) and `updateSession`, leaving
 * out the setup's hidden apps and the always-hidden apps in `preferences`. Cameras get their preset's or own format
 * from `cameras`, the helper's list; one that isn't listed keeps its own choice. Pinned windows not among
 * `openWindowIds`, when given, are left out.
 */
export function sessionUpdate(
  setup: RecordingSetup,
  cameras: CameraSource[],
  preferences: Preferences = defaultPreferences(),
  openWindowIds?: readonly number[],
): SessionUpdate {
  return {
    ...(capturesScreen(setup) && { screen: screenConfig(setup, preferences, openWindowIds) }),
    microphones: activeMicrophoneIds(setup).map((deviceId) => ({ deviceId })),
    cameras: activeCameraIds(setup).map((deviceId) => {
      const camera = cameras.find((c) => c.id === deviceId);
      return camera
        ? cameraConfig(camera, setup.quality, setup.cameraQuality[deviceId])
        : { deviceId };
    }),
    systemAudio: setup.systemAudio,
  };
}

/** Loom-style automatic title, e.g. "Recording Oct 17, 3:42 PM". */
export function quickProjectName(date = new Date()): string {
  const formatted = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Recording ${formatted}`;
}

/**
 * A project's folder name, from its name when first recorded: characters Finder or the shell treat specially become
 * spaces or dashes, and an empty name becomes "Untitled project".
 */
export function projectFolderName(name: string): string {
  const cleaned = name
    .replace(/[/:]/g, "-")
    // Control characters cannot be part of a recording folder name.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
  return cleaned || "Untitled project";
}

/** The folder a project's recordings go in: its first recording's, or one named for it. */
export function projectFolder(project: Pick<Project, "name" | "recordings">): string {
  const directory = project.recordings.find((r) => r.directory)?.directory;
  return directory?.split("/").at(-2) ?? projectFolderName(project.name);
}

function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
  return `${day} at ${time}`;
}

/**
 * An exported video's file name: the project's name and when it was exported, like a macOS screenshot, e.g.
 * "Demo 2026-10-21 at 14.32.05.mp4", so each export of a project gets its own.
 */
export function exportFileName(projectName: string, date: Date, extension: string): string {
  return `${projectFolderName(projectName)} ${stamp(date)}.${extension}`;
}

/**
 * A saved frame's file name: named as an export is, then where in the video the frame is, in minutes and seconds
 * (with hours from the first), e.g. "Demo 2026-10-21 at 14.32.05 frame 01.23.png".
 */
export function frameFileName(projectName: string, date: Date, seconds: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const whole = Math.max(0, Math.floor(seconds));
  const [hours, minutes] = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60)];
  const at = `${hours > 0 ? `${hours}.` : ""}${pad(minutes)}.${pad(whole % 60)}`;
  return `${projectFolderName(projectName)} ${stamp(date)} frame ${at}.png`;
}
