// MARK: Permissions

export type PermissionKind = "screen" | "microphone" | "camera" | "accessibility";

export type PermissionStatus = "granted" | "denied" | "notDetermined" | "restricted";

export interface Permissions {
  /** macOS can't distinguish "not asked yet" from "denied" for screen recording; anything but granted is `denied`. */
  screen: PermissionStatus;
  microphone: PermissionStatus;
  camera: PermissionStatus;
  /**
   * Lets `focusedWindow` tell dialogs, panels, and sheets from standard windows. Like screen, anything but granted is
   * `denied`; requesting opens System Settings rather than prompting.
   */
  accessibility: PermissionStatus;
}

// MARK: Sources

export interface DisplaySource {
  id: number;
  /** What the OS calls it, e.g. "Built-in Retina Display" or "LG UltraFine". */
  name: string;
  /** Native pixels. */
  width: number;
  height: number;
  /** Pixels per point. `ScreenArea`s are in points. */
  scale: number;
  isMain: boolean;
}

export interface ApplicationSource {
  /** Bundle id on macOS; the platform's stable app identifier elsewhere. */
  bundleId: string;
  name: string;
  pid: number;
}

/** A window that can be pinned: a standard window on screen. Chord's own windows aren't listed. */
export interface WindowSource {
  /** CGWindowID on macOS; what `ScreenConfig.pinnedWindowIds` takes. */
  id: number;
  bundleId: string;
  appName: string;
  /** Absent when the app doesn't title it, or without screen recording permission. */
  title?: string;
}

export interface DeviceSource {
  id: string;
  name: string;
  isDefault: boolean;
}

/** A size a camera can capture at. */
export interface CameraFormat {
  /** Native pixels. */
  width: number;
  height: number;
  /** Highest frame rate the camera supports at this size. */
  maxFps: number;
}

export interface CameraSource extends DeviceSource {
  /** One per distinct size, largest first. */
  formats: CameraFormat[];
}

export interface SourceList {
  displays: DisplaySource[];
  /** Empty until screen recording permission is granted. */
  applications: ApplicationSource[];
  /** Front to back. */
  windows: WindowSource[];
  microphones: DeviceSource[];
  cameras: CameraSource[];
}

// MARK: Session configuration

/** What `display` and `area` modes show besides app windows. */
export type ScreenBackground =
  /** Wallpaper and desktop icons are visible. */
  | "desktop"
  /**
   * The wallpaper and desktop icons are transparent, so a background can be put behind them later.
   * `showsSystemUI` independently controls the Dock, menu bar, and system overlays. Records SDR, as HEVC with alpha.
   */
  | "transparent";

/** Part of a display, in points from its top left. Parts outside the display are left out. */
export interface ScreenArea {
  /** A `DisplaySource.id`. */
  displayId: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What the screen tracks record. A session has one screen track per display connected at start (`screen-1` is the
 * main display); the mode decides which of them capture. `area` mode records each area on a track of its own
 * instead. `ScreenConfig.excludedBundleIds` applies in every mode.
 */
export type ScreenMode =
  /** Whole displays, each on its own track. */
  | {
      type: "display";
      /** Defaults to the main display. */
      displayIds?: number[];
      /** Default `desktop`. */
      background?: ScreenBackground;
      /** Include the Dock, menu bar, and system overlays. Defaults to true for `desktop`, false for `transparent`. */
      showsSystemUI?: boolean;
    }
  /**
   * Areas of displays connected at start, each on its own track: `area-1-screen-1` is the first area on the main
   * display. The nth area on a display keeps its track when the mode changes; changing an area's position or size
   * continues it in a new segment. At least one, each with a positive size.
   */
  | {
      type: "area";
      areas: ScreenArea[];
      /** Default `desktop`. */
      background?: ScreenBackground;
      /** Include the Dock, menu bar, and system overlays. Defaults to true for `desktop`, false for `transparent`. */
      showsSystemUI?: boolean;
    }
  /** A display showing only the windows of these apps. Apps launched mid-session are picked up. */
  | {
      type: "applications";
      /** At least one. */
      bundleIds: string[];
      /** Defaults to the main display. */
      displayId?: number;
    }
  /**
   * Every display, showing only the followed window and its UI, transparent elsewhere, so resizing it, dragging it
   * between displays, or following another window never cuts. Follows the topmost allowed window at start, then
   * whichever allowed window is focused; focusing a window that isn't allowed keeps the current one.
   *
   * A window that opens from the followed window and is noticeably smaller (or, with `accessibility` permission, is
   * a dialog, sheet, or panel) is shown with it as a popup, and focusing it keeps the followed window. The app's
   * menus, popovers, and tooltips are shown too. `Manifest.windows` records which window was followed, and each
   * screen track's `bounds` file where it and its UI were.
   */
  | {
      type: "focusedWindow";
      /** Only these apps' windows are allowed. Defaults to every app. At least one if given. */
      bundleIds?: string[];
    };

export type VideoCodec = "h264" | "hevc";

export interface VideoQuality {
  /** Default 30. */
  fps?: number;
  /** Default `hevc`. */
  codec?: VideoCodec;
  /** Average bits per second. Defaults to the encoder's choice. */
  bitrate?: number;
  /** Multiplier on native pixel resolution, e.g. 0.5 for half size. Default 1. */
  scale?: number;
  /**
   * Captures the display's extended dynamic range as 10-bit HEVC. Only `display` and `area` modes with a `desktop`
   * background on macOS 15 or later; others record SDR. Default false.
   */
  hdr?: boolean;
}

export interface ScreenConfig {
  /** Default `{ type: "display" }`. */
  mode?: ScreenMode;
  /** Default true. */
  showsCursor?: boolean;
  /** Chord's own windows are hidden from recordings unless true. Default false. */
  captureChord?: boolean;
  /** Apps hidden from the recording in every mode. */
  excludedBundleIds?: string[];
  /**
   * `WindowSource.id`s recorded on their own screen tracks in every mode, besides what the mode records: one per
   * display connected at start (`window-1-screen-1`, ...), each showing only the window and its UI, as `focusedWindow`
   * shows the followed window. `focusedWindow` never follows them. `window_unavailable` if one isn't open. Change them
   * mid-session with `setPinnedWindows`.
   */
  pinnedWindowIds?: number[];
  quality?: VideoQuality;
}

/** Microphones are recorded lossless (ALAC) at 48 kHz, mono or stereo as the device delivers. */
export interface MicrophoneConfig {
  /** A `DeviceSource.id` from `listSources`. */
  deviceId: string;
}

export interface CameraConfig {
  /** A `CameraSource.id` from `listSources`. */
  deviceId: string;
  /** One of the camera's `formats`. Defaults to the camera's own choice. */
  format?: { width: number; height: number };
  /** Default 30, capped at the format's `maxFps`. */
  fps?: number;
  /** Average bits per second of the H.264 video. Defaults to a rate that scales with the size. */
  bitrate?: number;
}

export interface SessionConfig {
  /** The session folder is created inside this directory. */
  outputDirectory: string;
  screen?: ScreenConfig;
  microphones?: MicrophoneConfig[];
  cameras?: CameraConfig[];
  /** Record the sound the Mac is playing as its own lossless stereo track. Needs screen recording permission. */
  systemAudio?: boolean;
}

/** What `updateSession` makes a session record: its config without the output directory. */
export type SessionUpdate = Omit<SessionConfig, "outputDirectory">;

// MARK: Sessions

export type SessionState = "idle" | "recording" | "paused" | "stopped";

export type StopReason =
  /** `stopSession` was called. */
  | "requested"
  /** The helper is exiting: stdin closed, `shutdown`, or a signal. */
  | "shutdown"
  /** A file could not be written because the disk is full. Fatal to the whole session. */
  | "diskFull";

export interface SessionInfo {
  id: string;
  /** Absolute path of the session folder. */
  directory: string;
  state: SessionState;
  /** Set once stopped. */
  stopReason?: StopReason;
}

export interface Mark {
  id: string;
  /** Seconds since session start. */
  time: number;
  kind: string;
  note?: string;
}

// MARK: Tracks

export type TrackKind = "screen" | "microphone" | "camera" | "systemAudio";

export type SegmentEndReason =
  | "stopped"
  | "paused"
  /** A microphone or display disconnected; continues when it reconnects. */
  | "deviceDisconnected"
  /** The machine slept; continues on wake. */
  | "systemSleep"
  /** Screen tracks only; continues on unlock. */
  | "screenLocked"
  | "diskFull"
  /** `setScreenMode` was called; the next segment uses the new mode. */
  | "modeChanged"
  /** Pinned window tracks: the window closed. They don't continue. */
  | "windowClosed"
  /** Pinned window tracks: `setPinnedWindows` left the window out. They continue if it's pinned again. */
  | "unpinned"
  /** `updateSession` switched the source off. It continues on the same track if switched back on. */
  | "removed"
  /** `updateSession` changed the source's settings; the next segment uses the new ones. */
  | "configChanged"
  /** Capture or write error; retried every few seconds. */
  | "error";

export interface TrackLevel {
  trackId: string;
  /** Clamped to -160...0 dBFS. */
  averageDb: number;
  peakDb: number;
}

// MARK: Previews

/** An audio input that can be metered outside a session, to preview it before recording. */
export type AudioSource =
  /** A `DeviceSource.id` from `listSources().microphones`. */
  | { kind: "microphone"; deviceId: string }
  /** The sound the Mac is playing. Needs screen recording permission. */
  | { kind: "systemAudio" };

export interface AudioSourceLevel {
  source: AudioSource;
  /** Clamped to -160...0 dBFS. */
  averageDb: number;
  peakDb: number;
}

export interface AudioSourceFailure {
  source: AudioSource;
  message: string;
}

/** The window `focusedWindow` mode would follow if a session started now. */
export interface PreviewWindow {
  /** CGWindowID on macOS; the same id screen capture APIs use for the window. */
  id: number;
  bundleId: string;
  appName: string;
  /** Absent when the app doesn't title it, or without screen recording permission. */
  title?: string;
}

export interface WindowPreviewConfig {
  enabled: boolean;
  /** As in the `focusedWindow` screen mode: apps that may be followed. Omit to allow every app. */
  bundleIds?: string[];
  /** As in `ScreenConfig.excludedBundleIds`. Chord's own windows are always skipped. */
  excludedBundleIds?: string[];
  /** As in `ScreenConfig.pinnedWindowIds`: skipped, since a session pinning them doesn't follow them. */
  pinnedWindowIds?: number[];
}

/** A display shown live outside any session, as a `display` mode recording of it would capture it. */
export interface ScreenPreview {
  /** Names the preview's frames. */
  id: string;
  /** A `DisplaySource.id`. */
  displayId: number;
  /** Default `desktop`. */
  background?: ScreenBackground;
  /** Include the Dock, menu bar, and system overlays. Defaults to true for `desktop`, false for `transparent`. */
  showsSystemUI?: boolean;
  /** As in `ScreenConfig.excludedBundleIds`. Chord's own windows are always left out. */
  excludedBundleIds?: string[];
  /** Default true. */
  showsCursor?: boolean;
}

export interface ScreenPreviewFailure {
  /** The `ScreenPreview.id`. */
  id: string;
  message: string;
}
