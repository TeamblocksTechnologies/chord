import type { Project } from "#project-document/domain/recording";

/** What another window changed in the project library. */
export interface ProjectChange {
  put: Project[];
  removed: string[];
}

/** Ids name the project's file, so only plain ids are accepted. */
export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{1,64}$/.test(value);
}

/** Enough of a project to store and show it; the renderer upgrades older fields when it loads one. */
export function isProject(value: unknown): value is Project {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<Project>;
  return (
    isProjectId(project.id) &&
    typeof project.name === "string" &&
    typeof project.createdAt === "string" &&
    typeof project.updatedAt === "string" &&
    Array.isArray(project.notes) &&
    Array.isArray(project.recordings) &&
    !!project.setup &&
    typeof project.setup === "object"
  );
}
