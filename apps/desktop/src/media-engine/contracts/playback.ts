import type { BoundsSample, InputEvent, Manifest } from "@teamblocks.dev/chord-recorder-protocol";

/** A recording's session folder, read for playback. */
export interface LoadedSession {
  directory: string;
  manifest: Manifest;
  /** Each screen track's `bounds` file, by track id. */
  bounds: Record<string, BoundsSample[]>;
  /** The `input` file, in time order. Empty for sessions recorded before input was. */
  input: InputEvent[];
}

/** Serves files from loaded sessions to the renderer. See `mediaUrl`. */
export const MEDIA_SCHEME = "chord-media";

/** A URL the renderer can load a file in a loaded session from. */
export function mediaUrl(directory: string, file: string): string {
  return `${MEDIA_SCHEME}://file/${encodeURIComponent(`${directory}/${file}`)}`;
}

/** `url` for the cleaned copy of the audio file it names, which the media scheme serves in its place once one exists. */
export function cleanedUrl(url: string, version: string): string {
  return `${url}?clean=${encodeURIComponent(version)}`;
}

/** Bounds files are JSON Lines; unreadable lines are skipped, since the last can be partial if the helper crashed. */
export function parseBounds(text: string): BoundsSample[] {
  return parseLines<BoundsSample>(text);
}

/** Input files are JSON Lines like bounds files. Keys are written once released, so they're sorted into place. */
export function parseInput(text: string): InputEvent[] {
  return parseLines<InputEvent>(text).sort((a, b) => a.time - b.time);
}

function parseLines<T>(text: string): T[] {
  return text.split("\n").flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line) as T] : [];
    } catch {
      return [];
    }
  });
}
