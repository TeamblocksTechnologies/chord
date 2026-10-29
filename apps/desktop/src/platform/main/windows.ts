import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { Surface } from "../contracts/desktop.ts";

export const preloadPath = join(import.meta.dirname, "../preload/index.cjs");

export function loadSurface(window: BrowserWindow, surface: Surface): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    url.searchParams.set("surface", surface);
    return window.loadURL(url.toString());
  }
  return window.loadFile(join(import.meta.dirname, "../renderer/index.html"), {
    query: { surface },
  });
}
