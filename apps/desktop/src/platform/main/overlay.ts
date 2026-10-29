import type { BrowserWindow } from "electron";
import type { Rect } from "../contracts/desktop.ts";
import { contains } from "../contracts/overlay.ts";

/**
 * A transparent window holding a floating surface with room for its dropdowns (see `shared/overlay.ts`). Clicks reach
 * it only over the surface, or anywhere in it while a dropdown is open, so a click beside the dropdown closes it
 * rather than landing in the app behind. Its owner calls `updateClicks` from a cursor poll: the window's own mouse
 * events don't arrive while it lets clicks through, or while another app is active.
 *
 * The renderer drives drags itself rather than through a native drag region, which the window server runs without
 * reporting where the window is until it ends.
 */
export class OverlayWindow {
  readonly window: BrowserWindow;
  /** A dropdown is open in the page. */
  dropdownOpen = false;
  /** The window's position when a drag started, while one is in progress. */
  #dragOrigin: Rect | null = null;
  #ignoring: boolean | null = null;

  constructor(window: BrowserWindow) {
    this.window = window;
    this.#setIgnoring(true);
  }

  get dragging(): boolean {
    return this.#dragOrigin !== null;
  }

  /** Takes clicks only where `surface` is under the cursor, unless a dropdown is open or the window is being dragged. */
  updateClicks(cursor: { x: number; y: number }, surface: Rect | null): void {
    this.#setIgnoring(
      !(this.dragging || this.dropdownOpen || (!!surface && contains(surface, cursor))),
    );
  }

  dragStart(): void {
    this.#dragOrigin = this.window.getBounds();
  }

  /** Moves the window by how far the pointer has moved since the drag started. */
  dragMove(dx: number, dy: number): void {
    if (!this.#dragOrigin || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.window.setPosition(
      Math.round(this.#dragOrigin.x + dx),
      Math.round(this.#dragOrigin.y + dy),
    );
  }

  /** Ends a drag, returning where the window was dropped, or null if none was in progress. */
  dragEnd(): Rect | null {
    if (!this.#dragOrigin) return null;
    this.#dragOrigin = null;
    return this.window.getBounds();
  }

  /** Stops any drag, e.g. when the window hides mid-drag. */
  reset(): void {
    this.#dragOrigin = null;
    this.dropdownOpen = false;
  }

  #setIgnoring(ignoring: boolean): void {
    if (ignoring === this.#ignoring || this.window.isDestroyed()) return;
    this.#ignoring = ignoring;
    this.window.setIgnoreMouseEvents(ignoring);
  }
}
