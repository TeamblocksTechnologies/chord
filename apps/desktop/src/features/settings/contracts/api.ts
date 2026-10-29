export interface ShortcutsAPI {
  /** Turns global shortcuts off while Settings records a new one, so pressing one there doesn't trigger it. */
  suspend(on: boolean): Promise<void>;
}
