import type { ProjectChange } from "#features/projects/contracts/projects";
import type { ThumbnailSet } from "#features/projects/contracts/thumbnails";
import type { Project } from "#project-document/domain/recording";

export interface ProjectsAPI {
  /**
   * Every project, oldest first, and this window's subscription to other windows' changes. The main window passes
   * the projects it kept before the library moved out of the renderer, which are imported once.
   */
  load(legacy?: Project[]): Promise<Project[]>;
  /** Saves projects this window added or changed. */
  put(projects: Project[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  /** Projects another window added, changed, or removed. */
  onChange(listener: (change: ProjectChange) => void): () => void;
}

export interface ThumbnailsAPI {
  /** The project's thumbnails; null until it has recordings and they've rendered. */
  get(projectId: string): Promise<ThumbnailSet | null>;
  /** A project's thumbnails rendered again. */
  onChange(listener: (projectId: string) => void): () => void;
}
