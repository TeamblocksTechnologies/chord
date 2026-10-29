import { type ChildProcess, execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Chromium can't decode the recorder's ALAC segments. Keep the originals for editing/export and serve temporary
 * 24-bit PCM WAVs for playback and waveform decoding. afconvert ships with macOS; no external codec is needed.
 */
export class PlaybackAudio {
  #directory = mkdtempSync(join(tmpdir(), "chord-playback-"));
  #files = new Map<string, { modified: number; size: number; file: Promise<string> }>();
  #conversions = new Set<ChildProcess>();
  #nextId = 0;
  #closed = false;

  async file(source: string): Promise<string> {
    if (this.#closed) throw new Error("Audio playback has closed");
    const { mtimeMs, size } = await stat(source);
    if (this.#closed) throw new Error("Audio playback has closed");
    const cached = this.#files.get(source);
    if (cached?.modified === mtimeMs && cached.size === size) return cached.file;

    const output = join(this.#directory, `${this.#nextId++}.wav`);
    const file = this.#convert(source, output)
      .then(() => output)
      .catch((error) => {
        if (this.#files.get(source)?.file === file) this.#files.delete(source);
        rmSync(output, { force: true });
        throw error;
      });
    this.#files.set(source, { modified: mtimeMs, size, file });
    return file;
  }

  dispose(): void {
    this.#closed = true;
    for (const child of this.#conversions) child.kill();
    this.#files.clear();
    rmSync(this.#directory, { recursive: true, force: true });
  }

  #convert(source: string, output: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        "/usr/bin/afconvert",
        ["-f", "WAVE", "-d", "LEI24", source, output],
        (error) => {
          this.#conversions.delete(child);
          if (error) reject(new Error("This recording's audio can't be decoded", { cause: error }));
          else resolve();
        },
      );
      this.#conversions.add(child);
    });
  }
}
