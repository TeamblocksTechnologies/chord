import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { screen, type BrowserWindow } from "electron";
import type { Rect } from "#platform/contracts/desktop";
import { NOTES_WINDOW, RESIZE_EDGES, resizedBounds, type ResizeEdge } from "../domain/notes.ts";

/** Distance from the top of the work area by default. */
const MARGIN = 12;
/** How much of the window must be on a display for its saved place to be used. */
const VISIBLE = 48;

function isRect(value: unknown): value is Rect {
  const r = value as Rect;
  return (
    !!r &&
    typeof r === "object" &&
    [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
    r.width >= NOTES_WINDOW.minWidth &&
    r.height >= NOTES_WINDOW.minHeight
  );
}

/**
 * The recording notes shown while recording a project with notes: a window of its own, apart from the island. It starts
 * at the top middle of the display the cursor is on, and can be dragged anywhere and resized from any edge; where it
 * was left is kept for later recordings. It's excluded from screen capture, so it's never in the recording.
 *
 * Transparent windows can't be resized natively, so the page draws the edges and reports drags of them, as it does for
 * moves.
 */
export class NotesWindow {
  #window: BrowserWindow | undefined;
  #loading: Promise<void> | undefined;
  #visible = false;
  /** Where it was left, or null to use the default place. */
  #saved: Rect | null = null;
  #drag: { origin: Rect; edge: ResizeEdge | null } | null = null;
  private options: {
    /** Where the window's place is saved. */
    path: string;
    create(): BrowserWindow;
    load(window: BrowserWindow): Promise<void>;
  };
  constructor(options: NotesWindow["options"]) {
    this.options = options;
    try {
      const stored: unknown = JSON.parse(readFileSync(options.path, "utf8"));
      if (isRect(stored)) this.#saved = stored;
    } catch {
      /* Not moved yet. */
    }
  }

  get window(): BrowserWindow | undefined {
    return this.#window;
  }

  sync(visible: boolean): void {
    if (visible === this.#visible) return;
    this.#visible = visible;
    if (!visible) {
      this.#drag = null;
      this.#window?.hide();
      return;
    }
    if (!this.#window) {
      const window = this.options.create();
      // Keeps the notes out of the recording; they're only for the presenter.
      window.setContentProtection(true);
      this.#window = window;
      this.#loading = this.options.load(window);
      window.on("closed", () => {
        this.#window = undefined;
        this.#loading = undefined;
        this.#visible = false;
      });
    }
    this.place();
    const window = this.#window;
    void this.#loading?.then(() => {
      // Recording shouldn't take focus from the app being recorded.
      if (this.#visible && !window.isDestroyed() && !window.isVisible()) window.showInactive();
    });
  }

  /** Where it was left while that's still on a display, otherwise the top middle of the display the cursor is on. */
  place(): void {
    const window = this.#window;
    if (!window || !this.#visible || this.#drag) return;
    window.setBounds(
      this.#saved && this.#onScreen(this.#saved) ? this.#saved : this.#defaultBounds(),
    );
  }

  /** A move (no edge) or resize from `edge` started. */
  dragStart(edge: unknown = null): void {
    const bounds = this.#window?.getBounds();
    if (!bounds) return;
    this.#drag = {
      origin: bounds,
      edge: RESIZE_EDGES.includes(edge as ResizeEdge) ? (edge as ResizeEdge) : null,
    };
  }

  /** How far the pointer has moved since the drag started. */
  dragMove(dx: number, dy: number): void {
    const window = this.#window;
    if (!this.#drag || !window || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const { origin, edge } = this.#drag;
    if (edge) window.setBounds(resizedBounds(origin, edge, dx, dy));
    else window.setPosition(Math.round(origin.x + dx), Math.round(origin.y + dy));
  }

  /** Keeps where it was dropped, and its size, for later recordings. */
  dragEnd(): void {
    if (!this.#drag) return;
    this.#drag = null;
    const bounds = this.#window?.getBounds();
    if (!bounds) return;
    this.#saved = bounds;
    try {
      writeFileSync(`${this.options.path}.tmp`, JSON.stringify(bounds));
      renameSync(`${this.options.path}.tmp`, this.options.path);
    } catch (error) {
      console.warn("Could not save the recording notes window's place", error);
    }
  }

  dispose(): void {
    if (this.#window && !this.#window.isDestroyed()) this.#window.destroy();
  }

  #defaultBounds(): Rect {
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const width = Math.min(NOTES_WINDOW.width, workArea.width);
    return {
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: workArea.y + MARGIN,
      width,
      height: NOTES_WINDOW.height,
    };
  }

  #onScreen(rect: Rect): boolean {
    return screen.getAllDisplays().some(({ bounds: d }) => {
      const width = Math.min(rect.x + rect.width, d.x + d.width) - Math.max(rect.x, d.x);
      const height = Math.min(rect.y + rect.height, d.y + d.height) - Math.max(rect.y, d.y);
      return width >= VISIBLE && height >= VISIBLE;
    });
  }
}
