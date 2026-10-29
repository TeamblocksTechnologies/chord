import { type FileHandle, mkdir, open, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { ClipboardItem, app, clipboard, ipcMain, nativeImage, shell } from "electron";
import { captionFiles, isTimedText } from "#features/transcription/domain/captions";
import type { ExportedVideo } from "#platform/contracts/desktop";
import {
  exportFileName,
  frameFileName,
  projectFolderName,
} from "#features/recording/domain/session";
import { recordingsFolder } from "#features/recording/main/capture";

/** The folder in a project's folder that its exports are saved in. */
const EXPORTS_FOLDER = "Exports";
const EXTENSIONS = new Set([".mp4", ".webm", ".gif", ".png"]);
/** A PNG file starts with these bytes. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** The largest frame taken, in bytes: a PNG of a screen is a few megabytes. */
const MAX_FRAME = 256 * 1024 * 1024;

/**
 * Exported videos: the renderer encodes them and the main process writes them to the project's Exports folder, named
 * for the project and when they were exported. Frames are saved there too, or copied to the clipboard. Only files in
 * an Exports folder can be opened, revealed or trashed.
 * Returns whether an export is being written.
 */
export function handleExport(): () => boolean {
  const created = new Set<string>();
  const files = new Map<number, { path: string; handle: FileHandle; sidecars: string[] }>();
  let nextId = 1;

  ipcMain.handle(
    "export:create",
    async (_event, folder: unknown, name: unknown, extension: unknown) => {
      if (
        typeof folder !== "string" ||
        typeof name !== "string" ||
        (extension !== "mp4" && extension !== "webm" && extension !== "gif")
      ) {
        throw new Error("Not an export");
      }
      const directory = exportsFolder(folder);
      await mkdir(directory, { recursive: true });
      const file = exportFileName(name, new Date(), extension);
      // Two exports in the same second get a number, as Finder would.
      let path = join(directory, file);
      for (let n = 2; await exportExists(path); n++)
        path = join(directory, `${basename(file, `.${extension}`)} ${n}.${extension}`);
      created.add(path);
      return path;
    },
  );
  ipcMain.handle("export:open", async (_event, path: unknown) => {
    if (typeof path !== "string" || !created.has(path)) throw new Error("Not an export");
    created.delete(path);
    const id = nextId++;
    files.set(id, { path, handle: await open(path, "wx"), sidecars: [] });
    return id;
  });
  ipcMain.handle("export:write", async (_event, id: unknown, position: unknown, data: unknown) => {
    const file = files.get(id as number);
    if (!file || typeof position !== "number" || !(data instanceof Uint8Array))
      throw new Error("Not an open export");
    await file.handle.write(data, 0, data.byteLength, position);
  });
  ipcMain.handle(
    "export:save-frame",
    async (_event, folder: unknown, name: unknown, time: unknown, data: unknown) => {
      if (
        typeof folder !== "string" ||
        typeof name !== "string" ||
        typeof time !== "number" ||
        !Number.isFinite(time) ||
        !isPng(data)
      ) {
        throw new Error("Not a frame");
      }
      const directory = exportsFolder(folder);
      await mkdir(directory, { recursive: true });
      const file = frameFileName(name, new Date(), time);
      // Two frames named alike get a number, as Finder would. `wx` leaves a file that's there alone.
      for (let n = 1; ; n++) {
        const path =
          n === 1 ? join(directory, file) : join(directory, `${basename(file, ".png")} ${n}.png`);
        try {
          await writeFile(path, data, { flag: "wx" });
          return path;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
    },
  );
  ipcMain.handle("export:copy-frame", async (_event, data: unknown) => {
    if (!isPng(data)) throw new Error("Not a frame");
    // The frame has to decode, rather than put something unreadable on the clipboard.
    if (
      nativeImage
        .createFromBuffer(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
        .isEmpty()
    ) {
      throw new Error("The frame couldn't be read");
    }
    await clipboard.write([
      new ClipboardItem({ "image/png": new Blob([new Uint8Array(data)], { type: "image/png" }) }),
    ]);
  });
  ipcMain.handle("export:captions", async (_event, path: unknown, cues: unknown) => {
    const file = [...files.values()].find((file) => file.path === path);
    if (!file || !Array.isArray(cues) || !cues.every(isTimedText))
      throw new Error("Not an open caption export");
    const stem = file.path.slice(0, -extname(file.path).length);
    for (const [extension, contents] of Object.entries(captionFiles(cues))) {
      const sidecar = `${stem}.${extension}`;
      await writeFile(sidecar, contents, { flag: "wx" });
      file.sidecars.push(sidecar);
    }
  });
  ipcMain.handle("export:close", async (_event, id: unknown, keep: unknown) => {
    const file = files.get(id as number);
    if (!file) return;
    files.delete(id as number);
    await file.handle.close();
    if (keep !== true) {
      await rm(file.path, { force: true });
      for (const sidecar of file.sidecars) await rm(sidecar, { force: true });
    }
  });
  ipcMain.handle("export:list", async (_event, folder: unknown): Promise<ExportedVideo[]> => {
    if (typeof folder !== "string") return [];
    const directory = exportsFolder(folder);
    const writing = new Set([...files.values()].map((file) => file.path));
    const names = await readdir(directory).catch(() => []);
    const videos = await Promise.all(
      names.map(async (name) => {
        const path = join(directory, name);
        if (!EXTENSIONS.has(extname(name).toLowerCase()) || writing.has(path)) return null;
        const info = await stat(path).catch(() => null);
        return info?.isFile()
          ? { path, name, size: info.size, createdAt: info.birthtime.toISOString() }
          : null;
      }),
    );
    return videos
      .filter((video) => video !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  ipcMain.handle("export:play", async (_event, path: unknown) => {
    if (!isExport(path)) return;
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  });
  ipcMain.handle("export:reveal", (_event, path: unknown) => {
    if (isExport(path)) shell.showItemInFolder(path);
  });
  ipcMain.handle("export:trash", async (_event, path: unknown) => {
    if (isExport(path)) {
      await shell.trashItem(path);
      // Frames and GIFs have no transcript files.
      for (const extension of [".png", ".gif"].includes(extname(path).toLowerCase())
        ? []
        : ["txt", "srt", "vtt"]) {
        const sidecar = `${path.slice(0, -extname(path).length)}.${extension}`;
        if (await exists(sidecar)) await shell.trashItem(sidecar);
      }
    }
  });
  app.once("will-quit", () => {
    for (const { handle } of files.values()) void handle.close();
  });
  return () => files.size > 0;
}

/** Whether `data` is a PNG within the size taken. */
function isPng(data: unknown): data is Uint8Array {
  return (
    data instanceof Uint8Array &&
    data.byteLength > PNG_SIGNATURE.length &&
    data.byteLength <= MAX_FRAME &&
    PNG_SIGNATURE.every((byte, index) => data[index] === byte)
  );
}

/** The Exports folder of the project folder named `folder`, in the recordings folder. */
function exportsFolder(folder: string): string {
  return join(recordingsFolder(), projectFolderName(folder), EXPORTS_FOLDER);
}

/** Whether `path` is a video, GIF or frame in some project's Exports folder. */
function isExport(path: unknown): path is string {
  if (typeof path !== "string" || !EXTENSIONS.has(extname(path).toLowerCase())) return false;
  const folder = dirname(path);
  return (
    basename(folder) === EXPORTS_FOLDER &&
    dirname(dirname(folder)) === recordingsFolder() &&
    exportsFolder(basename(dirname(folder))) === folder
  );
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** A prior video's captions keep its name reserved even if the video was moved elsewhere. */
async function exportExists(path: string): Promise<boolean> {
  const stem = path.slice(0, -extname(path).length);
  const paths = [path, ...["txt", "srt", "vtt"].map((extension) => `${stem}.${extension}`)];
  return (await Promise.all(paths.map(exists))).some(Boolean);
}
