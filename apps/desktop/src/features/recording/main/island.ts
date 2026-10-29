import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { screen, type BrowserWindow } from "electron";
import type { Rect } from "#platform/contracts/desktop";
import {
  DEFAULT_ANCHOR,
  anchorFor,
  islandBounds,
  isIslandAnchor,
  nextIslandMode,
  showsCamera,
  surfaceIn,
  type IslandAnchor,
  type IslandMode,
  type IslandState,
} from "../contracts/island.ts";
import { overlayFrame } from "#platform/contracts/overlay";
import { OverlayWindow } from "#platform/main/overlay";

/** About a frame, so hovering and leaving respond as soon as the cursor gets there. */
const POLL_INTERVAL = 16;

/**
 * The floating controls shown while recording. Its window is transparent: the open island's size plus room for its
 * dropdowns on the side away from its corner, so the renderer can animate between compact and open and show dropdowns
 * in the page. The main process polls the cursor to open and close it, and to let clicks through where nothing is
 * drawn. Where it's dragged to is kept for later recordings.
 */
export class Island {
  state: IslandState = {
    visible: false,
    mode: "compact",
    camera: false,
    preview: true,
    tools: true,
    corner: DEFAULT_ANCHOR,
  };
  #anchor: IslandAnchor & { displayId?: number } = DEFAULT_ANCHOR;
  #overlay: OverlayWindow | undefined;
  #loading: Promise<void> | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  private options: {
    /** Where the island's position is saved. */
    path: string;
    create(): { window: BrowserWindow; loading: Promise<void> };
    changed(): void;
  };
  constructor(options: Island["options"]) {
    this.options = options;
    try {
      const stored: unknown = JSON.parse(readFileSync(options.path, "utf8"));
      if (isIslandAnchor(stored)) this.#anchor = stored;
    } catch {
      /* Not moved yet. */
    }
    this.state.corner = { horizontal: this.#anchor.horizontal, vertical: this.#anchor.vertical };
  }

  get window(): BrowserWindow | undefined {
    return this.#overlay?.window;
  }

  /** The visible surface on screen, read from where the window really is so it can't drift from what's drawn. */
  get bounds(): Rect {
    const frame = this.window?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 };
    return surfaceIn(
      frame,
      this.state.corner,
      this.state.mode,
      showsCamera(this.state.mode, this.state),
      this.state.tools,
    );
  }

  /** Shows the island while recording, sized for whether a camera is on and previewed. Doesn't notify; the caller is notifying. */
  sync(visible: boolean, camera: boolean, preview: boolean, tools: boolean): void {
    if (
      visible === this.state.visible &&
      camera === this.state.camera &&
      preview === this.state.preview &&
      tools === this.state.tools
    )
      return;
    if (!visible) {
      this.hide();
      return;
    }
    if (!this.state.visible) this.state.mode = "compact";
    this.state.visible = true;
    this.state.camera = camera;
    this.state.preview = preview;
    this.state.tools = tools;
    if (!this.#overlay) {
      const { window, loading } = this.options.create();
      this.#overlay = new OverlayWindow(window);
      this.#loading = loading;
      window.on("closed", () => {
        this.#overlay = undefined;
        this.#loading = undefined;
        this.#stopPolling();
      });
    }
    this.place();
    const window = this.#overlay.window;
    void this.#loading?.then(() => {
      if (!this.state.visible || window.isDestroyed()) return;
      // Recording shouldn't take focus from the app being recorded.
      if (!window.isVisible()) window.showInactive();
      this.#timer ??= setInterval(() => this.#poll(), POLL_INTERVAL);
    });
  }

  hide(): void {
    if (!this.state.visible) return;
    this.#stopPolling();
    this.state.visible = false;
    this.state.mode = "compact";
    this.#overlay?.reset();
    this.window?.hide();
  }

  /** Sizes the window for the open island and its dropdowns at its anchor, e.g. after displays change. */
  place(): void {
    const window = this.window;
    if (!window || !this.state.visible || this.#overlay?.dragging) return;
    const workArea = this.#workArea();
    const open = islandBounds("open", this.#anchor, this.state.camera, workArea);
    const frame = overlayFrame(
      open,
      this.#anchor.vertical === "bottom" ? "above" : "below",
      this.#anchor.horizontal,
      workArea,
    );
    const current = window.getBounds();
    if (
      current.x !== frame.x ||
      current.y !== frame.y ||
      current.width !== frame.width ||
      current.height !== frame.height
    ) {
      window.setBounds(frame);
    }
  }

  /** A dropdown opened or closed in the island; one keeps it open. */
  setDropdownOpen(open: boolean): void {
    if (this.#overlay) this.#overlay.dropdownOpen = open;
  }

  /** A drag of the open island started; it stays open until the drag ends. */
  dragStart(): void {
    if (this.state.mode === "open") this.#overlay?.dragStart();
  }

  dragMove(dx: number, dy: number): void {
    this.#overlay?.dragMove(dx, dy);
  }

  /** Pins the island to where it was dropped and remembers it. */
  dragEnd(): void {
    const frame = this.#overlay?.dragEnd();
    if (!frame) return;
    const open = surfaceIn(frame, this.state.corner, "open", this.state.camera);
    const display = screen.getDisplayMatching(open);
    this.#anchor = { ...anchorFor(open, display.workArea), displayId: display.id };
    this.state.corner = { horizontal: this.#anchor.horizontal, vertical: this.#anchor.vertical };
    // The dropdown room moves to the other side when it's dropped in the other half, and it comes back on screen.
    this.place();
    this.options.changed();
    try {
      writeFileSync(`${this.options.path}.tmp`, JSON.stringify(this.#anchor));
      renameSync(`${this.options.path}.tmp`, this.options.path);
    } catch (error) {
      console.warn("Could not save the recording island's position", error);
    }
  }

  dispose(): void {
    this.#stopPolling();
  }

  #workArea(): Rect {
    const display =
      screen.getAllDisplays().find((d) => d.id === this.#anchor.displayId) ??
      screen.getPrimaryDisplay();
    return display.workArea;
  }

  #stopPolling(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  #poll(): void {
    const overlay = this.#overlay;
    if (!overlay) return;
    const cursor = screen.getCursorScreenPoint();
    if (!overlay.dragging) {
      const next = nextIslandMode({
        mode: this.state.mode,
        cursor,
        bounds: this.bounds,
        dropdownOpen: overlay.dropdownOpen,
      });
      if (next) this.#setMode(next);
    }
    // The compact island has nothing to click, so clicks go to what's behind it.
    overlay.updateClicks(cursor, this.state.mode === "open" ? this.bounds : null);
  }

  #setMode(mode: IslandMode): void {
    this.state.mode = mode;
    this.options.changed();
  }
}
