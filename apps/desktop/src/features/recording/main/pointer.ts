import { screen, type BrowserWindow } from "electron";
import type { PointerUpdate, ShortcutPress } from "#platform/contracts/desktop";
import { formatShortcut, type KeyModifier } from "../domain/keys.ts";

/** About a frame, so the overlays keep up with the cursor. */
const POLL_INTERVAL = 16;

type Entry = { window: BrowserWindow; loading: Promise<void>; sent?: string };

/**
 * The presenter's pointer overlays, the laser pointer, click highlights and keyboard shortcuts: a transparent, click-through window over
 * each display, shared by both. The windows are excluded from screen capture, so nothing drawn is in the recording.
 * The windows can't see the mouse, so the main process polls the cursor and passes it in along with the button state.
 */
export class PointerOverlay {
  #windows: Entry[] = [];
  #timer: ReturnType<typeof setInterval> | undefined;
  #laser = false;
  #clicks = false;
  #keys = false;
  #watchingKeys = false;
  #shortcuts = 0;
  #down = false;
  #watching = false;
  private options: {
    create(): BrowserWindow;
    load(window: BrowserWindow): Promise<void>;
    /** Starts or stops reporting the mouse button through `setDown`. */
    watchMouse(on: boolean): void;
    /** Starts or stops reporting key presses through `showShortcut`. */
    watchKeys(on: boolean): void;
  };
  constructor(options: PointerOverlay["options"]) {
    this.options = options;
  }

  sync(laser: boolean, clicks: boolean, keys: boolean): void {
    this.#laser = laser;
    this.#clicks = clicks;
    this.#keys = keys;
    if (!clicks) this.#down = false;
    const on = laser || clicks || keys;
    if (on !== this.#windows.length > 0) {
      if (on) this.#open();
      else this.#close();
    }
    if (clicks !== this.#watching) {
      this.#watching = clicks;
      this.options.watchMouse(clicks);
    }
    if (keys !== this.#watchingKeys) {
      this.#watchingKeys = keys;
      this.options.watchKeys(keys);
    }
  }

  /** Shows a key press on the display the cursor is on, if it's a shortcut worth showing. */
  showShortcut(keyCode: number, modifiers: KeyModifier[]): void {
    if (!this.#keys) return;
    const parts = formatShortcut(keyCode, modifiers);
    if (!parts) return;
    const cursor = screen.getCursorScreenPoint();
    const live = this.#windows
      .map((entry) => entry.window)
      .filter((window) => !window.isDestroyed());
    const target =
      live.find((window) => {
        const { x, y, width, height } = window.getBounds();
        return cursor.x >= x && cursor.x < x + width && cursor.y >= y && cursor.y < y + height;
      }) ?? live[0];
    const press: ShortcutPress = { id: ++this.#shortcuts, parts };
    target?.webContents.send("pointer:shortcut", press);
  }

  /** Whether a mouse button is held, as the helper reports it. */
  setDown(down: boolean): void {
    if (down === this.#down || !this.#clicks) return;
    this.#down = down;
    this.#follow();
  }

  dispose(): void {
    this.#close();
    if (this.#watching) this.options.watchMouse(false);
    this.#watching = false;
    if (this.#watchingKeys) this.options.watchKeys(false);
    this.#watchingKeys = false;
  }

  #open(): void {
    for (const display of screen.getAllDisplays()) {
      const window = this.options.create();
      window.setBounds(display.bounds);
      // Keeps the overlay out of the recording; it's only for the presenter.
      window.setContentProtection(true);
      window.setIgnoreMouseEvents(true);
      const entry: Entry = { window, loading: this.options.load(window) };
      void entry.loading.then(() => {
        // Anything sent before the page loaded was dropped.
        entry.sent = undefined;
        if (!window.isDestroyed()) window.showInactive();
      });
      this.#windows.push(entry);
    }
    this.#timer = setInterval(() => this.#follow(), POLL_INTERVAL);
  }

  #close(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
    for (const { window } of this.#windows) if (!window.isDestroyed()) window.destroy();
    this.#windows = [];
  }

  #follow(): void {
    const cursor = screen.getCursorScreenPoint();
    for (const entry of this.#windows) {
      const { window } = entry;
      if (window.isDestroyed()) continue;
      const { x, y, width, height } = window.getBounds();
      const inside =
        cursor.x >= x && cursor.x < x + width && cursor.y >= y && cursor.y < y + height;
      const update: PointerUpdate = {
        cursor: inside ? { x: cursor.x - x, y: cursor.y - y } : null,
        down: this.#down,
        laser: this.#laser,
        clicks: this.#clicks,
      };
      // A resting cursor needs no resend.
      const key = JSON.stringify(update);
      if (key === entry.sent) continue;
      entry.sent = key;
      window.webContents.send("pointer:update", update);
    }
  }
}
