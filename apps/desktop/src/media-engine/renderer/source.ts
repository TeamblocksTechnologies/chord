/** What a project's video draws, worked out once for the editor's export and for thumbnails. */
import type { BackgroundState } from "#features/background-removal/contracts/backgroundRemoval";
import type { TranscriptionState } from "#features/transcription/domain/captions";
import { editedAnnotations, editedPiece } from "#features/editing/domain/cuts";
import { audioGain, audioLevel } from "#features/editing/domain/audioSettings";
import { piecesOf, type Project } from "#project-document/domain/recording";
import { editedVisualLayers, visualLayersOf } from "#features/editing/domain/visualLayers";
import type { NoiseState } from "#features/audio-processing/contracts/noiseReduction";
import { audioSources } from "./audioSources.ts";
import { cameraBackgrounds } from "./background.ts";
import { projectCaptions } from "./captions.ts";
import type { PlayerPiece } from "./player.svelte.ts";
import { recordingBackdrops } from "./stage.ts";
import type { Part } from "./timeline.ts";
import type { ExportSource } from "#features/exporting/renderer/exporter";

/** What the video plays: the edit, each piece with its recording's cuts left out. */
export function videoPieces(project: Pick<Project, "recordings" | "pieces">): PlayerPiece[] {
  const recordings = new Map(project.recordings.map((recording) => [recording.id, recording]));
  return piecesOf(project).map((piece) => {
    const cuts = recordings.get(piece.recordingId)?.cuts ?? [];
    return cuts.length > 0 ? { ...editedPiece(piece, cuts), cuts } : piece;
  });
}

/**
 * The video as it's exported: `parts`, laid out from `videoPieces`, with each recording's effects where they play once
 * its cuts close up, its captions, camera backgrounds and backdrop. `project` is a plain copy, not reactive state.
 */
export function videoSource(
  project: Project,
  video: { parts: Part[]; duration: number; aspect: number },
  transcripts: Record<string, TranscriptionState>,
  backgroundStates: Record<string, BackgroundState>,
  noiseStates: Record<string, NoiseState> = {},
): ExportSource {
  const annotations = new Map(
    project.recordings.map((recording) => [
      recording.id,
      editedAnnotations(recording.annotations, recording.cuts ?? []),
    ]),
  );
  const layers = new Map(
    project.recordings.map((recording) => [
      recording.id,
      editedVisualLayers(visualLayersOf(recording), recording.cuts ?? []),
    ]),
  );
  const audio = new Map(project.recordings.map((recording) => [recording.id, recording.audio]));
  return {
    ...video,
    layers: (recordingId) => layers.get(recordingId),
    annotations: (recordingId) => annotations.get(recordingId),
    audioLevels: (recordingId, kind, index) => audioLevel(audio.get(recordingId), kind, index),
    audioGains: (recordingId, kind, index) => audioGain(audio.get(recordingId), kind, index),
    audioSources: audioSources(project.recordings, noiseStates),
    captions: projectCaptions(video.parts, project.recordings, transcripts, project.captions),
    captionStyle: project.captions?.style,
    backgrounds: cameraBackgrounds(project.recordings, backgroundStates),
    backdrops: recordingBackdrops(project.recordings),
  };
}
