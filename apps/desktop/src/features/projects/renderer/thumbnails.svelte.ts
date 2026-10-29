import type { ThumbnailSet } from "../contracts/thumbnails.ts";

/** Projects' thumbnails, loaded as cards ask for them and again whenever the main process renders them. */
class Thumbnails {
  /** By project id: null when a project has none yet. Absent until loaded. */
  sets = $state.raw<Record<string, ThumbnailSet | null>>({});
  #requested = new Set<string>();

  constructor() {
    window.chord.desktop.thumbnails.onChange((projectId) => {
      if (this.#requested.has(projectId)) void this.#fetch(projectId);
    });
  }

  /** Loads the project's thumbnails, once; later renders arrive by themselves. */
  load(projectId: string): void {
    if (this.#requested.has(projectId)) return;
    this.#requested.add(projectId);
    void this.#fetch(projectId);
  }

  async #fetch(projectId: string): Promise<void> {
    try {
      const set = await window.chord.desktop.thumbnails.get(projectId);
      this.sets = { ...this.sets, [projectId]: set };
    } catch (error) {
      console.warn(`Couldn't load the thumbnails of ${projectId}:`, error);
    }
  }
}

export const thumbnails = new Thumbnails();
