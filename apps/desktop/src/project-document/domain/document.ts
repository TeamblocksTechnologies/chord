import type { Project } from "./recording.ts";

/** The boundary through which features apply a logical edit to a project. */
export interface ProjectDocuments {
  change<T>(project: Project, edit: (draft: Project) => T): T;
}
