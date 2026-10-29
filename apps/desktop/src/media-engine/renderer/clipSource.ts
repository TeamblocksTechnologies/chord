import type { Part } from "./timeline.ts";

/** A composite clip reveals the leading media file at its trimmed start, or its session folder while loading. */
export function clipSourcePath(directory: string | null, part?: Part): string | undefined {
  if (!directory) return undefined;
  const file = part?.timeline.clips.find((clip) => clip.offset + clip.duration > part.start)?.file;
  return file ? `${directory}/${file}` : directory;
}
