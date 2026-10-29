import type { ProjectDocuments } from "#project-document/domain/document";
import type { Project, Recording, Piece } from "#project-document/domain/recording";
import type { Cut } from "./cuts.ts";
import type { AnnotationLayer, EffectKind, VisualLayer } from "./visualLayers.ts";
import type { AudioTrackSettings } from "./audioSettings.ts";
import { withAudioSettings } from "./audioSettings.ts";
import type { CaptionSettings } from "#features/transcription/domain/captions";
import * as edits from "./edits.ts";

/** Feature commands use one document edit boundary; persistence stays with the document owner. */
export function createProjectEdits(documents: ProjectDocuments) {
  const editRecording = <T>(
    project: Project,
    recording: Recording,
    edit: (draft: Recording) => T,
  ): T =>
    documents.change(project, (draft) => {
      const current = draft.recordings.find((item) => item.id === recording.id);
      if (!current) throw new Error("The recording is no longer in this project");
      return edit(current);
    });
  return {
    setVisualLayers(project: Project, recording: Recording, layers: VisualLayer[]): void {
      editRecording(project, recording, (draft) => edits.setVisualLayers(draft, layers));
    },
    addAnnotationTrack(project: Project, recording: Recording, kind: EffectKind): AnnotationLayer {
      return editRecording(project, recording, (draft) => edits.addAnnotationTrack(draft, kind));
    },
    duplicateAnnotationTrack(
      project: Project,
      recording: Recording,
      layer: AnnotationLayer,
      label: string,
    ): AnnotationLayer {
      return editRecording(project, recording, (draft) =>
        edits.duplicateAnnotationTrack(draft, layer, label),
      );
    },
    setCuts(
      project: Project,
      recordingId: string,
      cuts: Cut[],
      duration: (recordingId: string) => number,
    ): void {
      if (!project.recordings.some((recording) => recording.id === recordingId)) return;
      documents.change(project, (draft) => edits.setCuts(draft, recordingId, cuts, duration));
    },
    setPieces(project: Project, pieces: Piece[]): void {
      documents.change(project, (draft) => edits.setPieces(draft, pieces));
    },
    addToTracks(project: Project, recordingId: string): void {
      documents.change(project, (draft) => edits.addToTracks(draft, recordingId));
    },
    setAudio(
      project: Project,
      recording: Recording,
      kind: "microphone" | "systemAudio",
      index: number,
      patch: Partial<AudioTrackSettings>,
    ): void {
      editRecording(project, recording, (draft) => {
        draft.audio = withAudioSettings(draft.audio, kind, index, patch);
      });
    },
    setCaptions(project: Project, settings: CaptionSettings): void {
      documents.change(project, (draft) => {
        draft.captions = settings;
      });
    },
  };
}
