import {
  isAnnotationLayer,
  type AnnotationLayer,
  type VisualLayer,
} from "#features/editing/domain/visualLayers";
import type { GroupLayer } from "./timeline.ts";

export type TrackRow =
  | { id: string; type: "media"; layer: GroupLayer }
  | { id: string; type: "effect"; layer: AnnotationLayer };
export interface TrackSection {
  id: string;
  label?: string;
  rows: TrackRow[];
}

/** Match capture setup's source groups; annotations belong to the screen they decorate. */
export function recordingTrackSections(media: GroupLayer[], visual: VisualLayer[]): TrackSection[] {
  const effects: TrackRow[] = visual
    .filter(isAnnotationLayer)
    .map((layer) => ({ id: layer.id, type: "effect", layer }));
  return (
    [
      ["screen", "Screen"],
      ["camera", "Camera"],
      ["microphone", "Microphone"],
      ["systemAudio", "System audio"],
    ] as const
  ).flatMap(([kind, label]): TrackSection[] => {
    const rows: TrackRow[] = media
      .filter((layer) => layer.kind === kind)
      .map((layer) => ({
        id:
          layer.index === 0
            ? (visual.find((source) => source.kind === kind)?.id ?? `${kind}:0`)
            : `${kind === "screen" || kind === "camera" ? "source:" : ""}${kind}:${layer.index}`,
        type: "media",
        layer,
      }));
    if (kind === "screen") rows.push(...effects);
    return rows.length ? [{ id: kind, label, rows }] : [];
  });
}
