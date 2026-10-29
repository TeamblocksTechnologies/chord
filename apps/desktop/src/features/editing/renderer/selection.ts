import { piecesOf, type Project, type Recording } from "#project-document/domain/recording";
import { visualLayersOf, type EffectKind } from "../domain/visualLayers.ts";

/**
 * What the editor shows: the project's video, put together from pieces of its recordings, or one recording on its
 * own, to clean up its transcript, cuts and effects. `time` is where a recording opens, on its own timeline.
 */
export type EditorView =
  { type: "video" } | { type: "recording"; recordingId: string; time?: number };

/** What a recording dragged from the sidebar carries: its id. */
export const RECORDING_DRAG_TYPE = "application/x-chord-recording";

/** The media or annotation track whose own controls are open. */
export type SelectedTrack = "screen" | "camera" | "microphone" | "systemAudio" | EffectKind;

/**
 * Editing selection is independent of the playhead, including while playback crosses recordings. The inspector and
 * the tracks both show and change it, so the track picked in one is the track picked in the other.
 */
export type WorkspaceSelection =
  | {
      type: "recording";
      recordingId: string;
      track?: SelectedTrack;
      trackIndex?: number;
      layerId?: string;
    }
  | { type: "piece"; pieceId: string; track?: SelectedTrack; trackIndex?: number; layerId?: string }
  | { type: "span"; recordingId: string; kind: EffectKind; index: number; layerId?: string };

/** Every media and annotation track can be inspected. */
export function isSelectedTrack(kind: string): kind is SelectedTrack {
  return [
    "screen",
    "camera",
    "microphone",
    "systemAudio",
    "laser",
    "clicks",
    "keys",
    "cursor",
  ].includes(kind);
}

/** A selected annotation span opens that effect's own controls. */
export function selectedTrack(selection: WorkspaceSelection | null): SelectedTrack | undefined {
  return selection?.type === "span" ? selection.kind : selection?.track;
}

export function selectedTrackIndex(selection: WorkspaceSelection | null): number {
  return selection?.type === "span" ? 0 : (selection?.trackIndex ?? 0);
}

export function selectedLayerId(selection: WorkspaceSelection | null): string | undefined {
  const kind = selectedTrack(selection);
  return selection?.layerId ?? (kind ? `${kind}:0` : undefined);
}

/** Whether `recording` recorded `track`. */
export function hasTrack(recording: Recording, track: SelectedTrack): boolean {
  if (track === "screen") return recording.mode !== null;
  if (track === "camera") return recording.hasCamera;
  if (track === "microphone") return recording.hasMicrophone;
  if (track === "systemAudio") return recording.hasSystemAudio;
  return visualLayersOf(recording).some((layer) => layer.kind === track);
}

/** The same recording or clip with `track`'s settings picked, or its general settings without one. */
export function withTrack(
  selection: WorkspaceSelection,
  track: SelectedTrack | undefined,
): WorkspaceSelection {
  const base =
    selection.type === "span"
      ? { type: "recording" as const, recordingId: selection.recordingId }
      : selection.type === "piece"
        ? { type: "piece" as const, pieceId: selection.pieceId }
        : { type: "recording" as const, recordingId: selection.recordingId };
  return track ? { ...base, track } : base;
}

export function selectedRecording(
  project: Project,
  selection: WorkspaceSelection | null,
): Recording | undefined {
  if (!selection) return undefined;
  const id =
    selection.type === "piece"
      ? piecesOf(project).find((piece) => piece.id === selection.pieceId)?.recordingId
      : selection.recordingId;
  return project.recordings.find((recording) => recording.id === id);
}
