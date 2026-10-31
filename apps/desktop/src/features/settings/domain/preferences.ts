import {
  BACKGROUND_BLUR_RANGE,
  isBackgroundModelId,
  isBackgroundReplacement,
  isHexColor,
  type BackgroundModelId,
  type BackgroundReplacement,
} from "#features/background-removal/contracts/backgroundRemoval";
import {
  isNoiseEngineId,
  type NoiseEngineId,
} from "#features/audio-processing/contracts/noiseReduction";
import { isShortcutOverrides, knownOverrides, type ShortcutOverrides } from "./shortcuts.ts";
import {
  isLocaleTag,
  isTranscriptionModelId,
  type TranscriptionModelId,
} from "#features/transcription/domain/transcription";

/** How the user likes to record, the same for every project. Kept by the main process; edited in Settings. */
export interface Preferences {
  /** Whether screen recordings and display previews include the mouse cursor. Independent of Mac UI visibility. */
  showsCursor: boolean;
  /** Whether camera previews are flipped like a mirror. Doesn't change what's recorded. */
  cameraMirrored: boolean;
  /** Whether the recording island shows the camera while it's compact. Opening the island always shows it. */
  islandPreview: boolean;
  /** Seconds counted down before capture starts; 0 starts immediately. */
  countdown: 0 | 3 | 5;
  /** Bundle ids hidden from every recording in every mode, on top of each setup's own `hiddenApps`. */
  hiddenApps: string[];
  /** The model recordings are transcribed with; null until one is chosen. */
  transcriptionModel: TranscriptionModelId | null;
  /** The language Apple Speech transcribes, as a BCP 47 tag; null for the system's. */
  appleSpeechLocale: string | null;
  /** Whether a finished recording with microphone audio is queued for transcription with `transcriptionModel`. */
  autoTranscribe: boolean;
  /** The model backgrounds are removed with; null until one is chosen. */
  backgroundModel: BackgroundModelId | null;
  /** Whether a finished recording with a camera has its background removed with `backgroundModel`. */
  autoRemoveBackground: boolean;
  /** What replaces a removed background. */
  backgroundReplacement: BackgroundReplacement;
  /** How far a blurred background is blurred, from `BACKGROUND_BLUR_RANGE`. */
  backgroundBlur: number;
  /** The `#rrggbb` color that replaces a removed background when `backgroundReplacement` is "color". */
  backgroundColor: string;
  /** The engine new noise reduction uses; null to use whichever can run, Apple's first. */
  noiseEngine: NoiseEngineId | null;
  /** Keyboard shortcuts changed from their defaults. */
  shortcuts: ShortcutOverrides;
}

const KEYS = [
  "showsCursor",
  "cameraMirrored",
  "islandPreview",
  "countdown",
  "hiddenApps",
  "transcriptionModel",
  "appleSpeechLocale",
  "autoTranscribe",
  "backgroundModel",
  "autoRemoveBackground",
  "backgroundReplacement",
  "backgroundBlur",
  "backgroundColor",
  "noiseEngine",
  "shortcuts",
] as const satisfies readonly (keyof Preferences)[];
/** The preferences recording setups held before they were preferences. */
const SETUP_KEYS = [
  "showsCursor",
  "cameraMirrored",
  "islandPreview",
  "countdown",
] as const satisfies readonly (keyof Preferences)[];

export function defaultPreferences(): Preferences {
  return {
    showsCursor: true,
    cameraMirrored: true,
    islandPreview: true,
    countdown: 3,
    hiddenApps: [],
    transcriptionModel: null,
    appleSpeechLocale: null,
    autoTranscribe: false,
    backgroundModel: null,
    autoRemoveBackground: false,
    backgroundReplacement: "blur",
    backgroundBlur: 40,
    backgroundColor: "#00b140",
    noiseEngine: null,
    shortcuts: {},
  };
}

export function isPreferences(value: unknown): value is Preferences {
  if (!value || typeof value !== "object") return false;
  const p = value as Preferences;
  return (
    typeof p.showsCursor === "boolean" &&
    typeof p.cameraMirrored === "boolean" &&
    typeof p.islandPreview === "boolean" &&
    [0, 3, 5].includes(p.countdown) &&
    Array.isArray(p.hiddenApps) &&
    p.hiddenApps.every((id) => typeof id === "string") &&
    (p.transcriptionModel === null || isTranscriptionModelId(p.transcriptionModel)) &&
    (p.appleSpeechLocale === null || isLocaleTag(p.appleSpeechLocale)) &&
    typeof p.autoTranscribe === "boolean" &&
    (p.backgroundModel === null || isBackgroundModelId(p.backgroundModel)) &&
    typeof p.autoRemoveBackground === "boolean" &&
    isBackgroundReplacement(p.backgroundReplacement) &&
    isHexColor(p.backgroundColor, true) &&
    Number.isInteger(p.backgroundBlur) &&
    p.backgroundBlur >= BACKGROUND_BLUR_RANGE.min &&
    p.backgroundBlur <= BACKGROUND_BLUR_RANGE.max &&
    (p.noiseEngine === null || isNoiseEngineId(p.noiseEngine)) &&
    isShortcutOverrides(p.shortcuts)
  );
}

/** `base` with the patch's known fields, or null if the result isn't valid. */
export function patchPreferences(base: Preferences, patch: unknown): Preferences | null {
  if (!patch || typeof patch !== "object") return null;
  const next = { ...base };
  for (const key of KEYS)
    if (Object.hasOwn(patch, key))
      Object.assign(next, { [key]: (patch as Partial<Preferences>)[key] });
  next.shortcuts = knownOverrides(next.shortcuts) as ShortcutOverrides;
  return isPreferences(next) ? next : null;
}

/** Preferences for a first launch after they moved out of recording setups: the quick-start defaults' choices. */
export function preferencesFrom(defaults: unknown): Preferences {
  const preferences = defaultPreferences();
  const stored = (defaults && typeof defaults === "object" ? defaults : {}) as Partial<
    Record<keyof Preferences, unknown>
  >;
  if (typeof stored.showsCursor === "boolean") preferences.showsCursor = stored.showsCursor;
  if (typeof stored.cameraMirrored === "boolean")
    preferences.cameraMirrored = stored.cameraMirrored;
  if (typeof stored.islandPreview === "boolean") preferences.islandPreview = stored.islandPreview;
  if (stored.countdown === 0 || stored.countdown === 3 || stored.countdown === 5)
    preferences.countdown = stored.countdown;
  return preferences;
}

/** A setup saved while some preferences were part of it, without them. */
export function withoutPreferences<T extends object>(
  stored: T,
): Omit<T, (typeof SETUP_KEYS)[number]> {
  const rest = { ...stored } as Record<string, unknown>;
  for (const key of SETUP_KEYS) delete rest[key];
  return rest as Omit<T, (typeof SETUP_KEYS)[number]>;
}

export { excludedApps } from "@teamblocks.dev/chord-ui/model/setup";
