import type { KeyModifier } from "./methods.ts";
import type {
  Mark,
  ScreenMode,
  SegmentEndReason,
  SessionConfig,
  StopReason,
  TrackKind,
} from "./types.ts";

/** The manifest written inside each session folder. */
export const MANIFEST_FILE = "session.json";

/**
 * Describes every file in a session folder on one timeline. All times are seconds since the session started,
 * measured on a single monotonic clock shared by every track, so segments, pauses, and marks line up.
 * Written atomically after every change.
 */
export interface Manifest {
  version: 1;
  id: string;
  /** ISO 8601. */
  createdAt: string;
  /** Platform monotonic clock reading at session start, in seconds. For debugging alignment. */
  hostTimeOrigin: number;
  /** The config the session started with, with defaults filled in. */
  config: SessionConfig;
  tracks: ManifestTrack[];
  pauses: Pause[];
  marks: Mark[];
  /** `focusedWindow`: which window was followed over time. Bounds are in each screen track's `bounds` file. */
  windows?: WindowSample[];
  /**
   * A JSON Lines file in the session folder, e.g. `input.jsonl`, of `InputEvent`: the mouse and the keys that
   * matter, recorded throughout so pointer effects can be added after recording. Appended as input happens, except
   * while paused. Missing from sessions recorded before input was.
   */
  input?: string;
  /** Missing if the helper crashed before the session stopped. */
  stoppedAt?: number;
  stopReason?: StopReason;
}

export interface ManifestTrack {
  /** e.g. `screen-1`, `mic-1`. */
  id: string;
  kind: TrackKind;
  /** What is captured at session start, e.g. `display:main` or a device id. */
  source: string;
  /** Screen tracks: the display recorded. */
  display?: TrackDisplay;
  /** Pinned window tracks: the window recorded, as it was when pinned. */
  window?: RecordedWindow;
  /**
   * `focusedWindow` and pinned windows: a JSON Lines file in the session folder, e.g. `screen-1-bounds.jsonl`, of `BoundsSample`: one
   * line per recorded frame where the bounds of what's shown (the followed window and any of its UI) changed, read
   * from the window server as the frame arrives (they can trail the image by about a frame). Appended as frames are
   * written.
   */
  bounds?: string;
  segments: ManifestSegment[];
}

export interface ManifestSegment {
  /** Relative to the session folder, e.g. `mic-1-002.m4a`. */
  file: string;
  /** Time of the first sample. */
  start: number;
  /** Missing while recording, or if the helper crashed. */
  end?: number;
  endReason?: SegmentEndReason;
  /**
   * Screen tracks only, except pinned windows': the mode this segment started in. An area track records the nth of
   * the mode's `areas` on its display.
   */
  screenMode?: ScreenMode;
}

/** In global display coordinates: points, origin at the top left of the main display. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TrackDisplay {
  id: number;
  frame: Rect;
  /** Pixels per point. */
  scale: number;
}

export interface RecordedWindow {
  id: number;
  bundleId: string;
  title?: string;
}

/**
 * The followed window from `time` until the next sample. `window` is missing when nothing is followed; `hidden` is
 * set while it's off screen (minimized, hidden, or on another Space).
 */
export interface WindowSample {
  time: number;
  window?: RecordedWindow;
  hidden?: true;
}

/**
 * A line of a screen track's `bounds` file: the bounds of what's shown (the followed window and any of its UI) in the
 * frame at `time` and every frame after, until the next line. `frame` is missing when none of it is on the track's
 * display.
 */
export interface BoundsSample {
  time: number;
  /** `RecordedWindow.id`. */
  window?: number;
  frame?: Rect;
}

export interface Pause {
  start: number;
  end?: number;
}

export type MouseButton = "left" | "right" | "other";

/**
 * A line of a session's `input` file. Positions are in global display coordinates, like `Rect`. Lines are mostly in
 * time order, but a `key` is written once it's released, after anything that happened while it was held.
 */
export type InputEvent =
  /** The cursor moved here. Also written when recording starts or resumes, wherever it is. */
  | { type: "move"; time: number; x: number; y: number }
  /** A mouse button went down or up here. A button held when recording stops or pauses is let up then. */
  | { type: "down" | "up"; time: number; button: MouseButton; x: number; y: number }
  /**
   * A key that matters went down at `time`, with the modifiers held, and was held for `duration`. Plain typing is
   * never recorded: only keys pressed with command, control or option, keys that type nothing (return, tab, delete,
   * escape, arrows, function keys, and the like), a modifier pressed and released alone (`modifiers` then holds the
   * others held with it), and caps lock as it's switched (with no duration). `key` is the macOS virtual key code.
   */
  | { type: "key"; time: number; key: number; modifiers: KeyModifier[]; duration: number }
  /**
   * The system cursor took this shape: also written when recording starts or resumes. `image` is a PNG in the session
   * folder, e.g. `cursors/1a2b3c4d.png`, written once per shape and missing if it couldn't be; it's at its largest
   * resolution, `width` by `height` points on screen, with the hotspot `hotspotX`, `hotspotY` points from its top
   * left. `kind` is set when it's exactly one of the system's standard cursors. Missing from sessions recorded before
   * shapes were.
   */
  | {
      type: "cursor";
      time: number;
      image?: string;
      width: number;
      height: number;
      hotspotX: number;
      hotspotY: number;
      kind?: CursorKind;
    };

/** The system's standard cursors, as AppKit names them. */
export type CursorKind =
  | "arrow"
  | "iBeam"
  | "iBeamVertical"
  | "pointingHand"
  | "openHand"
  | "closedHand"
  | "crosshair"
  | "notAllowed"
  | "contextualMenu"
  | "dragCopy"
  | "dragLink"
  | "disappearingItem"
  | "resizeLeftRight"
  | "resizeUpDown"
  | "resizeLeft"
  | "resizeRight"
  | "resizeUp"
  | "resizeDown";
