import type { Project, Recording, Piece } from "#project-document/domain/recording";
import { piecesOf } from "#project-document/domain/recording";
import { ANNOTATION_KINDS, type AnnotationKind } from "./annotations.ts";
import { normalizeCuts, rippleCuts, type Cut } from "./cuts.ts";
import {
  DEFAULT_CURSOR_STYLE,
  annotationsOfLayers,
  isAnnotationLayer,
  normalizeVisualLayers,
  visualLayersOf,
  type AnnotationLayer,
  type EffectKind,
  type VisualLayer,
} from "./visualLayers.ts";

/** Apply the editor's invariants independently of Svelte, disk storage and synchronization. */
export function setVisualLayers(recording: Recording, layers: VisualLayer[]): void {
  recording.visualLayers = normalizeVisualLayers(recording, layers);
  recording.annotations = annotationsOfLayers(recording.visualLayers);
  recording.annotationTracks = [
    ...new Set(
      recording.visualLayers
        .filter(isAnnotationLayer)
        .map((layer) => layer.kind)
        .filter((kind): kind is AnnotationKind =>
          ANNOTATION_KINDS.includes(kind as AnnotationKind),
        ),
    ),
  ];
}

export function addAnnotationTrack(recording: Recording, kind: EffectKind): AnnotationLayer {
  const layers = visualLayersOf(recording);
  const existing = layers.find((layer) => layer.kind === kind) as AnnotationLayer | undefined;
  if (existing) return existing;
  const layer: AnnotationLayer = {
    id: crypto.randomUUID(),
    kind,
    spans: [],
    ...(kind === "cursor" && { cursor: { ...DEFAULT_CURSOR_STYLE } }),
  };
  const screen = layers.findIndex((item) => item.kind === "screen");
  layers.splice(screen < 0 ? layers.length : screen, 0, layer);
  setVisualLayers(recording, layers);
  return layer;
}

export function duplicateAnnotationTrack(
  recording: Recording,
  layer: AnnotationLayer,
  label: string,
): AnnotationLayer {
  const layers = visualLayersOf(recording);
  const names = new Set(
    layers
      .filter(isAnnotationLayer)
      .map((item) => item.name ?? (item.kind === layer.kind ? label : "")),
  );
  let number = 2;
  while (names.has(`${label} ${number}`)) number++;
  const copy: AnnotationLayer = {
    ...layer,
    id: crypto.randomUUID(),
    name: `${label} ${number}`,
    spans: layer.spans.map((span) => ({ ...span })),
  };
  layers.splice(
    layers.findIndex((item) => item.id === layer.id),
    0,
    copy,
  );
  setVisualLayers(recording, layers);
  return copy;
}

/** Cuts belong to the recording and adjust every occurrence of it in the project. */
export function setCuts(
  project: Project,
  recordingId: string,
  cuts: Cut[],
  duration: (recordingId: string) => number,
): void {
  const recording = project.recordings.find((item) => item.id === recordingId);
  if (!recording) return;
  const before = recording.cuts ?? [];
  const after = normalizeCuts(cuts);
  if (project.pieces) {
    project.pieces = rippleCuts(project.pieces, recordingId, before, after, (id) => {
      const other = project.recordings.find((item) => item.id === id);
      return (
        other && { duration: duration(id), cuts: id === recordingId ? after : (other.cuts ?? []) }
      );
    });
  }
  recording.cuts = after.length > 0 ? after : undefined;
}

export function setPieces(project: Project, pieces: Piece[]): void {
  project.pieces = pieces;
}

export function addToTracks(project: Project, recordingId: string): void {
  project.pieces = [
    ...piecesOf(project),
    { id: crypto.randomUUID(), recordingId, start: 0, end: null },
  ];
}
