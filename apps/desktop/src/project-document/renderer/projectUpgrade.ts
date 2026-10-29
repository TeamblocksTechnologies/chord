import {
  ANNOTATION_KINDS,
  isAnnotations,
  noAnnotations,
} from "#features/editing/domain/annotations";
import { isCaptionSettings } from "#features/transcription/domain/captions";
import { upgradeClipLayout } from "#features/editing/domain/clipLayout";
import { isCut, normalizeCuts } from "#features/editing/domain/cuts";
import { upgradeNotes } from "#features/recording/domain/notes";
import { withoutPreferences } from "#features/settings/domain/preferences";
import {
  initialSetup,
  isPiece,
  isRecordingBackdrop,
  sequencedPieces,
  upgradeQuality,
  upgradeScreenAppearance,
} from "../domain/recording.ts";
import { normalizeVisualLayers } from "#features/editing/domain/visualLayers";
import type { Piece } from "../domain/recording.ts";
import type { Project, RecordingSetup } from "../domain/recording.ts";

/**
 * Setups saved before microphones and cameras became lists held a single nullable id for each, and before quality
 * presets a frame rate and resolution.
 */
export type StoredSetup = Partial<RecordingSetup> & {
  microphoneId?: string | null;
  cameraId?: string | null;
  displayId?: number | null;
  fps?: number;
  scale?: number;
};

/** Ids from the sample source list used before the helper was wired in. No real device has them. */
const PLACEHOLDER_DEVICE_IDS = new Set([
  "builtin-mic",
  "shure-mv7",
  "airpods-pro",
  "facetime-hd",
  "continuity",
]);

export function upgradeSetup({
  microphoneId,
  cameraId,
  displayId,
  ...stored
}: StoredSetup): Partial<RecordingSetup> {
  const setup: Partial<RecordingSetup> = {
    ...(microphoneId !== undefined && { microphoneIds: microphoneId ? [microphoneId] : [] }),
    ...(cameraId !== undefined && { cameraIds: cameraId ? [cameraId] : [] }),
    ...(displayId !== undefined && { displayIds: displayId === null ? [] : [displayId] }),
    // Mirroring, the compact camera and the countdown are preferences now.
    ...withoutPreferences(upgradeScreenAppearance(upgradeQuality(stored))),
  };
  const real = (ids: string[]) => ids.filter((id) => !PLACEHOLDER_DEVICE_IDS.has(id));
  if (setup.microphoneIds) setup.microphoneIds = real(setup.microphoneIds);
  if (setup.cameraIds) setup.cameraIds = real(setup.cameraIds);
  return setup;
}

/** Fills in fields added since a project was saved. */
export function upgradeProject(project: Project): Project {
  return {
    ...project,
    // Notes were a single block of text before they were pages, and recordings didn't note page changes.
    notes: upgradeNotes(project.notes),
    setup: { ...initialSetup(), ...upgradeSetup(project.setup) },
    annotationTracks: undefined,
    // Pieces could once be placed anywhere; now they play in order.
    ...(Array.isArray(project.pieces) && {
      pieces: sequencedPieces(
        project.pieces
          .map((piece) =>
            piece?.layout
              ? { ...piece, layout: upgradeClipLayout(piece.layout) as Piece["layout"] }
              : piece,
          )
          .filter(isPiece),
      ),
    }),
    // Older projects also saved hand-set line breaks; captions now follow the edit.
    captions: isCaptionSettings(project.captions)
      ? { style: project.captions.style, length: project.captions.length }
      : undefined,
    recordings: project.recordings.map((recording) => ({
      ...recording,
      pageChanges: recording.pageChanges ?? [],
      directory: recording.directory ?? null,
      annotations: isAnnotations(recording.annotations) ? recording.annotations : noAnnotations(),
      backdrop: isRecordingBackdrop(recording.backdrop) ? recording.backdrop : undefined,
      cuts:
        Array.isArray(recording.cuts) && recording.cuts.length > 0
          ? normalizeCuts(recording.cuts.filter(isCut))
          : undefined,
      ...(Array.isArray(recording.visualLayers) && {
        visualLayers: normalizeVisualLayers(recording, recording.visualLayers),
      }),
      annotationTracks: ANNOTATION_KINDS.filter(
        (kind) =>
          (Array.isArray(recording.annotationTracks) &&
            recording.annotationTracks.includes(kind)) ||
          (Array.isArray(project.annotationTracks) && project.annotationTracks.includes(kind)),
      ),
    })),
  };
}
