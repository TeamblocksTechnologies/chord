import type { Project } from "#project-document/domain/recording";
import { spanBlocks, type Part } from "./timeline.ts";
import {
  EFFECT_KINDS,
  visualLayersOf,
  type EffectKind,
} from "#features/editing/domain/visualLayers";

export const ANNOTATION_TOOLS = {
  laser: { label: "Laser pointer", icon: "laser" },
  clicks: { label: "Click highlights", icon: "click" },
  keys: { label: "Shortcuts", icon: "keyboard" },
  cursor: { label: "Cursor", icon: "cursor" },
} as const;

export interface AnnotationTrack {
  kind: EffectKind;
  /** Present on every playable part with input; otherwise the editor can add the missing layers. */
  added: boolean;
  available: boolean;
}

/** Raw input makes effects editable; each recording's saved spans or explicit additions make its tracks visible. */
export function annotationTracksOf(
  parts: Part[],
  project: Pick<Project, "recordings">,
): AnnotationTrack[] {
  const availableParts = parts.filter((part) => part.timeline.input);
  const available = availableParts.length > 0;
  return EFFECT_KINDS.map((kind) => ({
    kind,
    added:
      available &&
      availableParts.every((part) => {
        const recording = project.recordings.find((recording) => recording.id === part.recordingId);
        return (
          !!recording &&
          visualLayersOf(recording).some(
            (layer) =>
              layer.kind === kind &&
              (recording.visualLayers !== undefined ||
                (recording.annotationTracks as readonly EffectKind[] | undefined)?.includes(kind) ||
                spanBlocks([part], () => recording.annotations, kind).length > 0),
          )
        );
      }),
    available,
  }));
}
