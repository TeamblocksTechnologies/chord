import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { defaultPreferences, patchPreferences, type Preferences } from "../domain/preferences.ts";

/**
 * The user's preferences, in a JSON file at `path`. Preferences added since it was saved take their defaults; a
 * missing or unreadable file starts from `seed` and saves it.
 */
export class PreferenceStore {
  readonly #path: string;
  #value: Preferences;
  readonly #listeners = new Set<(value: Preferences, previous: Preferences) => void>();

  constructor(path: string, seed: () => Preferences) {
    this.#path = path;
    let stored: unknown;
    try {
      stored = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      /* First launch, or a damaged file. */
    }
    const value = patchPreferences(defaultPreferences(), stored);
    if (value) this.#value = value;
    else {
      this.#value = seed();
      this.#write();
    }
  }

  get value(): Preferences {
    return this.#value;
  }

  /** Applies the patch's known fields, throwing if the result isn't valid. */
  update(patch: unknown): Preferences {
    const next = patchPreferences(this.#value, patch);
    if (!next) throw new Error("Invalid preferences");
    const previous = this.#value;
    this.#value = next;
    this.#write();
    for (const listener of this.#listeners) listener(next, previous);
    return next;
  }

  /** Calls `listener` after each update. */
  onChange(listener: (value: Preferences, previous: Preferences) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #write(): void {
    // Atomic replacement prevents a partial file if the app exits during a write.
    writeFileSync(`${this.#path}.tmp`, JSON.stringify(this.#value));
    renameSync(`${this.#path}.tmp`, this.#path);
  }
}
