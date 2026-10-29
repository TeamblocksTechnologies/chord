import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isProject, isProjectId, type ProjectChange } from "../contracts/projects.ts";
import type { Project } from "#project-document/domain/recording";

/** Edits like typing notes arrive often; each project's file is written once they pause. */
const WRITE_DELAY = 250;

/**
 * The project library: a JSON file per project in `directory`, so an edit rewrites only its project, and a file that
 * can't be read loses only that project. Windows edit their own copies and send whole changed projects; the last
 * change to a project wins.
 */
export class ProjectLibrary {
  readonly #directory: string;
  readonly #projects = new Map<string, Project>();
  readonly #writes = new Map<string, ReturnType<typeof setTimeout>>();
  /** Whether projects kept by the renderer, from before the library, have been imported or never need to be. */
  #imported: boolean;

  constructor(directory: string) {
    this.#directory = directory;
    this.#imported = existsSync(directory);
    if (!this.#imported) return;
    for (const file of readdirSync(directory)) {
      if (!file.endsWith(".json")) continue;
      try {
        const project: unknown = JSON.parse(readFileSync(join(directory, file), "utf8"));
        if (isProject(project) && `${project.id}.json` === file)
          this.#projects.set(project.id, project);
      } catch (error) {
        console.warn(`Could not read the project in ${file}`, error);
      }
    }
  }

  /** Every project, oldest first. */
  get projects(): Project[] {
    return [...this.#projects.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Imports projects kept before the library existed, the first time there are any to import. Ones already in the
   * library, e.g. created from the menu bar meanwhile, are kept. Returns the imported projects.
   */
  import(legacy: unknown): Project[] {
    if (this.#imported || !Array.isArray(legacy)) return [];
    this.#imported = true;
    const added = legacy.filter(
      (project) => isProject(project) && !this.#projects.has(project.id),
    ) as Project[];
    for (const project of added) this.#projects.set(project.id, project);
    for (const project of added) this.#write(project.id);
    // An empty library still marks the import done.
    mkdirSync(this.#directory, { recursive: true });
    return added;
  }

  /** Saves changed projects, returning the change to pass on to other windows. */
  put(projects: unknown): ProjectChange {
    const put = (Array.isArray(projects) ? projects : []).filter(isProject);
    for (const project of put) {
      this.#projects.set(project.id, project);
      this.#schedule(project.id);
    }
    return { put, removed: [] };
  }

  remove(ids: unknown): ProjectChange {
    const removed = (Array.isArray(ids) ? ids : []).filter(
      (id) => isProjectId(id) && this.#projects.has(id),
    ) as string[];
    for (const id of removed) {
      this.#projects.delete(id);
      clearTimeout(this.#writes.get(id));
      this.#writes.delete(id);
      rmSync(this.#path(id), { force: true });
    }
    return { put: [], removed };
  }

  /** Writes changes still waiting, e.g. when the app quits. */
  flush(): void {
    for (const [id, timer] of this.#writes) {
      clearTimeout(timer);
      this.#write(id);
    }
  }

  #schedule(id: string): void {
    clearTimeout(this.#writes.get(id));
    this.#writes.set(
      id,
      setTimeout(() => this.#write(id), WRITE_DELAY),
    );
  }

  #write(id: string): void {
    this.#writes.delete(id);
    const project = this.#projects.get(id);
    if (!project) return;
    try {
      mkdirSync(this.#directory, { recursive: true });
      // Atomic replacement prevents a partial project file if the app exits during a write.
      const path = this.#path(id);
      writeFileSync(`${path}.tmp`, JSON.stringify(project));
      renameSync(`${path}.tmp`, path);
    } catch (error) {
      console.error(`Could not save the project ${id}`, error);
    }
  }

  #path(id: string): string {
    return join(this.#directory, `${id}.json`);
  }
}
