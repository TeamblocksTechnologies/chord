import type { CameraFormat, CameraSource } from "./sources.ts";

/**
 * One choice for every video source. Each preset resolves to concrete settings per device, from what the device
 * reports it can do; a device given its own settings stops following it. Audio is always lossless, so it has none.
 */
export type QualityPreset = "standard" | "high" | "max";

export interface ScreenQuality {
  fps: 30 | 60;
  /** Multiplier on native resolution. */
  scale: 1 | 0.5;
  /** Display mode only; other modes record SDR. */
  hdr: boolean;
}

export interface CameraQuality {
  /** One of the camera's `formats`. */
  width: number;
  height: number;
  fps: number;
}

export const QUALITY_PRESETS: { value: QualityPreset; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

export function presetLabel(preset: QualityPreset): string {
  return QUALITY_PRESETS.find((p) => p.value === preset)!.label;
}

const SCREEN_PRESETS: Record<QualityPreset, ScreenQuality> = {
  standard: { fps: 30, scale: 0.5, hdr: false },
  high: { fps: 30, scale: 1, hdr: false },
  max: { fps: 60, scale: 1, hdr: false },
};

/** The tallest short side each preset picks, and the frame rate it aims for. */
const CAMERA_PRESETS: Record<QualityPreset, { maxShortSide: number; fps: number }> = {
  standard: { maxShortSide: 720, fps: 30 },
  high: { maxShortSide: 1080, fps: 30 },
  max: { maxShortSide: Infinity, fps: 60 },
};

export function screenPreset(preset: QualityPreset): ScreenQuality {
  return { ...SCREEN_PRESETS[preset] };
}

/** The screen's own settings, or its preset's. */
export function resolveScreen(preset: QualityPreset, custom: ScreenQuality | null): ScreenQuality {
  return custom ?? screenPreset(preset);
}

/** Frame rates offered for a size: the usual ones it supports, or its only rate when slower than all of them. */
export function frameRates(format: CameraFormat): number[] {
  const rates = [24, 30, 60].filter((fps) => fps <= format.maxFps);
  return rates.length > 0 ? rates : [format.maxFps];
}

export type Orientation = "landscape" | "portrait" | "square";

export const ORIENTATIONS: { value: Orientation; label: string }[] = [
  { value: "landscape", label: "Landscape" },
  { value: "portrait", label: "Portrait" },
  { value: "square", label: "Square" },
];

export function orientation({ width, height }: { width: number; height: number }): Orientation {
  return width > height ? "landscape" : width < height ? "portrait" : "square";
}

/** The orientations a camera lists sizes in, landscape first. Cameras with Center Stage add portrait and square. */
export function cameraOrientations(camera: CameraSource): Orientation[] {
  return ORIENTATIONS.map((o) => o.value).filter((o) =>
    camera.formats.some((f) => orientation(f) === o),
  );
}

/** A camera's sizes in one orientation, most pixels first. */
export function formatsIn(camera: CameraSource, wanted: Orientation): CameraFormat[] {
  return camera.formats
    .filter((f) => orientation(f) === wanted)
    .sort((a, b) => b.width * b.height - a.width * a.height || b.maxFps - a.maxFps);
}

/** The size to switch to in another orientation: the same short side if listed, otherwise the largest. */
export function formatFor(
  camera: CameraSource,
  current: CameraQuality,
  wanted: Orientation,
): CameraFormat | undefined {
  const sizes = formatsIn(camera, wanted);
  const side = Math.min(current.width, current.height);
  return sizes.find((f) => Math.min(f.width, f.height) === side) ?? sizes[0];
}

/** The sizes presets choose from: landscape ones, or every size when there are none. */
function presetFormats(camera: CameraSource): CameraFormat[] {
  const landscape = formatsIn(camera, "landscape");
  return landscape.length > 0 ? landscape : camera.formats;
}

/**
 * The format a preset picks: the largest landscape size within its cap, at its frame rate where the size allows.
 * Undefined for a camera that lists no formats, which then records at its own choice.
 */
export function cameraPreset(
  camera: CameraSource,
  preset: QualityPreset,
): CameraQuality | undefined {
  const { maxShortSide, fps } = CAMERA_PRESETS[preset];
  const pool = presetFormats(camera);
  const fits = pool.filter((f) => Math.min(f.width, f.height) <= maxShortSide);
  // Nothing small enough: the smallest there is.
  const candidates = fits.length > 0 ? fits : pool.slice(-1);
  const format = candidates.reduce<CameraFormat | undefined>((best, f) => {
    if (!best) return f;
    const area = f.width * f.height - best.width * best.height;
    return area > 0 || (area === 0 && f.maxFps > best.maxFps) ? f : best;
  }, undefined);
  if (!format) return;
  const rates = frameRates(format);
  return {
    width: format.width,
    height: format.height,
    fps: rates.filter((r) => r <= fps).at(-1) ?? rates[0],
  };
}

/** A camera's own settings while it still lists that size, otherwise its preset's. */
export function resolveCamera(
  camera: CameraSource,
  preset: QualityPreset,
  custom: CameraQuality | undefined,
): CameraQuality | undefined {
  const format =
    custom && camera.formats.find((f) => f.width === custom.width && f.height === custom.height);
  if (custom && format) return { ...custom, fps: Math.min(custom.fps, format.maxFps) };
  return cameraPreset(camera, preset);
}

/** "1920×1080", in either orientation. */
export function formatSize({ width, height }: { width: number; height: number }): string {
  return `${width}×${height}`;
}

/** The usual name for sizes with one, by their short side: "4K", "1080p", "720p". */
export function sizeName({ width, height }: { width: number; height: number }): string | undefined {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short === 2160 && long === 3840) return "4K";
  const standard: Record<number, number[]> = {
    1440: [2560],
    1080: [1920],
    720: [1280],
    480: [640, 854],
    360: [480, 640],
  };
  return standard[short]?.includes(long) ? `${short}p` : undefined;
}

export function isScreenQuality(value: unknown): value is ScreenQuality {
  if (!value || typeof value !== "object") return false;
  const q = value as ScreenQuality;
  return [30, 60].includes(q.fps) && [1, 0.5].includes(q.scale) && typeof q.hdr === "boolean";
}

export function isCameraQuality(value: unknown): value is CameraQuality {
  if (!value || typeof value !== "object") return false;
  const q = value as CameraQuality;
  return [q.width, q.height, q.fps].every((n) => Number.isInteger(n) && n > 0);
}
