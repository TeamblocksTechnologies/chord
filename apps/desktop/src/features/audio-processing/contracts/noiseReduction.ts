/** The engines that can reduce noise in recorded audio on this computer, and the jobs that run them. */

/** An engine that downloads: where its files come from, and what to expect of them. */
export interface NoiseDownload {
  url: string;
  size: number;
  sha256: string;
  /** The files kept from the downloaded archive. */
  files: readonly { name: string; size: number; sha256: string }[];
}

/** DeepFilterNet3's release archive of its three networks, at the revision of the upstream repository it was checked against. */
export const DEEP_FILTER_DOWNLOAD: NoiseDownload = {
  url: "https://raw.githubusercontent.com/Rikorose/DeepFilterNet/d375b2d8309e0935d165700c91da9de862a99c31/models/DeepFilterNet3_onnx.tar.gz",
  size: 7_983_136,
  sha256: "c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616",
  files: [
    {
      name: "enc.onnx",
      size: 1_954_042,
      sha256: "7c5399d3da8a50ebef1c1a0ae421b33376aa5e45d0e92df16da7e83c9c131916",
    },
    {
      name: "erb_dec.onnx",
      size: 3_292_397,
      sha256: "ab669a1d10afe20911728b33053a452071042317a90581092b325da7b2f9d895",
    },
    {
      name: "df_dec.onnx",
      size: 3_340_803,
      sha256: "23114ce3b0f6464b763ee62f7bb8aab6b2a129a21eabd5bcfe59413db05f278a",
    },
  ],
};

/** Apple's engine is part of macOS; DeepFilterNet3 downloads once and then runs wherever Chord does. */
export const NOISE_ENGINES = [
  { id: "apple", name: "Apple Sound Isolation", detail: "Built in", license: null },
  {
    id: "deepfilternet3",
    name: "DeepFilterNet3",
    detail: "Downloads once",
    license: "MIT or Apache-2.0",
  },
] as const;

export type NoiseEngineId = (typeof NOISE_ENGINES)[number]["id"];

export type NoiseEngineStatus =
  /** Can't run here; `reason` says why, e.g. the macOS version. */
  | { state: "unavailable"; reason: string }
  | { state: "notDownloaded" }
  /** `progress` is 0 to 1. */
  | { state: "downloading"; progress: number }
  | { state: "ready" };

export interface NoiseEngineState {
  id: NoiseEngineId;
  status: NoiseEngineStatus;
  /** Why the last download failed, until the next one starts. */
  error?: string;
}

export function isNoiseEngineId(value: unknown): value is NoiseEngineId {
  return NOISE_ENGINES.some((engine) => engine.id === value);
}

/**
 * The engine new work uses: the one chosen if it can run, otherwise the first that can, with Apple's before the
 * download. Null when none can.
 */
export function resolveNoiseEngine(
  chosen: NoiseEngineId | null,
  states: readonly NoiseEngineState[],
): NoiseEngineId | null {
  const ready = (id: NoiseEngineId) =>
    states.find((state) => state.id === id)?.status.state === "ready";
  if (chosen && ready(chosen)) return chosen;
  return NOISE_ENGINES.find((engine) => ready(engine.id))?.id ?? null;
}

/** How much noise DeepFilterNet3 leaves in: the most it lets the noise drop, in dB. Apple's engine has no such limit. */
export const NOISE_STRENGTH = { deepFilterAttenuationDb: 24 } as const;

/** What reducing a track's noise made: for each recorded file of the track, its cleaned copy in the session folder. */
export interface NoiseTrackResult {
  /** Names this result, so a copy made again isn't mistaken for the one before it. */
  id: string;
  engine: NoiseEngineId;
  /** A recorded file of the track, as the manifest names it, to the cleaned file made from it. */
  files: Record<string, string>;
}

/** Everything saved in a recording's `noise.json`: one result for each track that has been cleaned. */
export interface NoiseResult {
  version: 1;
  /** By track, as `audioTrackKey` names it. */
  tracks: Record<string, NoiseTrackResult>;
}

export interface NoiseTrackState {
  phase: "idle" | "queued" | "processing" | "done" | "failed";
  /** 0 to 1 while processing. */
  progress?: number;
  error?: string;
  result?: NoiseTrackResult;
}

/** A recording's tracks, by `audioTrackKey`. A track absent here has not been cleaned. */
export interface NoiseState {
  directory: string;
  tracks: Record<string, NoiseTrackState>;
}

/** Whether `value` is a saved result; with `files`, the recorded files of the recording, also that it only names those. */
export function isNoiseResult(
  value: unknown,
  files: ReadonlySet<string> | null = null,
): value is NoiseResult {
  if (!value || typeof value !== "object") return false;
  const { version, tracks } = value as NoiseResult;
  if (version !== 1 || !tracks || typeof tracks !== "object") return false;
  return Object.entries(tracks).every(
    ([key, track]) =>
      /^(microphone|systemAudio):\d+$/.test(key) &&
      track &&
      typeof track.id === "string" &&
      /^[\w-]+$/.test(track.id) &&
      isNoiseEngineId(track.engine) &&
      track.files &&
      typeof track.files === "object" &&
      Object.keys(track.files).length > 0 &&
      Object.entries(track.files).every(
        ([source, cleaned]) =>
          (files?.has(source) ?? true) &&
          typeof cleaned === "string" &&
          /^noise\/[\w-]+\/\d+\.wav$/.test(cleaned),
      ),
  );
}
