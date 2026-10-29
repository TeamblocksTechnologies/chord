/** Audio levels saved per source track, shared by preview and export. */
export interface AudioTrackSettings {
  volume: number;
  muted: boolean;
  /** Leveling is on: the track plays at `levelGain` on top of its volume. */
  leveled?: boolean;
  /** The gain that levels the take, once measured. Kept while leveling is off, so turning it back on is instant. */
  levelGain?: number;
  /** Noise reduction is on: the track plays from its cleaned copy. */
  denoised?: boolean;
  /** The gain that levels the cleaned copy, which isn't the original's. */
  denoisedLevelGain?: number;
  /** The cleaned copy `denoisedLevelGain` was measured on; a copy made again may need measuring again. */
  denoisedLevelFor?: string;
}

export type AudioSettings = Record<string, AudioTrackSettings>;

export function audioTrackKey(kind: string, index = 0): string {
  return `${kind}:${index}`;
}

export function audioTrackSettings(
  settings: AudioSettings | undefined,
  kind: string,
  index = 0,
): Required<Pick<AudioTrackSettings, "volume" | "muted" | "leveled" | "denoised">> &
  Pick<AudioTrackSettings, "levelGain" | "denoisedLevelGain" | "denoisedLevelFor"> {
  const stored = settings?.[audioTrackKey(kind, index)];
  const denoised = stored?.denoised === true;
  return {
    volume: Number.isFinite(stored?.volume) ? Math.min(Math.max(stored!.volume, 0), 1) : 1,
    muted: stored?.muted === true,
    // Leveling needs the gain for the audio that plays: the cleaned copy's when noise reduction is on.
    leveled:
      stored?.leveled === true && validGain(denoised ? stored.denoisedLevelGain : stored.levelGain),
    denoised,
    ...(validGain(stored?.levelGain) && { levelGain: stored!.levelGain }),
    ...(validGain(stored?.denoisedLevelGain) && { denoisedLevelGain: stored!.denoisedLevelGain }),
    ...(typeof stored?.denoisedLevelFor === "string" && {
      denoisedLevelFor: stored.denoisedLevelFor,
    }),
  };
}

/**
 * `settings` with `patch` applied to a track's stored settings. Settings kept for a feature that isn't on, such as a
 * leveling the gain for which hasn't been measured yet, are kept as they are.
 */
export function withAudioSettings(
  settings: AudioSettings | undefined,
  kind: string,
  index: number,
  patch: Partial<AudioTrackSettings>,
): AudioSettings {
  const { volume, muted } = audioTrackSettings(settings, kind, index);
  const key = audioTrackKey(kind, index);
  return { ...settings, [key]: { ...settings?.[key], volume, muted, ...patch } };
}

function validGain(gain: number | undefined): boolean {
  return Number.isFinite(gain) && gain! > 0;
}

export function audioLevel(settings: AudioSettings | undefined, kind: string, index = 0): number {
  const track = audioTrackSettings(settings, kind, index);
  return track.muted ? 0 : track.volume;
}

/** The gain that levels a track, 1 when it isn't leveled. */
export function audioGain(settings: AudioSettings | undefined, kind: string, index = 0): number {
  const track = audioTrackSettings(settings, kind, index);
  return track.leveled ? (track.denoised ? track.denoisedLevelGain! : track.levelGain!) : 1;
}

/** Whether a track plays from its cleaned copy. */
export function audioDenoised(
  settings: AudioSettings | undefined,
  kind: string,
  index = 0,
): boolean {
  return audioTrackSettings(settings, kind, index).denoised;
}

export type AudioLevels = (recordingId: string, kind: string, index: number) => number;

/** Leveling gains, which can raise a track past what a volume from 0 to 1 reaches. */
export type AudioGains = AudioLevels;

/** The URL a track's audio file plays from: `url` itself, or the cleaned copy made from it. */
export type AudioSources = (
  recordingId: string,
  kind: string,
  index: number,
  url: string,
) => string;
