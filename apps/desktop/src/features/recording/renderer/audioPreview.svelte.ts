import type { AudioSource } from "@teamblocks.dev/chord-recorder-protocol";
import { PERMISSION_HINTS, ensurePermission, helper, onHelper } from "#platform/renderer/helper";

/** Below this, a meter reads empty. */
const FLOOR_DB = -60;

export function audioSourceKey(source: AudioSource): string {
  return source.kind === "microphone" ? `microphone:${source.deviceId}` : "systemAudio";
}

/**
 * Live levels for the audio sources currently on screen, metered by the helper so they match what it records.
 * Meters `watch` their source while mounted; the union is sent as one `setAudioPreview`.
 */
class AudioPreview {
  /** 0...1 by source key. Missing means silent or not started. */
  levels = $state<Record<string, number>>({});
  /** Why a watched source isn't being metered, by source key. */
  failures = $state<Record<string, string>>({});

  #watchers = new Map<string, { source: AudioSource; count: number }>();
  #queue = Promise.resolve();

  constructor() {
    onHelper("previewLevels", ({ levels }) => {
      this.levels = Object.fromEntries(
        levels.map((l) => [
          audioSourceKey(l.source),
          Math.min(1, Math.max(0, 1 - l.averageDb / FLOOR_DB)),
        ]),
      );
    });
    // A restarted helper has forgotten the preview.
    onHelper("ready", () => this.#sync());
    // Clears any preview a previous page load left running.
    this.#sync();
  }

  /** Meters `source` until the returned function is called. */
  watch(source: AudioSource): () => void {
    const key = audioSourceKey(source);
    const watcher = this.#watchers.get(key) ?? { source, count: 0 };
    watcher.count++;
    this.#watchers.set(key, watcher);
    this.#sync();
    return () => {
      if (--watcher.count === 0) this.#watchers.delete(key);
      this.#sync();
    };
  }

  /** Sends the current set, one request at a time so a slow start can't overwrite a newer set. */
  #sync(): void {
    this.#queue = this.#queue
      .then(() => this.#send())
      .catch((error: unknown) => console.error(error));
  }

  async #send(): Promise<void> {
    const failures: Record<string, string> = {};
    const allowed: AudioSource[] = [];
    for (const [key, { source }] of this.#watchers) {
      const permission = source.kind === "microphone" ? "microphone" : "screen";
      if (await ensurePermission(permission)) allowed.push(source);
      else failures[key] = PERMISSION_HINTS[permission];
    }
    try {
      const reply = await helper.request("setAudioPreview", { sources: allowed });
      for (const failure of reply.failures)
        failures[audioSourceKey(failure.source)] = failure.message;
    } catch (error) {
      for (const key of this.#watchers.keys()) failures[key] = "Recorder helper isn't running";
      throw error;
    } finally {
      this.failures = failures;
    }
  }
}

export const audioPreview = new AudioPreview();
