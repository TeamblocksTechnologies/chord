import type { PreviewWindow } from "@teamblocks.dev/chord-recorder-protocol";
import { helper, onHelper } from "#platform/renderer/helper";

/**
 * The window a focused-window recording would follow if it started now, as the helper picks it. One watcher at a
 * time: the open source panel.
 */
class FollowedWindow {
  window = $state<PreviewWindow | null>(null);
  /** False until the helper first answers for the current watch. */
  loaded = $state(false);

  #config: { bundleIds?: string[]; excludedBundleIds: string[]; pinnedWindowIds: number[] } | null =
    null;
  #queue = Promise.resolve();

  constructor() {
    onHelper("previewWindow", ({ window }) => {
      if (this.#config) this.window = window;
    });
    // A restarted helper has forgotten the watch.
    onHelper("ready", () => this.#sync());
  }

  /** `allowedApps` empty allows every app; pinned windows are never followed. Watches until the returned function is called. */
  watch(allowedApps: string[], hiddenApps: string[], pinnedWindowIds: number[] = []): () => void {
    const config = {
      ...(allowedApps.length > 0 && { bundleIds: allowedApps }),
      excludedBundleIds: hiddenApps,
      pinnedWindowIds,
    };
    this.#config = config;
    this.loaded = false;
    this.#sync();
    return () => {
      if (this.#config !== config) return;
      this.#config = null;
      this.window = null;
      this.#sync();
    };
  }

  /** One request at a time, so a stale reply can't overwrite a newer watch. */
  #sync(): void {
    this.#queue = this.#queue
      .then(async () => {
        const config = this.#config;
        const reply = await helper.request(
          "setWindowPreview",
          config ? { enabled: true, ...config } : { enabled: false },
        );
        if (config && config === this.#config) {
          this.window = reply.window;
          this.loaded = true;
        }
      })
      .catch((error: unknown) => console.error(error));
  }
}

export const followedWindow = new FollowedWindow();
