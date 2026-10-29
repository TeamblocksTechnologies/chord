/** The background removal models Chord can run on this computer, and how a removed background is replaced. */
export const BACKGROUND_MODELS = [
  {
    id: "modnet",
    name: "MODNet",
    subject: "People",
    license: "Apache-2.0",
    // ONNX weights, pinned to a revision so the checksum holds.
    url: "https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model.onnx",
    size: 25_888_640,
    sha256: "07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9",
  },
  {
    id: "ben2",
    name: "BEN2 Base",
    subject: "Anything in front",
    license: "MIT",
    url: "https://huggingface.co/onnx-community/BEN2-ONNX/resolve/c552aa82688edce09f0ac9d2e31ad53d9d629010/onnx/model_fp16.onnx",
    size: 219_121_675,
    sha256: "dfdc25f421f32a0d1268e0f2ff2153d340e8f1d52d3dd16f5dc33c1ce85cedf1",
  },
] as const satisfies readonly BackgroundModel[];

export type BackgroundModelId = (typeof BACKGROUND_MODELS)[number]["id"];

export interface BackgroundModel {
  id: string;
  name: string;
  /** What it keeps in the picture. */
  subject: string;
  license: string;
  /** Where the weights download from. */
  url: string;
  /** Download size in bytes. */
  size: number;
  sha256: string;
}

export type BackgroundModelStatus =
  | { state: "notDownloaded" }
  /** `progress` is 0 to 1. */
  | { state: "downloading"; progress: number }
  | { state: "downloaded" };

export interface BackgroundModelState {
  id: BackgroundModelId;
  status: BackgroundModelStatus;
  /** Why the last download failed, until the next one starts. */
  error?: string;
}

/** What replaces the background of a recording. */
export type BackgroundReplacement = "blur" | "color";

/** The blur radius range, in pixels at 1080p. */
export const BACKGROUND_BLUR_RANGE = { min: 0, max: 100 } as const;

export function isBackgroundModelId(value: unknown): value is BackgroundModelId {
  return BACKGROUND_MODELS.some((model) => model.id === value);
}

export function isBackgroundReplacement(value: unknown): value is BackgroundReplacement {
  return value === "blur" || value === "color";
}

/** Whether `value` is #rrggbb, optionally allowing #rrggbbaa for transparent backgrounds. */
export function isHexColor(value: unknown, alpha = false): value is string {
  return (
    typeof value === "string" &&
    (alpha ? /^#[0-9a-f]{6}([0-9a-f]{2})?$/i : /^#[0-9a-f]{6}$/i).test(value)
  );
}

/** Per-take settings. Once masks are ready these change without repeating inference. */
export interface CameraBackground {
  enabled: boolean;
  replacement: BackgroundReplacement;
  blur: number;
  /** CSS #rrggbb or #rrggbbaa; alpha affects the replacement background, not the subject. */
  color: string;
}

export interface BackgroundResult {
  version: 1;
  model: BackgroundModelId;
  /** Original camera segment file -> mask video relative to its session folder, on the same file clock. */
  masks: Record<string, string>;
  settings: CameraBackground;
}

export interface BackgroundState {
  directory: string;
  phase: "idle" | "queued" | "processing" | "done" | "failed";
  progress?: number;
  error?: string;
  result?: BackgroundResult;
}

export function isCameraBackground(value: unknown): value is CameraBackground {
  if (!value || typeof value !== "object") return false;
  const settings = value as CameraBackground;
  return (
    typeof settings.enabled === "boolean" &&
    isBackgroundReplacement(settings.replacement) &&
    isHexColor(settings.color, true) &&
    Number.isInteger(settings.blur) &&
    settings.blur >= BACKGROUND_BLUR_RANGE.min &&
    settings.blur <= BACKGROUND_BLUR_RANGE.max
  );
}
