/** What a project can be exported as: the video's shape, size, frame rate and file type. */

export type ExportAspect = "original" | "16:9" | "4:3" | "1:1" | "4:5" | "9:16";

export const EXPORT_ASPECTS: { value: ExportAspect; label: string; aspect?: number }[] = [
  { value: "original", label: "Original" },
  { value: "16:9", label: "16:9", aspect: 16 / 9 },
  { value: "4:3", label: "4:3", aspect: 4 / 3 },
  { value: "1:1", label: "1:1", aspect: 1 },
  { value: "4:5", label: "4:5", aspect: 4 / 5 },
  { value: "9:16", label: "9:16", aspect: 9 / 16 },
];

/** The video's short side, in pixels. */
export type ExportResolution = 720 | 1080 | 1440 | 2160;

export const EXPORT_RESOLUTIONS: { value: ExportResolution; label: string }[] = [
  { value: 720, label: "720p" },
  { value: 1080, label: "1080p" },
  { value: 1440, label: "1440p" },
  { value: 2160, label: "4K" },
];

export type ExportFrameRate = 24 | 30 | 60;

export const EXPORT_FRAME_RATES: { value: ExportFrameRate; label: string }[] = [
  { value: 24, label: "24" },
  { value: 30, label: "30" },
  { value: 60, label: "60" },
];

export type VideoFormat = "mp4-h264" | "mp4-hevc" | "webm-vp9";

export type ExportFormat = VideoFormat | "gif";

/** Each video file type's container, its video and audio codecs, and whether it can keep a transparent background. */
export const VIDEO_FORMATS: Record<
  VideoFormat,
  {
    label: string;
    extension: "mp4" | "webm";
    video: "avc" | "hevc" | "vp9";
    audio: "aac" | "opus";
    transparency: boolean;
  }
> = {
  "mp4-h264": {
    label: "MP4 (H.264)",
    extension: "mp4",
    video: "avc",
    audio: "aac",
    transparency: false,
  },
  "mp4-hevc": {
    label: "MP4 (HEVC)",
    extension: "mp4",
    video: "hevc",
    audio: "aac",
    transparency: false,
  },
  "webm-vp9": {
    label: "WebM (VP9)",
    extension: "webm",
    video: "vp9",
    audio: "opus",
    transparency: true,
  },
};

export const FILE_TYPES: { value: ExportFormat; label: string }[] = [
  ...(Object.keys(VIDEO_FORMATS) as VideoFormat[]).map((value) => ({
    value,
    label: VIDEO_FORMATS[value].label,
  })),
  { value: "gif", label: "GIF" },
];

export function isVideoFormat(format: ExportFormat): format is VideoFormat {
  return format !== "gif";
}

/** A GIF's width, in pixels. */
export type GifWidth = 480 | 640 | 800 | 1080;

export const GIF_WIDTHS: { value: GifWidth; label: string }[] = [
  { value: 480, label: "480" },
  { value: 640, label: "640" },
  { value: 800, label: "800" },
  { value: 1080, label: "1080" },
];

export type GifFrameRate = 10 | 15 | 24;

export const GIF_FRAME_RATES: { value: GifFrameRate; label: string }[] = [
  { value: 10, label: "10" },
  { value: 15, label: "15" },
  { value: 24, label: "24" },
];

/** The longest a GIF can be, in seconds: every frame is a full picture, so files grow quickly. */
export const GIF_LONGEST = 30;

/** A stretch of the project to export, in project seconds. */
export interface ExportRange {
  start: number;
  end: number;
}

export interface ExportSettings {
  aspect: ExportAspect;
  resolution: ExportResolution;
  frameRate: ExportFrameRate;
  format: ExportFormat;
  /** Leaves the backdrop out, where the file type can keep transparency. */
  transparent: boolean;
  /** Burn the corrected transcript into the video. Subtitle files are saved with videos either way. */
  captions?: boolean;
  gifWidth: GifWidth;
  gifFrameRate: GifFrameRate;
  /** Whether a GIF plays over and over, rather than once. */
  loop: boolean;
}

export function defaultExportSettings(): ExportSettings {
  return {
    aspect: "original",
    resolution: 1080,
    frameRate: 30,
    format: "mp4-h264",
    transparent: false,
    captions: false,
    gifWidth: 640,
    gifFrameRate: 15,
    loop: true,
  };
}

/** The video's width / height: the chosen shape, or `original`, the stage's own. */
export function aspectOf(choice: ExportAspect, original: number): number {
  return EXPORT_ASPECTS.find((option) => option.value === choice)?.aspect ?? original;
}

/** The video's size in pixels: `resolution` on its short side, both sides even, as encoders need. */
export function exportSize(
  aspect: number,
  resolution: ExportResolution,
): { width: number; height: number } {
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return aspect >= 1
    ? { width: even(resolution * aspect), height: resolution }
    : { width: resolution, height: even(resolution / aspect) };
}

/** A GIF's size in pixels: `width` across, and as tall as the shape makes it. */
export function gifSize(aspect: number, width: GifWidth): { width: number; height: number } {
  return { width, height: Math.max(1, Math.round(width / aspect)) };
}

/** Whether the export will be transparent: asked for, and kept by the file type. GIFs are always opaque. */
export function isTransparent(settings: ExportSettings): boolean {
  return (
    settings.transparent &&
    isVideoFormat(settings.format) &&
    VIDEO_FORMATS[settings.format].transparency
  );
}

/** `range` within a project `duration` long, or the whole project without one. */
export function rangeWithin(range: ExportRange | null | undefined, duration: number): ExportRange {
  if (!range) return { start: 0, end: duration };
  const start = Math.min(Math.max(range.start, 0), duration);
  return { start, end: Math.min(Math.max(range.end, start), duration) };
}

/** How many frames `seconds` takes at `frameRate`; at least one. */
export function frameCount(seconds: number, frameRate: number): number {
  return Math.max(1, Math.round(seconds * frameRate));
}

/**
 * How long each of a GIF's frames shows, in hundredths of a second, the unit GIFs keep time in. Rounding each frame's
 * end rather than its length keeps the frames on time: 15 fps shows for 7, 6, 7, 7, 6, 7 and so on.
 */
export function gifDelay(frame: number, frameRate: number): number {
  return Math.round(((frame + 1) * 100) / frameRate) - Math.round((frame * 100) / frameRate);
}
