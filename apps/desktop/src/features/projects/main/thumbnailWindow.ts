import { BrowserWindow, ipcMain } from "electron";
import type { Project } from "#project-document/domain/recording";
import { loadSurface, preloadPath } from "#platform/main/windows";

/** How long a render may take before the window is taken as stuck, in milliseconds. */
const TIMEOUT = 120_000;
/** How long the window is kept after a render, for the next, in milliseconds. */
const IDLE = 60_000;

type Reply = { ok: true; result: unknown } | { ok: false; error: string };

/**
 * A hidden window that draws projects' thumbnails, with the same stage as the editor's preview and export. It's
 * opened when there's a render to do and closed once it's been idle a while, so the app's own windows never wait on it.
 */
export class ThumbnailWindow {
  #window: BrowserWindow | undefined;
  #ready: Promise<void> | undefined;
  #markReady: (() => void) | undefined;
  #pending = new Map<
    number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  #next = 1;
  #idle: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    ipcMain.on("thumbnails:ready", (event) => {
      if (event.sender === this.#window?.webContents) this.#markReady?.();
    });
    ipcMain.handle("thumbnails:result", (event, id: unknown, reply: Reply) => {
      if (event.sender !== this.#window?.webContents) return;
      const job = this.#pending.get(id as number);
      if (!job) return;
      this.#pending.delete(id as number);
      clearTimeout(job.timer);
      if (reply?.ok) job.resolve(reply.result);
      else job.reject(new Error(reply?.error ?? "The thumbnails couldn't render"));
    });
  }

  /** Renders `project`'s thumbnails; see `renderThumbnails` in the renderer. */
  async render(project: Project): Promise<unknown> {
    clearTimeout(this.#idle);
    try {
      const window = await this.#open();
      return await new Promise<unknown>((resolve, reject) => {
        const id = this.#next++;
        const timer = setTimeout(() => {
          this.#pending.delete(id);
          reject(new Error("Rendering the thumbnails took too long"));
          this.close();
        }, TIMEOUT);
        this.#pending.set(id, { resolve, reject, timer });
        window.webContents.send("thumbnails:render", id, project);
      });
    } finally {
      this.#idle = setTimeout(() => this.close(), IDLE);
    }
  }

  close(): void {
    clearTimeout(this.#idle);
    const window = this.#window;
    this.#window = undefined;
    this.#ready = undefined;
    this.#fail(new Error("The thumbnail window closed"));
    if (window && !window.isDestroyed()) window.destroy();
  }

  async #open(): Promise<BrowserWindow> {
    if (this.#window && !this.#window.isDestroyed() && this.#ready) {
      await this.#ready;
      return this.#window;
    }
    const window = new BrowserWindow({
      show: false,
      width: 960,
      height: 540,
      paintWhenInitiallyHidden: true,
      skipTaskbar: true,
      webPreferences: {
        preload: preloadPath,
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
        additionalArguments: ["--chord-surface=thumbnails"],
      },
    });
    this.#window = window;
    this.#ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("The thumbnail window didn't load")),
        TIMEOUT,
      );
      this.#markReady = () => {
        clearTimeout(timer);
        resolve();
      };
      window.webContents.once("did-fail-load", (_event, _code, description) => {
        clearTimeout(timer);
        reject(new Error(description));
      });
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      if (this.#window === window)
        this.#fail(new Error(`The thumbnail window stopped (${details.reason})`));
      if (this.#window === window) this.close();
    });
    window.on("closed", () => {
      if (this.#window === window) this.close();
    });
    void loadSurface(window, "thumbnails");
    try {
      await this.#ready;
    } catch (error) {
      this.close();
      throw error;
    }
    return window;
  }

  #fail(error: Error): void {
    for (const job of this.#pending.values()) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    this.#pending.clear();
  }
}
