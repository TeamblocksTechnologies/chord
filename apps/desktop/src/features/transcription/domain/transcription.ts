/** The speech-to-text models Chord can run on this computer. */
export const TRANSCRIPTION_MODELS = [
  { id: "parakeet-tdt-0.6b-v3", name: "Parakeet v3", languages: "25 languages", size: 483_000_000 },
  // macOS downloads and keeps this model, for the user's language, so its size isn't known ahead.
  { id: "apple-speech", name: "Apple Speech", languages: null, size: null },
] as const satisfies readonly TranscriptionModel[];

export type TranscriptionModelId = (typeof TRANSCRIPTION_MODELS)[number]["id"];

export interface TranscriptionModel {
  id: string;
  name: string;
  /** The languages it transcribes, or null when it's the user's language (`ModelState.locale`). */
  languages: string | null;
  /** Download size in bytes, or null when the OS decides. */
  size: number | null;
}

export type ModelStatus =
  /** Can't run here, e.g. Apple Speech before macOS 26 or for a language it doesn't have. */
  | { state: "unavailable" }
  | { state: "notDownloaded" }
  /** `progress` is 0 to 1, or null until it's known. */
  | { state: "downloading"; progress: number | null }
  | { state: "downloaded" };

export interface ModelState {
  id: TranscriptionModelId;
  status: ModelStatus;
  /** Why the last download failed, until the next one starts. */
  error?: string;
  /** The language Apple Speech transcribes, as a BCP 47 tag. */
  locale?: string;
  /** The languages Apple Speech can transcribe, and the one closest to the system's language. */
  locales?: { supported: string[]; system: string | null };
}

/** Whether `value` looks like a BCP 47 language tag, such as `en-CA`. */
export function isLocaleTag(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(value);
}

export function isTranscriptionModelId(value: unknown): value is TranscriptionModelId {
  return TRANSCRIPTION_MODELS.some((model) => model.id === value);
}
