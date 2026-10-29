import { Menu, nativeImage, screen, Tray, type BrowserWindow } from "electron";
import type { DesktopState, Rect } from "#platform/contracts/desktop";
import { menubarFrame } from "#platform/contracts/overlay";
import { OverlayWindow } from "#platform/main/overlay";
import icon1x from "./assets/trayTemplate.png?asset";
import icon2x from "./assets/trayTemplate@2x.png?asset";

/** About a frame, so clicks reach the panel as soon as the cursor does. */
const POLL_INTERVAL = 16;
/** A click on the icon that closed the panel, by taking focus from it, mustn't open it again. */
const REOPEN_DELAY = 300;

/**
 * The menu bar icon and the panel it opens: the home screen in a transparent window under the icon, with room beside
 * the panel for its dropdowns (see `menubarFrame`). It closes when it loses focus, like a menu.
 */
export class Menubar {
  state: DesktopState["menubar"] = { visible: false, side: "left" };
  #tray: Tray;
  #overlay: OverlayWindow | undefined;
  #loading: Promise<void> | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #panel: Rect | null = null;
  #blurredAt = 0;
  /** Windows the panel opened, like the area picker, that take focus without closing it. */
  #holds = 0;
  private options: {
    create(): { window: BrowserWindow; loading: Promise<void> };
    /** Whether a recording is in progress, when the icon shows its controls in the main window instead. */
    recording(): boolean;
    showMain(): void;
    changed(): void;
  };

  constructor(options: Menubar["options"]) {
    this.options = options;
    const image = nativeImage.createEmpty();
    image.addRepresentation({ scaleFactor: 1, buffer: nativeImage.createFromPath(icon1x).toPNG() });
    image.addRepresentation({ scaleFactor: 2, buffer: nativeImage.createFromPath(icon2x).toPNG() });
    image.setTemplateImage(true);
    this.#tray = new Tray(image);
    this.#tray.setToolTip("Chord");
    // Otherwise a quick second click arrives as a double click and doesn't toggle the panel.
    this.#tray.setIgnoreDoubleClickEvents(true);
    this.#tray.on("click", () => this.toggle());
    this.#tray.on("right-click", () => {
      this.hide();
      this.#tray.popUpContextMenu(
        Menu.buildFromTemplate([
          { label: "Open Chord", click: () => options.showMain() },
          { type: "separator" },
          { label: "Quit Chord", role: "quit" },
        ]),
      );
    });
  }

  get window(): BrowserWindow | undefined {
    return this.#overlay?.window;
  }

  toggle(): void {
    if (this.state.visible) this.hide();
    // The blur only accounts for one click, so a quick next one opens the panel again.
    else if (Date.now() - this.#blurredAt <= REOPEN_DELAY) this.#blurredAt = 0;
    else void this.show();
  }

  async show(): Promise<void> {
    if (this.options.recording()) {
      this.options.showMain();
      return;
    }
    if (!this.#overlay) {
      const { window, loading } = this.options.create();
      this.#overlay = new OverlayWindow(window);
      this.#loading = loading;
      window.on("blur", () => {
        if (this.#holds > 0 || !this.state.visible) return;
        this.#blurredAt = Date.now();
        this.hide();
      });
      window.on("closed", () => {
        this.#overlay = undefined;
        this.#loading = undefined;
        this.#stopPolling();
        this.state.visible = false;
      });
    }
    this.state.visible = true;
    this.place();
    this.options.changed();
    await this.#loading;
    const overlay = this.#overlay;
    if (!this.state.visible || !overlay || overlay.window.isDestroyed()) return;
    // The panel is non-activating, so it takes key focus without activating the app. Activating it would switch to
    // the space of the app's other windows and pull the panel off the full-screen space the user is in.
    overlay.window.show();
    overlay.window.focus();
    this.#timer ??= setInterval(
      () => overlay.updateClicks(screen.getCursorScreenPoint(), this.#panel),
      POLL_INTERVAL,
    );
  }

  hide(): void {
    if (!this.state.visible) return;
    this.state.visible = false;
    this.#stopPolling();
    this.#overlay?.reset();
    const window = this.window;
    if (window && !window.isDestroyed()) {
      // Its dropdowns start closed next time.
      window.webContents.send("overlay:dismiss");
      window.hide();
    }
    this.options.changed();
  }

  /** Puts the panel under the icon, with its dropdown room on the roomier side. */
  place(): void {
    const window = this.window;
    if (!window) return;
    const icon = this.#tray.getBounds();
    const { panel, frame, side } = menubarFrame(icon, screen.getDisplayMatching(icon).workArea);
    this.#panel = panel;
    window.setBounds(frame);
    if (side !== this.state.side) {
      this.state.side = side;
      this.options.changed();
    }
  }

  setDropdownOpen(open: boolean): void {
    if (this.#overlay) this.#overlay.dropdownOpen = open;
  }

  /** Keeps the panel open while `task` has another window focused, then focuses it again. */
  hold<T>(task: Promise<T>): Promise<T> {
    this.#holds++;
    return task.finally(() => {
      this.#holds--;
      const window = this.window;
      if (this.#holds === 0 && this.state.visible && window && !window.isDestroyed())
        window.focus();
    });
  }

  dispose(): void {
    this.#stopPolling();
    this.#tray.destroy();
  }

  #stopPolling(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
