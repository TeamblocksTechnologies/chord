import type {
  AudioSource,
  AudioSourceFailure,
  AudioSourceLevel,
  Mark,
  PreviewWindow,
  ScreenPreview,
  ScreenPreviewFailure,
  WindowPreviewConfig,
  PermissionKind,
  Permissions,
  ScreenMode,
  SegmentEndReason,
  SessionConfig,
  SessionInfo,
  SessionUpdate,
  SourceList,
  TrackLevel,
} from "./types.ts";

/** Requests the app sends to the helper. */
export interface Methods {
  ping: { params: undefined; result: null };
  /** Finalizes any session, replies, then exits. */
  shutdown: { params: undefined; result: null };
  getPermissions: { params: undefined; result: Permissions };
  /** Shows the OS prompt if the user hasn't been asked yet. */
  requestPermission: { params: { permission: PermissionKind }; result: Permissions };
  listSources: { params: undefined; result: SourceList };
  /**
   * Keeps the microphones and cameras in `update` running without recording them, so a session starting soon doesn't
   * wait for them to power up. Replaces what was warm before; an update without any releases them. The next
   * `startSession` releases them once it has taken over. Best effort: devices that can't start are left for the
   * session to report.
   */
  warmUp: { params: SessionUpdate; result: null };
  startSession: { params: SessionConfig; result: SessionInfo };
  /** Hard stop of every track. */
  pauseSession: { params: undefined; result: SessionInfo };
  /** Starts new segment files. */
  resumeSession: { params: undefined; result: SessionInfo };
  stopSession: { params: undefined; result: SessionInfo };
  /**
   * Switches the screen tracks to `mode`. While recording, capturing tracks end their segment with `modeChanged`
   * and the tracks `mode` records start new ones; while paused, `mode` applies on resume. Fails without changing
   * anything if `mode` can't start, e.g. `window_unavailable`. `invalid_config` if the session records no screen.
   */
  setScreenMode: { params: { mode: ScreenMode }; result: null };
  /**
   * Pins exactly `windowIds` (see `ScreenConfig.pinnedWindowIds`), without touching the mode's tracks. Windows pinned
   * for the first time get new tracks in `session.json`, which start now, or on resume while paused. Tracks of
   * windows left out end their segment with `unpinned` and continue if pinned again. Fails without changing anything
   * with `window_unavailable` if a newly pinned window isn't open; a pinned window that closed stays pinned without
   * recording. `invalid_config` if the session records no screen.
   */
  setPinnedWindows: { params: { windowIds: number[] }; result: null };
  /**
   * Makes the session record exactly `update`, as if it had started with it, without cutting tracks that carry on.
   * Sources are matched to tracks by device: one switched off ends its segment with `removed`, and one switched back
   * on continues on the same track. New sources get new tracks in `session.json` (`mic-2`, `camera-1`, `screen-1`,
   * `system-audio`), which start now, or on resume while paused. Tracks whose settings changed (a camera's format, or
   * the screen's quality, cursor, or exclusions) end their segment with `configChanged` and continue with the new
   * ones. The screen mode and pinned windows change as with `setScreenMode` and `setPinnedWindows`.
   *
   * Fails without changing anything with `invalid_config` if `update` records nothing or is invalid, or as
   * `setScreenMode` and `setPinnedWindows` do. Sources that fail to start are reported with `trackError`.
   */
  updateSession: { params: SessionUpdate; result: null };
  /** Timestamped when the helper reads it. `kind` defaults to `mark`. Allowed while recording or paused. */
  addMark: { params: { kind?: string; note?: string } | undefined; result: Mark };
  /** Off by default. While on, `levels` is sent every ~100ms. */
  setMetering: { params: { enabled: boolean }; result: null };
  /**
   * Meters exactly `sources`, independent of any session, sending `previewLevels` every ~50ms while any are on.
   * Sources no longer listed stop; an empty list stops previewing. Sources that can't start are left out and
   * returned in `failures`; the rest still run.
   */
  setAudioPreview: {
    params: { sources: AudioSource[] };
    result: { failures: AudioSourceFailure[] };
  };
  /**
   * Shows exactly `previews`, independent of any session: each captures its display as a recording would, at most
   * 960 pixels wide and ~10fps. Frames are too heavy for stdout, so they go to the pipe the app opens as the helper's
   * file descriptor 3 (see `readPreviewFrames`): JPEG, or PNG with alpha for a `transparent` background. Previews
   * no longer listed stop, and those whose settings changed restart; an empty list stops previewing. Previews that
   * can't start are left out and returned in `failures`, as all are when there's no pipe; the rest still run.
   */
  setScreenPreview: {
    params: { previews: ScreenPreview[] };
    result: { failures: ScreenPreviewFailure[] };
  };
  /**
   * While enabled, watches which window a `focusedWindow` session would follow if it started now (the frontmost
   * allowed window) and sends `previewWindow` when that changes. Replies with the current one. Disabling stops it.
   */
  setWindowPreview: { params: WindowPreviewConfig; result: { window: PreviewWindow | null } };
  /**
   * While enabled, watches whether any mouse button is held and sends `mouseButton` with the current state, then on
   * every change. Needs no permission. Disabling stops it.
   */
  setMouseWatch: { params: { enabled: boolean }; result: null };
  /**
   * While enabled, sends `keyPress` each time a key goes down (modifier keys alone don't count), with the modifiers
   * held. Keys already down when it starts are ignored, and holding one doesn't repeat it. Needs no permission.
   * Disabling stops it.
   */
  setKeyWatch: { params: { enabled: boolean }; result: null };
}

export type KeyModifier = "command" | "control" | "option" | "shift";

/** Notifications the helper sends unprompted. */
export interface Notifications {
  /** First message after launch. */
  ready: { version: string; protocolVersion: number };
  sessionState: SessionInfo;
  segmentStarted: { trackId: string; file: string; start: number };
  segmentEnded: { trackId: string; file: string; end: number; reason: SegmentEndReason };
  /**
   * Latest level of every active track. Sampled, not queued: if the reader falls behind, ticks are skipped.
   */
  levels: { levels: TrackLevel[] };
  /** Non-fatal unless followed by `sessionState` with `stopReason`. */
  trackError: { trackId: string; message: string };
  /** Re-run `listSources`. */
  devicesChanged: undefined;
  /** Latest level of every source `setAudioPreview` is metering. Sampled like `levels`. */
  previewLevels: { levels: AudioSourceLevel[] };
  /** The window `setWindowPreview` reports changed. */
  previewWindow: { window: PreviewWindow | null };
  /** Whether any mouse button is held, while `setMouseWatch` is enabled. */
  mouseButton: { down: boolean };
  /** A key went down, while `setKeyWatch` is enabled. `keyCode` is the macOS virtual key code. */
  keyPress: { keyCode: number; modifiers: KeyModifier[] };
}

export type MethodName = keyof Methods;
export type MethodParams<M extends MethodName> = Methods[M]["params"];
export type MethodResult<M extends MethodName> = Methods[M]["result"];
export type NotificationName = keyof Notifications;
export type NotificationParams<N extends NotificationName> = Notifications[N];

export const METHOD_NAMES = [
  "ping",
  "shutdown",
  "getPermissions",
  "requestPermission",
  "listSources",
  "warmUp",
  "startSession",
  "pauseSession",
  "resumeSession",
  "stopSession",
  "setScreenMode",
  "setPinnedWindows",
  "updateSession",
  "addMark",
  "setMetering",
  "setAudioPreview",
  "setScreenPreview",
  "setWindowPreview",
  "setMouseWatch",
  "setKeyWatch",
] as const satisfies readonly MethodName[];

export const NOTIFICATION_NAMES = [
  "ready",
  "sessionState",
  "segmentStarted",
  "segmentEnded",
  "levels",
  "trackError",
  "devicesChanged",
  "previewLevels",
  "previewWindow",
  "mouseButton",
  "keyPress",
] as const satisfies readonly NotificationName[];

// Fails to compile if a method or notification is missing from the lists above.
type Missing<All, Listed> = [Exclude<All, Listed>] extends [never] ? true : never;
const _allMethods: Missing<MethodName, (typeof METHOD_NAMES)[number]> = true;
const _allNotifications: Missing<NotificationName, (typeof NOTIFICATION_NAMES)[number]> = true;
