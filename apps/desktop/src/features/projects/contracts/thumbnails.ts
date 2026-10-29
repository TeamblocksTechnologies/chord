import { MANIFEST_FILE } from "@teamblocks.dev/chord-recorder-protocol";
import type { CaptionStyle } from "#features/transcription/domain/captions";
import { MEDIA_SCHEME } from "#media-engine/contracts/playback";
import type { Project, Recording } from "#project-document/domain/recording";

/** The folder in a project's folder its thumbnails are kept in, beside its exports. */
export const THUMBNAILS_FOLDER = "Thumbnails";
/** What a project's thumbnails were rendered from and how to show them. Written after the images, so it marks a finished set. */
export const THUMBNAILS_MANIFEST = "thumbnails.json";
/** Held while a project's thumbnails render, by whichever process on this computer renders them. */
export const THUMBNAILS_LOCK = ".lock";
/** Where in the video the thumbnails are, as fractions of it. The first is the cover. */
export const THUMBNAIL_FRACTIONS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
/** Bumped when what the thumbnails draw changes, so every set renders again. */
export const THUMBNAIL_RENDER_VERSION = 1;
/** The largest a thumbnail is, in pixels; it keeps the video's shape within this box. */
export const THUMBNAIL_SIZE = { width: 960, height: 540 };

/** A caption as the thumbnails show it: just what's drawn. Times are on the project's timeline. */
export interface ThumbnailCaption {
  start: number;
  end: number;
  words: { text: string; start: number }[];
}

/** A thumbnail's image file in the thumbnails folder, e.g. `10.jpg`. */
export function thumbnailFile(fraction: number): string {
  return `${Math.round(fraction * 100)}.jpg`;
}

export function isThumbnailFile(name: string): boolean {
  return THUMBNAIL_FRACTIONS.some((fraction) => thumbnailFile(fraction) === name);
}

/** The video drawn into a project's thumbnails, with the captions kept apart so they can be shown at any time. */
export interface ThumbnailManifest {
  version: typeof THUMBNAIL_RENDER_VERSION;
  /** What the project looked like when they rendered; see `ProjectThumbnails`. */
  fingerprint: string;
  /** ISO 8601. */
  renderedAt: string;
  /** The video's length, in seconds. */
  duration: number;
  /** The video's width / height. */
  aspect: number;
  /** In time order. */
  frames: { file: string; time: number }[];
  captions: ThumbnailCaption[];
  captionStyle: CaptionStyle;
}

export function isThumbnailManifest(value: unknown): value is ThumbnailManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as ThumbnailManifest;
  return (
    manifest.version === THUMBNAIL_RENDER_VERSION &&
    typeof manifest.fingerprint === "string" &&
    typeof manifest.renderedAt === "string" &&
    Number.isFinite(Date.parse(manifest.renderedAt)) &&
    manifest.duration > 0 &&
    manifest.aspect > 0 &&
    Array.isArray(manifest.frames) &&
    manifest.frames.length > 0 &&
    manifest.frames.every(
      (frame) =>
        typeof frame?.file === "string" &&
        isThumbnailFile(frame.file) &&
        Number.isFinite(frame.time),
    ) &&
    Array.isArray(manifest.captions) &&
    manifest.captions.every(isThumbnailCaption) &&
    ["lines", "highlight", "word"].includes(manifest.captionStyle)
  );
}

/** A project's thumbnails, ready to show. */
export interface ThumbnailSet {
  duration: number;
  aspect: number;
  /** In time order; the first is the cover. */
  frames: { url: string; time: number }[];
  captions: ThumbnailCaption[];
  captionStyle: CaptionStyle;
}

/** What a render sends back: the frames as JPEG, in time order. */
export interface ThumbnailRender {
  duration: number;
  aspect: number;
  frames: { time: number; image: Uint8Array }[];
  captions: ThumbnailCaption[];
  captionStyle: CaptionStyle;
}

function isThumbnailCaption(value: unknown): value is ThumbnailCaption {
  if (!value || typeof value !== "object") return false;
  const caption = value as ThumbnailCaption;
  return (
    Number.isFinite(caption.start) &&
    Number.isFinite(caption.end) &&
    Array.isArray(caption.words) &&
    caption.words.every((word) => typeof word?.text === "string" && Number.isFinite(word.start))
  );
}

/** A render from the thumbnail window: a frame for each of `THUMBNAIL_FRACTIONS`, in order, each a JPEG. */
export function isThumbnailRender(value: unknown): value is ThumbnailRender {
  if (!value || typeof value !== "object") return false;
  const render = value as ThumbnailRender;
  return (
    render.duration > 0 &&
    render.aspect > 0 &&
    ["lines", "highlight", "word"].includes(render.captionStyle) &&
    Array.isArray(render.captions) &&
    render.captions.every(isThumbnailCaption) &&
    Array.isArray(render.frames) &&
    render.frames.length === THUMBNAIL_FRACTIONS.length &&
    render.frames.every(
      (frame) =>
        Number.isFinite(frame?.time) &&
        frame.image instanceof Uint8Array &&
        frame.image[0] === 0xff &&
        frame.image[1] === 0xd8,
    )
  );
}

/** Where the renderer loads one of a project's thumbnails from. `version` changes with each render, so none is kept too long. */
export function thumbnailUrl(projectId: string, file: string, version: string): string {
  return `${MEDIA_SCHEME}://thumbnail/${encodeURIComponent(projectId)}/${encodeURIComponent(file)}?v=${encodeURIComponent(version)}`;
}

/** The project's fields that never show in its video. */
const UNSEEN_PROJECT_FIELDS = [
  "name",
  "notes",
  "setup",
  "createdAt",
  "updatedAt",
  "annotationTracks",
] as const;
/** The recording's fields that never show in the video. */
const UNSEEN_RECORDING_FIELDS = ["createdAt", "markCount", "pageChanges", "audio"] as const;

/**
 * The project as far as its video shows it. Fields are left out by name, so anything added later counts as visible
 * until it's listed here.
 */
export function seenProject(project: Project): object {
  const seen: Record<string, unknown> = { ...project };
  for (const field of UNSEEN_PROJECT_FIELDS) delete seen[field];
  seen.recordings = project.recordings.map((recording) => {
    const fields: Record<string, unknown> = { ...recording };
    for (const field of UNSEEN_RECORDING_FIELDS) delete fields[field];
    return fields as Partial<Recording>;
  });
  return seen;
}

/**
 * Files in a session folder that change what its recording looks like after it's recorded: the transcript the
 * captions come from, and the background removal settings and masks. The media itself never changes.
 */
export const SEEN_SESSION_FILES = [MANIFEST_FILE, "transcript.json", "background.json"];
