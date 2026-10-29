import type { Manifest } from "@teamblocks.dev/chord-recorder-protocol";

/**
 * Where the pause-free recording clock sits on the session clock: the lead track's segments end to end, as the player
 * lays them out. `duration` measures a segment the helper didn't finish.
 */
export async function leadClips(
  manifest: Manifest,
  duration: (file: string) => Promise<number>,
): Promise<{ start: number; duration: number; offset: number }[]> {
  const tracks = manifest.tracks.filter((track) => track.segments.length > 0);
  const lead =
    tracks.find((track) => track.kind === "screen" && track.display) ??
    tracks.find((track) => track.kind === "camera") ??
    tracks.find((track) => track.kind === "microphone" || track.kind === "systemAudio");
  if (!lead) throw new Error("This recording has no playable tracks");
  let offset = 0;
  const clips = [];
  for (const segment of lead.segments) {
    const length =
      segment.end !== undefined ? segment.end - segment.start : await duration(segment.file);
    if (length > 0) {
      clips.push({ start: segment.start, duration: length, offset });
      offset += length;
    }
  }
  return clips;
}
