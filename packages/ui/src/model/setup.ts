import type { CameraQuality, QualityPreset, ScreenQuality } from "./quality.ts";
import type { ScreenArea, ScreenBackground } from "./sources.ts";

/** What the screen tracks capture. Maps onto the recorder protocol's `ScreenMode`. */
export type CaptureMode =
  /** Only the focused window, following focus between allowed apps. */
  | "window"
  /** A whole display. */
  | "display"
  /** Areas of displays, each recorded as its own track. */
  | "area";

/** Everything needed to start a recording. Used for quick-start defaults and each project's own setup. */
export interface RecordingSetup {
  /** False records no screen, e.g. a camera-only recording; `mode` and the screen settings are then ignored. Turned off by deselecting every display. */
  recordsScreen: boolean;
  mode: CaptureMode;
  /**
   * `DisplaySource.id`s, each recorded as its own track. Empty means the main display. Only `display` mode uses them.
   */
  displayIds: number[];
  /** `area` mode: the areas to record, on any displays. Kept while other modes are in use. */
  areas: ScreenArea[];
  /** Displays whose `areas` are kept but switched off in `area` mode, so checking one back on restores them. */
  inactiveAreaDisplayIds: number[];
  /** `display` and `area` modes: whether wallpaper and desktop icons are left transparent. */
  background: ScreenBackground;
  /** Whether display and area capture includes the Dock, menu bar, and system overlays. */
  showsSystemUI: boolean;
  /** `DeviceSource.id`s, each recorded as its own track. Empty records no microphone. */
  microphoneIds: string[];
  /** False switches the microphones off while `microphoneIds` keeps the choice, so switching back on restores it. */
  microphoneEnabled: boolean;
  /** `DeviceSource.id`s, each recorded as its own track. Empty records no camera. */
  cameraIds: string[];
  /** False switches the cameras off while `cameraIds` keeps the choice, so switching back on restores it. */
  cameraEnabled: boolean;
  /** The recorded camera the island previews; null, or one no longer recorded, picks the default one. */
  primaryCameraId: string | null;
  systemAudio: boolean;
  /** `window` mode: bundle ids allowed to be followed. Empty allows every app. */
  allowedApps: string[];
  /**
   * `window` mode: `WindowSource.id`s recorded on their own tracks besides the followed window, which never follows
   * them. Windows that have closed since are skipped.
   */
  pinnedWindowIds: number[];
  /** Bundle ids hidden from this setup's recordings in every mode, besides the always-hidden apps in preferences. */
  hiddenApps: string[];
  /** Video quality for the screen and every camera without its own settings. */
  quality: QualityPreset;
  /** The screen's own settings; null follows `quality`. */
  screenQuality: ScreenQuality | null;
  /** Cameras' own settings by `DeviceSource.id`; cameras not listed follow `quality`. */
  cameraQuality: Record<string, CameraQuality>;
}

export function initialSetup(): RecordingSetup {
  return {
    recordsScreen: true,
    mode: "window",
    displayIds: [],
    areas: [],
    inactiveAreaDisplayIds: [],
    background: "desktop",
    showsSystemUI: true,
    microphoneIds: [],
    microphoneEnabled: true,
    cameraIds: [],
    cameraEnabled: true,
    primaryCameraId: null,
    systemAudio: false,
    allowedApps: [],
    pinnedWindowIds: [],
    hiddenApps: [],
    quality: "high",
    screenQuality: null,
    cameraQuality: {},
  };
}

export function activeCameraIds(setup: RecordingSetup): string[] {
  return setup.cameraEnabled ? setup.cameraIds : [];
}

export function activeMicrophoneIds(setup: RecordingSetup): string[] {
  return setup.microphoneEnabled ? setup.microphoneIds : [];
}

/** The areas that are switched on. */
export function activeAreas(setup: RecordingSetup): ScreenArea[] {
  return setup.areas.filter((a) => !setup.inactiveAreaDisplayIds.includes(a.displayId));
}

/** Whether the screen is recorded: it's on and, in `area` mode, has an area. */
export function capturesScreen(setup: RecordingSetup): boolean {
  return setup.recordsScreen && (setup.mode !== "area" || activeAreas(setup).length > 0);
}

export function recordsAnything(setup: RecordingSetup): boolean {
  return (
    capturesScreen(setup) ||
    activeCameraIds(setup).length > 0 ||
    activeMicrophoneIds(setup).length > 0 ||
    setup.systemAudio
  );
}

/** Everything a recording hides: the setup's own apps and the always-hidden ones. */
export function excludedApps(setupHidden: string[], alwaysHidden: string[]): string[] {
  return [...new Set([...setupHidden, ...alwaysHidden])];
}
