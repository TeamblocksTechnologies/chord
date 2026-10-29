import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import {
  type BoundsSample,
  MANIFEST_FILE,
  type Manifest,
} from "@teamblocks.dev/chord-recorder-protocol";
import { app, protocol } from "electron";
import {
  type LoadedSession,
  MEDIA_SCHEME,
  parseBounds,
  parseInput,
} from "../contracts/playback.ts";
import { isInside } from "#features/recording/main/capture";
import { measureLevel } from "#features/audio-processing/main/levelAudio";
import { cleanedFile } from "#features/audio-processing/main/noiseFiles";
import { PlaybackAudio } from "./playbackAudio.ts";

/** Session folders the renderer has loaded; media is only served from these. */
const loaded = new Set<string>();

/** Decoded copies of lossless audio, for playback and for measuring it. */
let playbackAudio: PlaybackAudio | undefined;

const MEDIA_SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  stream: true,
  supportFetchAPI: true,
  corsEnabled: true,
};

/** Has to happen before the app is ready; integration checks that load the app later register it themselves. */
export function registerMediaScheme(): void {
  if (!app.isReady())
    protocol.registerSchemesAsPrivileged([
      { scheme: MEDIA_SCHEME, privileges: MEDIA_SCHEME_PRIVILEGES },
    ]);
}

/**
 * Call once the app is ready. Serves session media with range requests so video can seek, and projects' thumbnails,
 * which `thumbnail` finds by project id and file name.
 */
export function handleMediaScheme(
  thumbnail: (projectId: string, file: string) => string | undefined = () => undefined,
): void {
  const audio = (playbackAudio = process.platform === "darwin" ? new PlaybackAudio() : undefined);
  app.once("will-quit", () => audio?.dispose());
  protocol.handle(MEDIA_SCHEME, async (request) => {
    // CORS lets the renderer read video frames back to find the window in them.
    const cors = { "Access-Control-Allow-Origin": "*" };
    const requested = new URL(request.url);
    let path = servedPath(requested, thumbnail);
    // A track's cleaned copy is served in place of its recorded file when there is one, whatever its version says.
    if (path && requested.searchParams.has("clean")) path = cleanedCopy(path) ?? path;
    let size = path
      ? await stat(path).then(
          (s) => s.size,
          () => undefined,
        )
      : undefined;
    if (!path || size === undefined)
      return new Response("not found", { status: 404, headers: cors });
    if (audio && extname(path).toLowerCase() === ".m4a") {
      try {
        path = await audio.file(path);
        size = (await stat(path)).size;
      } catch (error) {
        console.error("[playback]", error);
        return new Response("Audio could not be decoded", { status: 500, headers: cors });
      }
    }
    const headers = { ...cors, "Content-Type": contentType(path), "Accept-Ranges": "bytes" };
    if (size === 0) return new Response(null, { headers: { ...headers, "Content-Length": "0" } });
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("Range") ?? "");
    if (!range || (!range[1] && !range[2])) {
      return new Response(stream(path, 0, size - 1), {
        headers: { ...headers, "Content-Length": String(size) },
      });
    }
    // `bytes=-n` is the last n bytes.
    const start = range[1] ? Number(range[1]) : Math.max(size - Number(range[2]), 0);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      return new Response(null, {
        status: 416,
        headers: { ...cors, "Content-Range": `bytes */${size}` },
      });
    }
    return new Response(stream(path, start, end), {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
    });
  });
}

/** The cleaned copy of the recorded file at `path`, if it's in a loaded session and has one. */
function cleanedCopy(path: string): string | undefined {
  const folder = [...loaded].find((candidate) => path.startsWith(candidate + sep));
  return folder ? cleanedFile(folder, relative(folder, path)) : undefined;
}

/** A WAV that the recorded audio file at `file` can be read from, decoding it first if it needs it. */
export async function decodedAudio(file: string): Promise<string> {
  if (!playbackAudio) throw new Error("Audio isn't available yet");
  return playbackAudio.file(file);
}

/**
 * The gain that levels a recording's `index`-th audio track of `kind`, measured over everything it recorded; null when
 * it has nothing to level. Rejects anything outside `root`.
 */
export async function levelTrack(
  root: string,
  directory: unknown,
  kind: unknown,
  index: unknown,
  clean: unknown = false,
): Promise<number | null> {
  const audio = playbackAudio;
  if (!audio) throw new Error("Leveling audio isn't available yet");
  if (typeof directory !== "string" || !isInside(root, directory))
    throw new Error("Not a recording");
  if (
    (kind !== "microphone" && kind !== "systemAudio") ||
    !Number.isInteger(index) ||
    (index as number) < 0
  )
    throw new Error("Not an audio track");
  const folder = resolve(directory);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(join(folder, MANIFEST_FILE), "utf8"));
  } catch {
    throw new Error("This recording's files are missing or unreadable");
  }
  // The index counts the tracks of that kind that recorded anything, the way playback does.
  const track = manifest.tracks.filter(
    (candidate) => candidate.kind === kind && candidate.segments.length > 0,
  )[index as number];
  if (!track) throw new Error("This recording has no such audio track");
  if (typeof clean !== "boolean") throw new Error("Not an audio track");
  // The gain of the cleaned copy is its own: cleaning changes what is loud.
  const files = track.segments.map((segment) => {
    const original = join(folder, segment.file);
    if (!clean) return original;
    const cleaned = cleanedFile(folder, segment.file);
    if (!cleaned) throw new Error("Reduce this track's noise first");
    return cleaned;
  });
  return measureLevel(files, (file) => audio.file(file));
}

/**
 * Reads a recording's session folder inside `root` and lets the renderer load its media. Rejects anything outside
 * `root`, so a renderer can't read other files.
 */
export async function loadSession(root: string, directory: unknown): Promise<LoadedSession> {
  if (typeof directory !== "string" || !isInside(root, directory))
    throw new Error("Not a recording");
  const folder = resolve(directory);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await readFile(join(folder, MANIFEST_FILE), "utf8"));
  } catch {
    throw new Error("This recording's files are missing or unreadable");
  }
  const bounds: Record<string, BoundsSample[]> = {};
  for (const track of manifest.tracks) {
    if (track.bounds)
      bounds[track.id] = parseBounds(
        await readFile(join(folder, track.bounds), "utf8").catch(() => ""),
      );
  }
  const input = manifest.input
    ? parseInput(await readFile(join(folder, manifest.input), "utf8").catch(() => ""))
    : [];
  loaded.add(folder);
  return { directory: folder, manifest, bounds, input };
}

/** The file `url` names, if it's in a loaded session or is a project's thumbnail. */
function servedPath(
  url: URL,
  thumbnail: (projectId: string, file: string) => string | undefined,
): string | undefined {
  if (url.host === "thumbnail") {
    const [projectId, file, ...rest] = url.pathname.slice(1).split("/").map(decodeURIComponent);
    return projectId && file && rest.length === 0 ? thumbnail(projectId, file) : undefined;
  }
  if (url.host !== "file") return undefined;
  const path = resolve(decodeURIComponent(url.pathname.slice(1)));
  return [...loaded].some((folder) => path.startsWith(folder + sep)) ? path : undefined;
}

function stream(path: string, start: number, end: number): ReadableStream {
  return Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
}

function contentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".m4a":
      return "audio/mp4";
    case ".wav":
      return "audio/wav";
    case ".jpg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}
