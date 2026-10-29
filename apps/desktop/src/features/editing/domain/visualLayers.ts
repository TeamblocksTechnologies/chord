import {
  ANNOTATION_KINDS,
  noAnnotations,
  normalizeSpans,
  type AnnotationKind,
  type AnnotationSpan,
  type Annotations,
} from "./annotations.ts";
import type { Recording } from "#project-document/domain/recording";
import { editedSpans, type Cut } from "./cuts.ts";

/** Pointer effects, and the replacement cursor drawn from the recorded mouse. */
export type EffectKind = AnnotationKind | "cursor";
export const EFFECT_KINDS: readonly EffectKind[] = [...ANNOTATION_KINDS, "cursor"];

/** How the replacement cursor looks. */
export interface CursorStyle {
  /** Times the recorded cursor's own size. */
  size: number;
  /** Fades out after the cursor stays still for a moment, and back in as it moves. */
  hideWhenIdle: boolean;
  /** Smooths the recorded path between presses. */
  smooth: boolean;
}

export const DEFAULT_CURSOR_STYLE: CursorStyle = { size: 1, hideWhenIdle: false, smooth: true };
export const CURSOR_SIZE = { min: 0.5, max: 3 };

export interface AnnotationLayer {
  id: string;
  kind: EffectKind;
  name?: string;
  spans: AnnotationSpan[];
  /** Cursor layers only. */
  cursor?: CursorStyle;
}

/** Recorded visual sources and independently editable annotation tracks. */
export type VisualLayer = AnnotationLayer | { id: string; kind: "screen" | "camera" };
export type VisualSource = Pick<
  Recording,
  "mode" | "hasCamera" | "annotations" | "annotationTracks" | "visualLayers"
>;

export function isAnnotationLayer(layer: VisualLayer): layer is AnnotationLayer {
  return (
    layer.kind === "laser" ||
    layer.kind === "clicks" ||
    layer.kind === "keys" ||
    layer.kind === "cursor"
  );
}

/** A cursor layer's style, with anything missing or out of range set to its default. */
export function cursorStyleOf(layer: Pick<AnnotationLayer, "cursor">): CursorStyle {
  const style = layer.cursor;
  const size = Number(style?.size);
  return {
    size: Number.isFinite(size)
      ? Math.min(Math.max(size, CURSOR_SIZE.min), CURSOR_SIZE.max)
      : DEFAULT_CURSOR_STYLE.size,
    hideWhenIdle:
      typeof style?.hideWhenIdle === "boolean"
        ? style.hideWhenIdle
        : DEFAULT_CURSOR_STYLE.hideWhenIdle,
    smooth: typeof style?.smooth === "boolean" ? style.smooth : DEFAULT_CURSOR_STYLE.smooth,
  };
}

/** Old recordings get deterministic track identities. */
export function visualLayersOf(recording: VisualSource): VisualLayer[] {
  if (Array.isArray(recording.visualLayers))
    return normalizeVisualLayers(recording, recording.visualLayers);
  const effects: AnnotationLayer[] = (["keys", "laser", "clicks"] as const)
    .filter(
      (kind) =>
        recording.annotations[kind].length > 0 || recording.annotationTracks?.includes(kind),
    )
    .map((kind) => ({ id: `${kind}:0`, kind, spans: recording.annotations[kind] }));
  return [
    ...(recording.hasCamera ? [{ id: "camera:0", kind: "camera" as const }] : []),
    ...effects,
    ...(recording.mode ? [{ id: "screen:0", kind: "screen" as const }] : []),
  ];
}

/** Validate persisted layers, preserving identities and coverage and retaining recorded media. */
export function normalizeVisualLayers(
  recording: VisualSource,
  values: readonly unknown[],
): VisualLayer[] {
  const ids = new Set<string>();
  const media = new Set<string>();
  const layers: VisualLayer[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const layer = value as Partial<{
      id: string;
      kind: string;
      name: string;
      spans: AnnotationSpan[];
      cursor: CursorStyle;
    }>;
    if (typeof layer.id !== "string" || !layer.id || ids.has(layer.id)) continue;
    if (layer.kind === "camera" || layer.kind === "screen") {
      const kind = layer.kind as "camera" | "screen";
      if (media.has(kind) || (kind === "camera" ? !recording.hasCamera : !recording.mode)) continue;
      layers.push({ id: layer.id, kind });
      media.add(kind);
    } else if (EFFECT_KINDS.includes(layer.kind as EffectKind) && Array.isArray(layer.spans)) {
      const kind = layer.kind as EffectKind;
      // One cursor is drawn per recording.
      if (kind === "cursor" && layers.some((other) => other.kind === "cursor")) continue;
      const spans = layer.spans.filter(
        (span) => Number.isFinite(span?.start) && Number.isFinite(span?.end),
      );
      layers.push({
        id: layer.id,
        kind,
        ...(typeof layer.name === "string" && { name: layer.name }),
        spans: normalizeSpans(spans),
        ...(kind === "cursor" && { cursor: cursorStyleOf(layer) }),
      });
    } else continue;
    ids.add(layer.id);
  }
  const mediaId = (kind: string) => {
    let index = 0;
    while (ids.has(`${kind}:${index}`)) index++;
    return `${kind}:${index}`;
  };
  if (recording.hasCamera && !media.has("camera"))
    layers.unshift({ id: mediaId("camera"), kind: "camera" });
  if (recording.mode && !media.has("screen"))
    layers.push({ id: mediaId("screen"), kind: "screen" });
  return compositingLayers(layers);
}

/** Compatibility for consumers that need combined coverage rather than individual layers. */
export function annotationsOfLayers(layers: readonly VisualLayer[]): Annotations {
  const annotations = noAnnotations();
  for (const layer of layers)
    if (isAnnotationLayer(layer) && layer.kind !== "cursor")
      annotations[layer.kind].push(...layer.spans);
  for (const kind of ANNOTATION_KINDS) annotations[kind] = normalizeSpans(annotations[kind]);
  return annotations;
}

/** Every layer keeps its own coverage when the recording's cuts close up in the video. */
export function editedVisualLayers(
  layers: readonly VisualLayer[],
  cuts: readonly Cut[],
): VisualLayer[] {
  return layers.map((layer) =>
    isAnnotationLayer(layer) ? { ...layer, spans: editedSpans(layer.spans, cuts) } : { ...layer },
  );
}

/**
 * Fixed composition: camera above annotations above screen, regardless of saved array order. The cursor sits over
 * click highlights, under the laser that stands in for it.
 */
export function compositingLayers(layers: readonly VisualLayer[]): VisualLayer[] {
  const depth = { camera: 0, keys: 1, laser: 2, cursor: 3, clicks: 4, screen: 5 };
  return [...layers].sort((a, b) => depth[a.kind] - depth[b.kind]);
}
