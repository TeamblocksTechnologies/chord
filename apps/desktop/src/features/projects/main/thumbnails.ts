import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { piecesOf, type Project } from "#project-document/domain/recording";
import {
  SEEN_SESSION_FILES,
  THUMBNAIL_FRACTIONS,
  THUMBNAIL_RENDER_VERSION,
  THUMBNAILS_FOLDER,
  THUMBNAILS_LOCK,
  THUMBNAILS_MANIFEST,
  isThumbnailFile,
  isThumbnailManifest,
  isThumbnailRender,
  seenProject,
  thumbnailFile,
  thumbnailUrl,
  type ThumbnailManifest,
  type ThumbnailRender,
  type ThumbnailSet,
} from "../contracts/thumbnails.ts";

export interface ThumbnailDependencies {
  /** Every project in the library. */
  projects(): Project[];
  /** The recordings folder; thumbnails are only kept in project folders inside it. */
  root: string;
  /** Whether rendering now would compete with something more important, like recording or exporting. */
  busy(): boolean;
  /** Draws `project`'s video at `THUMBNAIL_FRACTIONS` of it; null when it has nothing to show. */
  render(project: Project): Promise<unknown>;
  /** A project's thumbnails were rendered again. */
  changed(projectId: string): void;
  now?(): number;
}

export interface ThumbnailTiming {
  /** How often projects are checked, in milliseconds. */
  interval: number;
  /** How long after a render a project may render again, in milliseconds, however much it changes meanwhile. */
  threshold: number;
  /** How old another process's lock can get before it's taken as abandoned, in milliseconds. */
  lockExpiry: number;
  /** How long a project that failed to render waits before trying again, unless it changes, in milliseconds. */
  retry: number;
}

const TIMING: ThumbnailTiming = {
  interval: 15_000,
  threshold: 120_000,
  lockExpiry: 300_000,
  retry: 600_000,
};
/** How soon after the library changes projects are checked, in milliseconds. */
const NUDGE_DELAY = 2_000;

/**
 * Keeps each project's thumbnails in its folder's Thumbnails folder: frames of its video, drawn as it plays, and its
 * captions. Nothing tells it what changed; it checks every project now and then, and renders one again when what it's
 * drawn from no longer matches. A project with none renders straight away, so a first recording, or thumbnails deleted
 * in Finder, get some soon. After that, a project renders at most once per `threshold`.
 *
 * What it's drawn from is fingerprinted: the project as its video shows it (see `seenProject`), and the files in each
 * recording's session folder that change how it looks. Anything else that changes the video has to be added there.
 *
 * A lock file in the Thumbnails folder stops two processes on this computer (say, two builds of the app) from
 * rendering the same project at once.
 */
export class ProjectThumbnails {
  #dependencies: ThumbnailDependencies;
  #timing: ThumbnailTiming;
  #timer: ReturnType<typeof setInterval> | undefined;
  #nudge: ReturnType<typeof setTimeout> | undefined;
  #sweeping = false;
  #again = false;
  #disposed = false;
  /** Renders that failed, by project, so they aren't retried every sweep. */
  #failures = new Map<string, { fingerprint: string; at: number }>();
  /** Manifests as last read, by path, while their file is unchanged. */
  #manifests = new Map<string, { modified: number; manifest: ThumbnailManifest | null }>();

  constructor(dependencies: ThumbnailDependencies, timing: Partial<ThumbnailTiming> = {}) {
    this.#dependencies = dependencies;
    this.#timing = { ...TIMING, ...timing };
  }

  /** Checks projects from now on, starting shortly. */
  start(): void {
    if (this.#timer || this.#disposed) return;
    this.#timer = setInterval(() => void this.sweep(), this.#timing.interval);
    this.nudge();
  }

  /** Checks projects soon, e.g. when the library has changed. */
  nudge(): void {
    if (this.#disposed) return;
    clearTimeout(this.#nudge);
    this.#nudge = setTimeout(() => void this.sweep(), NUDGE_DELAY);
  }

  dispose(): void {
    this.#disposed = true;
    clearInterval(this.#timer);
    clearTimeout(this.#nudge);
  }

  /** Renders every project that's due, one at a time, most recently changed first. */
  async sweep(): Promise<void> {
    if (this.#sweeping) {
      this.#again = true;
      return;
    }
    this.#sweeping = true;
    try {
      do {
        this.#again = false;
        const projects = [...this.#dependencies.projects()].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        );
        for (const project of projects) {
          if (this.#disposed || this.#dependencies.busy()) return;
          await this.#check(project);
        }
      } while (this.#again && !this.#disposed);
    } catch (error) {
      console.error("[thumbnails]", error);
    } finally {
      this.#sweeping = false;
    }
  }

  /** The project's thumbnails, if it has a recording to show and they've rendered. */
  async get(projectId: string): Promise<ThumbnailSet | null> {
    const project = this.#dependencies.projects().find((project) => project.id === projectId);
    const folder = project && this.folder(project);
    const manifest = folder && (await this.#manifest(folder));
    if (!manifest) return null;
    return {
      duration: manifest.duration,
      aspect: manifest.aspect,
      captions: manifest.captions,
      captionStyle: manifest.captionStyle,
      frames: manifest.frames.map((frame) => ({
        url: thumbnailUrl(projectId, frame.file, manifest.fingerprint),
        time: frame.time,
      })),
    };
  }

  /** Where one of a project's thumbnail images is, if it's one. */
  path(projectId: string, file: string): string | undefined {
    if (!isThumbnailFile(file)) return undefined;
    const project = this.#dependencies.projects().find((project) => project.id === projectId);
    const folder = project && this.folder(project);
    return folder ? join(folder, THUMBNAILS_FOLDER, file) : undefined;
  }

  /** The project's folder, from where its recordings are; null until it has one in the recordings folder. */
  folder(project: Project): string | null {
    const directory = project.recordings.find((recording) => recording.directory)?.directory;
    if (!directory) return null;
    const folder = dirname(resolve(directory));
    const rel = relative(resolve(this.#dependencies.root), folder);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) ? folder : null;
  }

  /** What `project`'s thumbnails are drawn from, as a short hash. */
  async fingerprint(project: Project): Promise<string> {
    const files = await Promise.all(
      project.recordings.map((recording) =>
        recording.directory
          ? Promise.all(
              SEEN_SESSION_FILES.map((file) =>
                stat(join(recording.directory!, file)).then(
                  (info) => `${info.size}:${info.mtimeMs}`,
                  () => "-",
                ),
              ),
            )
          : null,
      ),
    );
    return createHash("sha256")
      .update(JSON.stringify([THUMBNAIL_RENDER_VERSION, seenProject(project), files]))
      .digest("hex")
      .slice(0, 24);
  }

  async #check(project: Project): Promise<void> {
    const folder = this.folder(project);
    if (!folder || !this.#playable(project)) return;
    const fingerprint = await this.fingerprint(project);
    const manifest = await this.#manifest(folder);
    const now = this.#now();
    if (manifest?.fingerprint === fingerprint) return;
    if (manifest && now - Date.parse(manifest.renderedAt) < this.#timing.threshold) return;
    const failure = this.#failures.get(project.id);
    if (failure?.fingerprint === fingerprint && now - failure.at < this.#timing.retry) return;
    await this.#render(project, folder, fingerprint);
  }

  /** Whether the project's video has a recording in it that was captured. */
  #playable(project: Project): boolean {
    const recorded = new Set(
      project.recordings.flatMap((recording) => (recording.directory ? [recording.id] : [])),
    );
    return piecesOf(project).some((piece) => recorded.has(piece.recordingId));
  }

  async #render(project: Project, folder: string, fingerprint: string): Promise<void> {
    const directory = join(folder, THUMBNAILS_FOLDER);
    await mkdir(directory, { recursive: true });
    if (!(await this.#lock(directory))) return;
    try {
      const render = await this.#dependencies.render(project);
      if (render === null) throw new Error("The project has nothing to show");
      if (!isThumbnailRender(render)) throw new Error("The thumbnails didn't render properly");
      await this.#write(directory, fingerprint, render);
      this.#failures.delete(project.id);
      this.#dependencies.changed(project.id);
    } catch (error) {
      this.#failures.set(project.id, { fingerprint, at: this.#now() });
      console.warn(
        `[thumbnails] Couldn't render the thumbnails of ${project.id}:`,
        error instanceof Error ? error.message : error,
      );
    } finally {
      await this.#unlock(directory);
    }
  }

  /** Writes each image, then the manifest, each replacing the last whole, so a set is never seen half written. */
  async #write(directory: string, fingerprint: string, render: ThumbnailRender): Promise<void> {
    const frames = render.frames.map((frame, index) => ({
      file: thumbnailFile(THUMBNAIL_FRACTIONS[index]!),
      time: frame.time,
      image: frame.image,
    }));
    for (const frame of frames) await replace(join(directory, frame.file), frame.image);
    const manifest: ThumbnailManifest = {
      version: THUMBNAIL_RENDER_VERSION,
      fingerprint,
      renderedAt: new Date(this.#now()).toISOString(),
      duration: render.duration,
      aspect: render.aspect,
      frames: frames.map(({ file, time }) => ({ file, time })),
      captions: render.captions,
      captionStyle: render.captionStyle,
    };
    await replace(join(directory, THUMBNAILS_MANIFEST), JSON.stringify(manifest));
  }

  async #manifest(folder: string): Promise<ThumbnailManifest | null> {
    const path = join(folder, THUMBNAILS_FOLDER, THUMBNAILS_MANIFEST);
    const modified = await stat(path).then(
      (info) => info.mtimeMs,
      () => null,
    );
    if (modified === null) {
      this.#manifests.delete(path);
      return null;
    }
    const cached = this.#manifests.get(path);
    if (cached?.modified === modified) return cached.manifest;
    let manifest: ThumbnailManifest | null = null;
    try {
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      if (isThumbnailManifest(parsed)) manifest = parsed;
    } catch {
      /* Unreadable: rendered again. */
    }
    this.#manifests.set(path, { modified, manifest });
    return manifest;
  }

  /** Takes the folder's lock, unless another process holds it. One left by a process that's gone is taken over. */
  async #lock(directory: string): Promise<boolean> {
    const path = join(directory, THUMBNAILS_LOCK);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await writeFile(path, JSON.stringify({ pid: process.pid, at: this.#now() }), {
          flag: "wx",
        });
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await this.#abandoned(path)))
          return false;
        await rm(path, { force: true });
      }
    }
    return false;
  }

  async #abandoned(path: string): Promise<boolean> {
    try {
      const { pid, at } = JSON.parse(await readFile(path, "utf8")) as { pid: unknown; at: unknown };
      if (typeof pid !== "number" || typeof at !== "number") return true;
      // This process renders one project at a time, so a lock of its own is left over.
      return pid === process.pid || !running(pid) || this.#now() - at > this.#timing.lockExpiry;
    } catch {
      // Unreadable, perhaps being written: abandoned only once it's old.
      const modified = await stat(path).then(
        (info) => info.mtimeMs,
        () => 0,
      );
      return this.#now() - modified > this.#timing.lockExpiry;
    }
  }

  async #unlock(directory: string): Promise<void> {
    const path = join(directory, THUMBNAILS_LOCK);
    try {
      const { pid } = JSON.parse(await readFile(path, "utf8")) as { pid: unknown };
      if (pid === process.pid) await rm(path, { force: true });
    } catch {
      /* Already gone. */
    }
  }

  #now(): number {
    return this.#dependencies.now?.() ?? Date.now();
  }
}

/** Replaces `path` with `contents` in one step. */
async function replace(path: string, contents: string | Uint8Array): Promise<void> {
  await writeFile(`${path}.tmp`, contents);
  await rename(`${path}.tmp`, path);
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Running, but someone else's.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
