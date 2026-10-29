import { mkdir, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  CameraSource,
  PermissionKind,
  Permissions,
} from "@teamblocks.dev/chord-recorder-protocol";
import { app, shell } from "electron";
import {
  activeCameraIds,
  activeMicrophoneIds,
  capturesScreen,
  type RecordingSetup,
} from "#project-document/domain/recording";
import { pinnedWindows, projectFolderName, sessionUpdate } from "../domain/session.ts";
import { THUMBNAILS_FOLDER } from "#features/projects/contracts/thumbnails";
import type { Preferences } from "#features/settings/domain/preferences";
import type { RecorderHelper } from "#platform/main/helper";
import type { CaptureBackend } from "./recording.ts";

/** Where recordings go: a folder per project, holding a session folder per take. CHORD_RECORDINGS_FOLDER overrides. */
export function recordingsFolder(): string {
  return process.env.CHORD_RECORDINGS_FOLDER || join(app.getPath("videos"), "Chord");
}

const PERMISSION_NAMES: Record<PermissionKind, string> = {
  screen: "screen recording",
  microphone: "microphone",
  camera: "camera",
  accessibility: "accessibility",
};

/** Opens the recordings folder in Finder, creating it before the first recording. */
export async function openRecordingsFolder(): Promise<void> {
  const folder = recordingsFolder();
  await mkdir(folder, { recursive: true });
  const error = await shell.openPath(folder);
  if (error) throw new Error(error);
}

/** Records sessions with the recorder helper, in `root`, using the current recording preferences. */
export class HelperCapture implements CaptureBackend {
  #cameras: CameraSource[] = [];
  /** Open windows' ids as last listed, so pinned windows that have closed are left out. */
  #windows: number[] = [];
  /** Whether `#cameras` is from this recording's countdown. */
  #prepared = false;
  private helper: RecorderHelper;
  private preferences: () => Preferences;
  private root: string;

  constructor(helper: RecorderHelper, preferences: () => Preferences, root = recordingsFolder()) {
    this.helper = helper;
    this.preferences = preferences;
    this.root = root;
  }

  async prepare(setup: RecordingSetup): Promise<void> {
    try {
      await this.#ensurePermissions(setup);
      await this.#listSources();
      this.#prepared = true;
      const { microphones, cameras } = sessionUpdate(setup, this.#cameras, this.preferences());
      await this.helper.request("warmUp", { microphones, cameras });
    } catch (error) {
      // Starting reports what's wrong, e.g. missing permissions.
      console.warn("Could not prepare the devices:", error);
    }
  }

  async release(): Promise<void> {
    this.#prepared = false;
    await this.helper.request("warmUp", {});
  }

  async start(setup: RecordingSetup, folder: string): Promise<string> {
    await this.#ensurePermissions(setup);
    // The countdown listed them already, unless a window was pinned since.
    if (!this.#prepared || pinnedWindows(setup).some((id) => !this.#windows.includes(id)))
      await this.#listSources();
    this.#prepared = false;
    const outputDirectory = join(this.root, projectFolderName(folder));
    await mkdir(outputDirectory, { recursive: true });
    const session = await this.helper.request("startSession", {
      outputDirectory,
      ...sessionUpdate(setup, this.#cameras, this.preferences(), this.#windows),
    });
    return session.directory;
  }

  async pause(): Promise<void> {
    await this.helper.request("pauseSession");
  }
  async resume(): Promise<void> {
    await this.helper.request("resumeSession");
  }
  async addMark(): Promise<void> {
    await this.helper.request("addMark");
  }
  async stop(): Promise<void> {
    await this.helper.request("stopSession");
  }

  async update(setup: RecordingSetup): Promise<void> {
    await this.#ensurePermissions(setup);
    // A camera plugged in mid-recording needs its formats, and a window opened since needs listing to be pinned.
    if (
      activeCameraIds(setup).some((id) => !this.#cameras.some((c) => c.id === id)) ||
      pinnedWindows(setup).some((id) => !this.#windows.includes(id))
    )
      await this.#listSources();
    await this.helper.request(
      "updateSession",
      sessionUpdate(setup, this.#cameras, this.preferences(), this.#windows),
    );
  }

  async #listSources(): Promise<void> {
    const { cameras, windows } = await this.helper.request("listSources");
    this.#cameras = cameras;
    this.#windows = windows.map((w) => w.id);
  }

  async discard(directory: string): Promise<void> {
    await trashRecordings(this.root, [directory]);
  }

  /** Asks for what `setup` needs if the user hasn't decided yet; rejects naming what's missing. */
  async #ensurePermissions(setup: RecordingSetup): Promise<void> {
    const needed: PermissionKind[] = [];
    if (capturesScreen(setup) || setup.systemAudio) needed.push("screen");
    if (activeMicrophoneIds(setup).length > 0) needed.push("microphone");
    if (activeCameraIds(setup).length > 0) needed.push("camera");
    let permissions: Permissions = await this.helper.request("getPermissions");
    const missing: PermissionKind[] = [];
    for (const kind of needed) {
      // Screen recording reads as denied until granted; asking only prompts the first time.
      if (
        permissions[kind] !== "granted" &&
        (kind === "screen" || permissions[kind] === "notDetermined")
      ) {
        permissions = await this.helper.request("requestPermission", { permission: kind });
      }
      if (permissions[kind] !== "granted") missing.push(kind);
    }
    if (missing.length === 0) return;
    const names = missing.map((kind) => PERMISSION_NAMES[kind]);
    const list =
      names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    throw new Error(
      `Chord needs ${list} access. Allow it in System Settings › Privacy & Security, then try again.`,
    );
  }
}

/** Whether `path` is inside `root`, and not `root` itself. */
export function isInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Moves session folders inside `root` to the Trash, then any project folder they leave empty but for thumbnails. Anything outside
 * `root` is ignored, so a renderer can't trash other files.
 */
export async function trashRecordings(root: string, directories: unknown[]): Promise<void> {
  const parents = new Set<string>();
  for (const directory of directories) {
    if (typeof directory !== "string" || !isInside(root, directory)) continue;
    try {
      await shell.trashItem(directory);
    } catch (error) {
      // Already gone, e.g. deleted in Finder.
      console.warn(`Could not move ${directory} to the Trash:`, error);
    }
    if (isInside(root, dirname(directory))) parents.add(dirname(directory));
  }
  for (const parent of parents) {
    const left = await readdir(parent).catch(() => null);
    // Thumbnails only show its recordings, so they go with the last of them.
    if (left && left.every((name) => name === ".DS_Store" || name === THUMBNAILS_FOLDER))
      await shell.trashItem(parent).catch(() => {});
  }
}

/** Shows a session folder in Finder, if it's a recording. */
export function revealRecording(root: string, directory: unknown): void {
  if (typeof directory === "string" && isInside(root, directory)) shell.showItemInFolder(directory);
}
