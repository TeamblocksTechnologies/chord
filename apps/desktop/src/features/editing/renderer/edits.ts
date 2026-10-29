import { projectStore } from "#project-document/renderer/projects.svelte";
import { createProjectEdits } from "../domain/commands.ts";

export const projectEdits = createProjectEdits(projectStore);
