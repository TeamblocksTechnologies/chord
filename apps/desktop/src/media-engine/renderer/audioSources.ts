import {
  audioDenoised,
  audioTrackKey,
  type AudioSettings,
  type AudioSources,
} from "#features/editing/domain/audioSettings";
import type { NoiseState } from "#features/audio-processing/contracts/noiseReduction";
import { cleanedUrl } from "../contracts/playback.ts";

/**
 * Where each recording's audio plays from: a track with noise reduction on plays its cleaned copy once there is one,
 * and its recorded file until then. `noise` is the state the main process reports, by recording folder.
 */
export function audioSources(
  recordings: readonly { id: string; directory?: string | null; audio?: AudioSettings }[],
  noise: Record<string, NoiseState>,
): AudioSources {
  const byId = new Map(recordings.map((recording) => [recording.id, recording]));
  return (recordingId, kind, index, url) => {
    const recording = byId.get(recordingId);
    const result = recording?.directory
      ? noise[recording.directory]?.tracks[audioTrackKey(kind, index)]?.result
      : undefined;
    return result && audioDenoised(recording?.audio, kind, index)
      ? cleanedUrl(url, result.id)
      : url;
  };
}
