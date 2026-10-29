import type { ScreenPreview } from "@teamblocks.dev/chord-recorder-protocol";
import { PermissionError, ensurePermission, helper, onHelper } from "#platform/renderer/helper";

type Watcher = {
  request: ScreenPreview;
  onFrame: (image: Uint8Array) => void;
  onError: (error: unknown) => void;
};

/** Display thumbnails captured with the same app filters and background as a recording. */
class ScreenPreviews {
  #watchers = new Map<string, Watcher>();
  #queue = Promise.resolve();

  constructor() {
    window.chord.onPreviewFrame((id, image) => this.#watchers.get(id)?.onFrame(image));
    onHelper("ready", () => this.#sync());
    // Release any previews left behind by a renderer reload.
    this.#sync();
  }

  /** Runs this preview until cleanup, with an id that also keeps late frames out of a replacement preview. */
  watch(
    request: Omit<ScreenPreview, "id">,
    onFrame: Watcher["onFrame"],
    onError: Watcher["onError"],
  ): () => void {
    const id = crypto.randomUUID();
    this.#watchers.set(id, { request: { ...request, id }, onFrame, onError });
    this.#sync();
    return () => {
      this.#watchers.delete(id);
      this.#sync();
    };
  }

  #sync(): void {
    this.#queue = this.#queue
      .then(() => this.#send())
      .catch((error: unknown) => console.error(error));
  }

  async #send(): Promise<void> {
    let watchers = [...this.#watchers.values()];
    try {
      if (watchers.length > 0 && !(await ensurePermission("screen"))) {
        for (const watcher of watchers) {
          if (this.#watchers.has(watcher.request.id))
            watcher.onError(new PermissionError("screen"));
        }
        watchers = [];
      }
      // Permission checks may finish after a component unmounts.
      const previews = watchers
        .filter((w) => this.#watchers.has(w.request.id))
        .map((w) => w.request);
      const { failures } = await helper.request("setScreenPreview", { previews });
      for (const failure of failures)
        this.#watchers.get(failure.id)?.onError(new Error(failure.message));
    } catch (error) {
      for (const watcher of watchers) {
        if (this.#watchers.has(watcher.request.id)) watcher.onError(error);
      }
      throw error;
    }
  }
}

export const screenPreviews = new ScreenPreviews();
