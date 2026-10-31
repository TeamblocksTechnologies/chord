import type { ScreenArea } from "@teamblocks.dev/chord-recorder-protocol";
import {
  recordsAnything,
  type CaptureMode,
  type RecordingSetup,
} from "@teamblocks.dev/chord-ui/model/setup";
import type { AnnotationKind, Annotations } from "#features/editing/domain/annotations";
import type { AudioSettings } from "#features/editing/domain/audioSettings";
import { isClipLayout, type ClipLayout } from "#features/editing/domain/clipLayout";
import type { VisualLayer } from "#features/editing/domain/visualLayers";
import type { CaptionSettings } from "#features/transcription/domain/captions";
import type { Cut } from "#features/editing/domain/cuts";
import type { NotePage, RecordedPageChange } from "#features/recording/domain/notes";
import { isCameraQuality, isScreenQuality } from "#features/recording/domain/quality";

// The setup and its helpers are shared with the recording controls in the UI package.
export {
  activeAreas,
  activeCameraIds,
  activeMicrophoneIds,
  capturesScreen,
  initialSetup,
  recordsAnything,
  type CaptureMode,
  type RecordingSetup,
} from "@teamblocks.dev/chord-ui/model/setup";

/** One continuous recording session inside a project. */
export interface Recording {
  id: string;
  /** ISO 8601. */
  createdAt: string;
  /** Seconds of recorded time, excluding pauses. */
  duration: number;
  /** Null when the recording had no screen. */
  mode: CaptureMode | null;
  hasMicrophone: boolean;
  hasCamera: boolean;
  hasSystemAudio: boolean;
  markCount: number;
  /** Which notes page was shown from when, starting at 0. Empty when there were no notes. */
  pageChanges: RecordedPageChange[];
  /** Combined effect coverage in recorded time; legacy recordings use this until visual layers are edited. */
  annotations: Annotations;
  /** Annotation layers explicitly added to this recording, including layers with no spans yet. */
  annotationTracks?: AnnotationKind[];
  /** Visual sources with independent annotation track identities and coverage. */
  visualLayers?: VisualLayer[];
  /** Volume and mute per audio track, keyed by kind and index. Absent tracks play at their recorded level. */
  audio?: AudioSettings;
  /** What the picture sits on. Absent follows the project: the gradient when any recording follows a window, otherwise black. */
  backdrop?: RecordingBackdrop;
  /** What's cut from it wherever it plays, on its own timeline, in order. Absent until something is cut. */
  cuts?: Cut[];
  /** The session folder the helper wrote. Null for recordings made before capture was connected. */
  directory: string | null;
}

export interface Project {
  id: string;
  name: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. Bumped by edits and new recordings. */
  updatedAt: string;
  /** Recording notes, shown while recording. */
  notes: NotePage[];
  setup: RecordingSetup;
  /** Oldest first. */
  recordings: Recording[];
  /** Legacy project-wide layers, migrated to the project's existing recordings when loaded. */
  annotationTracks?: AnnotationKind[];
  /**
   * The edit: what of each recording plays, in order, one after another. Absent until the project is edited; then each
   * recording plays whole, one after another.
   */
  pieces?: Piece[];
  /** How captions show the transcript. Absent until changed. */
  captions?: CaptionSettings;
}

/** What a recording's picture sits on, where it doesn't fill the stage. */
export type RecordingBackdrop = "gradient" | "black";

export function isRecordingBackdrop(value: unknown): value is RecordingBackdrop {
  return value === "gradient" || value === "black";
}

/** The camera bubble's placement within one timeline clip. */
export type CameraPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "hidden";
export interface CameraLayout {
  position: CameraPosition;
  /** Fraction of the stage width. */
  width: number;
}

export function isCameraLayout(value: unknown): value is CameraLayout {
  if (!value || typeof value !== "object") return false;
  const layout = value as CameraLayout;
  return (
    ["top-left", "top-right", "bottom-left", "bottom-right", "hidden"].includes(layout.position) &&
    Number.isFinite(layout.width) &&
    layout.width >= 0.12 &&
    layout.width <= 0.4
  );
}

/**
 * A stretch of a recording in a project's edit, from `start` to `end` on the recording's playback timeline (pauses
 * left out). Splitting and trimming only change pieces, so the recording itself is kept whole. What's cut from the
 * recording is left out of every piece of it.
 */
export interface Piece {
  id: string;
  recordingId: string;
  start: number;
  /** Null plays to the recording's end. */
  end: number | null;
  /** Where it started on the project's timeline, in seconds, when pieces could be placed anywhere. No longer saved. */
  offset?: number;
  /** Earlier camera placement, used to seed the default composition. */
  cameraLayout?: CameraLayout;
  /** Composition for this occurrence of the recording. */
  layout?: ClipLayout;
}

/** What the project plays, in order: its edit, or each recording whole. */
export function piecesOf(project: Pick<Project, "recordings" | "pieces">): Piece[] {
  return (
    project.pieces ??
    project.recordings.map((recording) => ({
      id: recording.id,
      recordingId: recording.id,
      start: 0,
      end: null,
    }))
  );
}

/** Pieces saved when they could be placed anywhere, in the order they played, one after another. */
export function sequencedPieces(pieces: Piece[]): Piece[] {
  const placed = pieces.every((piece) => piece.offset !== undefined);
  const ordered = placed ? [...pieces].sort((a, b) => a.offset! - b.offset!) : pieces;
  return ordered.map(({ offset: _, ...piece }) => piece);
}

export function isPiece(value: unknown): value is Piece {
  if (!value || typeof value !== "object") return false;
  const piece = value as Partial<Piece>;
  return (
    typeof piece.id === "string" &&
    typeof piece.recordingId === "string" &&
    Number.isFinite(piece.start) &&
    (piece.end === null || Number.isFinite(piece.end)) &&
    (piece.offset === undefined || Number.isFinite(piece.offset)) &&
    (piece.cameraLayout === undefined || isCameraLayout(piece.cameraLayout)) &&
    (piece.layout === undefined || isClipLayout(piece.layout))
  );
}

/**
 * Why a live recording can't switch from `current` to `next`, or null if it can. Anything else just ends the
 * affected tracks' segments and starts new ones, so the recording carries on.
 */
export function liveChangeError(_current: RecordingSetup, next: RecordingSetup): string | null {
  if (!recordsAnything(next)) return "A recording needs at least one source";
  return null;
}

/** Validate persisted defaults and the merged result of a renderer's partial update. */
export function isRecordingSetup(value: unknown): value is RecordingSetup {
  if (!value || typeof value !== "object") return false;
  const s = value as RecordingSetup;
  const strings = (v: unknown) => Array.isArray(v) && v.every((id) => typeof id === "string");
  return (
    [s.recordsScreen, s.microphoneEnabled, s.cameraEnabled, s.systemAudio, s.showsSystemUI].every(
      (v) => typeof v === "boolean",
    ) &&
    ["window", "display", "area"].includes(s.mode) &&
    Array.isArray(s.displayIds) &&
    s.displayIds.every((id) => Number.isInteger(id)) &&
    Array.isArray(s.areas) &&
    s.areas.every(isScreenArea) &&
    Array.isArray(s.inactiveAreaDisplayIds) &&
    s.inactiveAreaDisplayIds.every((id) => Number.isInteger(id)) &&
    Array.isArray(s.pinnedWindowIds) &&
    s.pinnedWindowIds.every((id) => Number.isInteger(id)) &&
    ["desktop", "transparent"].includes(s.background) &&
    (s.primaryCameraId === null || typeof s.primaryCameraId === "string") &&
    [s.microphoneIds, s.cameraIds, s.allowedApps, s.hiddenApps].every(strings) &&
    ["standard", "high", "max"].includes(s.quality) &&
    (s.screenQuality === null || isScreenQuality(s.screenQuality)) &&
    !!s.cameraQuality &&
    typeof s.cameraQuality === "object" &&
    Object.values(s.cameraQuality).every(isCameraQuality)
  );
}

function isScreenArea(value: unknown): value is ScreenArea {
  if (!value || typeof value !== "object") return false;
  const a = value as ScreenArea;
  return (
    Number.isInteger(a.displayId) &&
    Number.isFinite(a.x) &&
    Number.isFinite(a.y) &&
    a.width > 0 &&
    a.height > 0
  );
}

/**
 * Setups saved before quality presets chose a frame rate and resolution directly. The old default (30 fps, full
 * size) is the High preset; anything else becomes the screen's own settings.
 */
export function upgradeQuality<T extends object>(stored: T): Omit<T, "fps" | "scale"> {
  const { fps, scale, ...rest } = stored as T & { fps?: unknown; scale?: unknown };
  if (fps === undefined && scale === undefined) return rest;
  const custom = { fps: fps === 60 ? 60 : 30, scale: scale === 0.5 ? 0.5 : 1, hdr: false } as const;
  const changed = custom.fps !== 30 || custom.scale !== 1;
  return { ...rest, ...(!("screenQuality" in rest) && { screenQuality: changed ? custom : null }) };
}

/** Preserve the old combined setting when loading a setup saved before the Mac UI toggle existed. */
export function upgradeScreenAppearance<T extends object>(
  stored: T,
): T & { showsSystemUI: boolean } {
  const setup = stored as T & { background?: unknown; showsSystemUI?: boolean };
  return { ...stored, showsSystemUI: setup.showsSystemUI ?? setup.background !== "transparent" };
}
