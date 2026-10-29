import { app, BrowserWindow, ipcMain } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateState } from "../contracts/updates.ts";

const { autoUpdater } = electronUpdater;

/** Checks for, downloads and installs new versions. Source runs have no update feed, so they report `unsupported`. */
export function handleUpdates(): void {
  let state: UpdateState = app.isPackaged ? { status: "idle" } : { status: "unsupported" };

  const set = (next: UpdateState) => {
    state = next;
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send("updates:state", state);
  };
  const fail = (error: unknown) =>
    set({ status: "error", message: error instanceof Error ? error.message : String(error) });

  ipcMain.handle("updates:state", () => state);

  if (state.status === "unsupported") {
    ipcMain.handle("updates:check", () => {});
    ipcMain.handle("updates:download", () => {});
    ipcMain.handle("updates:install", () => {});
    return;
  }

  // Downloading is the user's call, and an installed update waits for the restart they ask for.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => set({ status: "checking" }));
  autoUpdater.on("update-available", (info) => set({ status: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => set({ status: "current" }));
  autoUpdater.on("download-progress", (progress) => {
    if (state.status === "downloading" || state.status === "available") {
      set({ status: "downloading", version: state.version, percent: progress.percent });
    }
  });
  autoUpdater.on("update-downloaded", (info) => set({ status: "ready", version: info.version }));
  autoUpdater.on("error", fail);

  const busy = () => state.status === "checking" || state.status === "downloading";

  ipcMain.handle("updates:check", async () => {
    if (busy() || state.status === "ready") return;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      fail(error);
    }
  });
  ipcMain.handle("updates:download", async () => {
    if (state.status !== "available") return;
    set({ status: "downloading", version: state.version, percent: 0 });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      fail(error);
    }
  });
  ipcMain.handle("updates:install", () => {
    if (state.status === "ready") autoUpdater.quitAndInstall();
  });

  // Look once at launch so a waiting update shows without being asked.
  autoUpdater.checkForUpdates().catch(fail);
}
