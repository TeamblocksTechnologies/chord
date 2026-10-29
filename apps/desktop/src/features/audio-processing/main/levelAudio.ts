import { integratedLoudness, levelGain, LoudnessMeter } from "../domain/loudness.ts";
import { WavReader } from "#shared/main/wavFile";

const FRAMES_PER_READ = 48_000;

/**
 * The gain that levels the audio files `files` as one take, from their original samples; null when they hold nothing
 * to level. `decoded` turns a recorded file into a WAV, and may be the file itself.
 */
export async function measureLevel(
  files: string[],
  decoded: (file: string) => Promise<string>,
): Promise<number | null> {
  const windows: number[] = [];
  let peak = 0;
  for (const file of files) {
    let meter: LoudnessMeter | undefined;
    const reader = await WavReader.open(await decoded(file));
    try {
      for (
        let samples = await reader.read(FRAMES_PER_READ);
        samples;
        samples = await reader.read(FRAMES_PER_READ)
      ) {
        meter ??= new LoudnessMeter(reader.rate, samples.length);
        meter.add(samples);
      }
    } finally {
      await reader.close();
    }
    if (!meter) continue;
    windows.push(...meter.windows());
    peak = Math.max(peak, meter.peak);
  }
  return levelGain(integratedLoudness(windows), peak);
}
