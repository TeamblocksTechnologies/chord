import type { ScreenArea } from "@teamblocks.dev/chord-recorder-protocol";
import { BrowserWindow, ipcMain, screen } from "electron";
import type { AreaPickerInit } from "#platform/contracts/desktop";

type Picking = {
  windows: BrowserWindow[];
  /** Areas by display, as each display's window last reported them. */
  areas: Map<number, ScreenArea[]>;
  /** Areas on displays that aren't connected, kept as they were. */
  others: ScreenArea[];
  /** What each window starts with, by window. */
  inits: AreaPickerInit[];
  finish(done: boolean): void;
};

/**
 * Picks the areas `area` mode records: a window over each display, where areas are dragged out, moved, resized, and
 * removed. Each window edits its own display's areas. The windows are kept out of screen capture, so picking while
 * recording doesn't show up in it.
 */
export class AreaPicker {
  #picking: { session: Picking; result: Promise<ScreenArea[] | null> } | undefined;
  private options: { create(): BrowserWindow; load(window: BrowserWindow): Promise<void> };
  constructor(options: AreaPicker["options"]) {
    this.options = options;
    ipcMain.on("areas:change", (event, areas: unknown) => {
      const session = this.#picking?.session;
      const index =
        session?.windows.findIndex(
          (window) => !window.isDestroyed() && window.webContents === event.sender,
        ) ?? -1;
      if (!session || index < 0 || !Array.isArray(areas)) return;
      const displayId = [...session.areas.keys()][index];
      session.areas.set(
        displayId,
        areas.filter(isArea).map(({ x, y, width, height }) => ({ displayId, x, y, width, height })),
      );
    });
    // Pulled by each window once its page has mounted, as a push on load can arrive before the page is listening.
    ipcMain.handle("areas:init", (event): AreaPickerInit | null => {
      const session = this.#picking?.session;
      const index =
        session?.windows.findIndex(
          (window) => !window.isDestroyed() && window.webContents === event.sender,
        ) ?? -1;
      return session ? (session.inits[index] ?? null) : null;
    });
    // Windows stay hidden until their page has painted, so they open complete.
    ipcMain.on("areas:ready", (event) => {
      const session = this.#picking?.session;
      const index =
        session?.windows.findIndex(
          (window) => !window.isDestroyed() && window.webContents === event.sender,
        ) ?? -1;
      const window = session?.windows[index];
      if (!window || window.isDestroyed()) return;
      window.show();
      if (session!.inits[index]?.controls) window.focus();
    });
    ipcMain.on("areas:finish", (event, done: unknown) => {
      const session = this.#picking?.session;
      if (
        session?.windows.some(
          (window) => !window.isDestroyed() && window.webContents === event.sender,
        )
      )
        session.finish(done === true);
    });
  }

  /** The areas once picking is done, or null if it was cancelled. A second call while picking joins the first. */
  pick(current: ScreenArea[]): Promise<ScreenArea[] | null> {
    if (this.#picking) {
      this.#picking.session.windows.find((window) => !window.isDestroyed())?.focus();
      return this.#picking.result;
    }
    const displays = screen.getAllDisplays();
    const connected = new Set(displays.map((display) => display.id));
    let finish!: (done: boolean) => void;
    const result = new Promise<ScreenArea[] | null>((resolve) => {
      finish = (done) => {
        const { session } = this.#picking!;
        this.#picking = undefined;
        for (const window of session.windows) if (!window.isDestroyed()) window.destroy();
        resolve(done ? [...session.others, ...[...session.areas.values()].flat()] : null);
      };
    });
    const session: Picking = {
      windows: [],
      areas: new Map(
        displays.map((display) => [
          display.id,
          current.filter((area) => area.displayId === display.id),
        ]),
      ),
      others: current.filter((area) => !connected.has(area.displayId)),
      inits: [],
      finish,
    };
    this.#picking = { session, result };
    const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    for (const display of displays) {
      const window = this.options.create();
      window.setBounds(display.bounds);
      window.setContentProtection(true);
      window.on("closed", () => {
        if (this.#picking?.session === session) finish(false);
      });
      session.windows.push(window);
      const init: AreaPickerInit = {
        areas: session.areas.get(display.id)!,
        // The bar with Save and Cancel shows on the display the cursor is on.
        controls: display.id === cursor.id,
      };
      session.inits.push(init);
      void this.options.load(window);
    }
    return result;
  }

  dispose(): void {
    this.#picking?.session.finish(false);
  }
}

function isArea(value: unknown): value is ScreenArea {
  if (!value || typeof value !== "object") return false;
  const a = value as ScreenArea;
  return [a.x, a.y, a.width, a.height].every(Number.isFinite) && a.width > 0 && a.height > 0;
}
