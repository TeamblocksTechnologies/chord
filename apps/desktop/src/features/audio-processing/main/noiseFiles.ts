import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isNoiseResult, type NoiseResult } from "../contracts/noiseReduction.ts";

export const NOISE_FILE = "noise.json";

const cache = new Map<string, { signature: string; result: NoiseResult | null }>();

/** The cleaned copies a recording's session folder holds, or null when it has none or the file is unreadable. */
export function readNoise(folder: string): NoiseResult | null {
  const path = join(folder, NOISE_FILE);
  let signature: string;
  try {
    const { mtimeMs, size } = statSync(path);
    signature = `${mtimeMs}:${size}`;
  } catch {
    cache.delete(folder);
    return null;
  }
  const cached = cache.get(folder);
  if (cached?.signature === signature) return cached.result;
  let result: NoiseResult | null = null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (isNoiseResult(parsed)) result = parsed;
  } catch {
    /* Damaged: as if there were no cleaned copies. */
  }
  cache.set(folder, { signature, result });
  return result;
}

export function writeNoise(folder: string, result: NoiseResult): void {
  const path = join(folder, NOISE_FILE);
  writeFileSync(`${path}.tmp`, JSON.stringify(result));
  renameSync(`${path}.tmp`, path);
  cache.delete(folder);
}

/** The cleaned copy of the recorded file `file` (as the manifest names it), if there is one on disk. */
export function cleanedFile(folder: string, file: string): string | undefined {
  const result = readNoise(folder);
  if (!result) return undefined;
  for (const track of Object.values(result.tracks)) {
    const cleaned = track.files[file];
    if (cleaned && existsSync(join(folder, cleaned))) return join(folder, cleaned);
  }
  return undefined;
}
