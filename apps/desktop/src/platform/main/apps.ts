import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { ipcMain, nativeImage } from "electron";

const run = promisify(execFile);

export interface InstalledApp {
  bundleId: string;
  name: string;
  path: string;
}

/** Where macOS keeps apps people open. Folders inside them (e.g. "Utilities", vendor suites) are searched one level down. */
const APP_DIRECTORIES = ["/Applications", "/System/Applications", join(homedir(), "Applications")];

/** Bundle ids by `.app` path and modification time, so rescans only read new or updated bundles. */
const bundleIds = new Map<string, { mtimeMs: number; bundleId: string | null }>();
/** App icons as data URLs, by bundle path. */
const icons = new Map<string, Promise<string | null>>();
/** Paths from the last scan, by bundle id. */
let installedPaths = new Map<string, string>();
/** Paths of apps found running, by bundle id. Kept after they quit; the bundle is still there to draw. */
const runningPaths = new Map<string, string>();

async function appBundles(directory: string, depth = 1): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.name.endsWith(".app")) return [path];
      if (depth > 0 && entry.isDirectory() && !entry.name.startsWith("."))
        return appBundles(path, depth - 1);
      return [];
    }),
  );
  return nested.flat();
}

async function readBundleId(path: string): Promise<string | null> {
  const { mtimeMs } = await stat(path).catch(() => ({ mtimeMs: -1 }));
  const cached = bundleIds.get(path);
  if (cached && cached.mtimeMs === mtimeMs) return cached.bundleId;
  const bundleId = await run("plutil", [
    "-extract",
    "CFBundleIdentifier",
    "raw",
    "-o",
    "-",
    join(path, "Contents/Info.plist"),
  ])
    .then(({ stdout }) => stdout.trim() || null)
    .catch(() => null);
  bundleIds.set(path, { mtimeMs, bundleId });
  return bundleId;
}

/** Runs `task` over `items`, `limit` at a time. */
async function eachLimited<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await task(items[next++]);
    }),
  );
}

async function installedApps(): Promise<InstalledApp[]> {
  if (process.platform !== "darwin") return [];
  const paths = (await Promise.all(APP_DIRECTORIES.map((d) => appBundles(d)))).flat();
  const apps = new Map<string, InstalledApp>();
  await eachLimited(paths, 16, async (path) => {
    const bundleId = await readBundleId(path);
    // The first copy found wins, e.g. /Applications over ~/Applications.
    if (bundleId && !apps.has(bundleId))
      apps.set(bundleId, { bundleId, name: basename(path, ".app"), path });
  });
  installedPaths = new Map([...apps.values()].map((a) => [a.bundleId, a.path]));
  return [...apps.values()];
}

/**
 * Apps open now: the ones in the Dock, as Launch Services lists them. Doesn't need the recorder helper or screen
 * recording permission, unlike its source list.
 */
async function runningApps(): Promise<InstalledApp[]> {
  if (process.platform !== "darwin") return [];
  const { stdout } = await run("lsappinfo", ["list"], { maxBuffer: 16 * 1024 * 1024 }).catch(
    () => ({ stdout: "" }),
  );
  const apps: InstalledApp[] = [];
  // Each app is a block starting `12) "Name" ASN:...`, followed by indented key="value" lines.
  for (const block of stdout.split(/^\s*\d+\) /m).slice(1)) {
    const name = /^"(.*?)"/.exec(block)?.[1];
    const bundleId = /bundleID="(.*?)"/.exec(block)?.[1];
    const path = /bundle path="(.*?\.app)"/.exec(block)?.[1];
    const pid = Number(/pid = (\d+)/.exec(block)?.[1]);
    // Chord's own windows are never recorded.
    if (!name || !bundleId || !path || !/type="Foreground"/.test(block) || pid === process.pid)
      continue;
    runningPaths.set(bundleId, path);
    apps.push({ bundleId, name, path });
  }
  return apps;
}

/** The `.app` bundle each pid runs from, via its executable's path. Pids that are gone or not in a bundle are left out. */
async function bundlePaths(pids: number[]): Promise<Map<number, string>> {
  if (pids.length === 0) return new Map();
  // ps exits non-zero when any pid is gone but still prints the rest.
  const { stdout } = await run("ps", ["-o", "pid=,comm=", "-p", pids.join(",")]).catch(
    (error: { stdout?: string }) => ({
      stdout: error.stdout ?? "",
    }),
  );
  const paths = new Map<number, string>();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.*?\.app)\//.exec(line);
    if (match) paths.set(Number(match[1]), match[2]);
  }
  return paths;
}

function icon(path: string): Promise<string | null> {
  let url = icons.get(path);
  if (!url) {
    // Quick Look draws the app's own icon; `app.getFileIcon` gives a generic one for bundles on recent macOS.
    url = nativeImage
      .createThumbnailFromPath(path, { width: 64, height: 64 })
      .then((image) =>
        image.isEmpty() ? null : image.resize({ width: 72, quality: "best" }).toDataURL(),
      )
      .catch(() => null);
    icons.set(path, url);
  }
  return url;
}

/**
 * `apps:installed` lists apps in the usual folders, `apps:running` the ones open now. `apps:icons` draws icons by bundle id: from the installed copy,
 * or from the running process for apps that live elsewhere. Apps without one are left out.
 */
export function handleApps(): void {
  ipcMain.handle("apps:installed", () => installedApps());
  ipcMain.handle("apps:running", () => runningApps());
  ipcMain.handle("apps:icons", async (_event, apps: { bundleId: string; pid?: number }[]) => {
    if (process.platform !== "darwin") return {};
    const pids = apps.flatMap((a) =>
      !installedPaths.has(a.bundleId) &&
      !runningPaths.has(a.bundleId) &&
      Number.isInteger(a.pid) &&
      a.pid! > 0
        ? [a.pid!]
        : [],
    );
    const running = await bundlePaths(pids);
    const urls: Record<string, string> = {};
    await eachLimited(apps, 8, async ({ bundleId, pid }) => {
      const path =
        installedPaths.get(bundleId) ??
        runningPaths.get(bundleId) ??
        (pid === undefined ? undefined : running.get(pid));
      const url = path && (await icon(path));
      if (url) urls[bundleId] = url;
    });
    return urls;
  });
}
