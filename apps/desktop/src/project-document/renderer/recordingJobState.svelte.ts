import { onMount } from "svelte";
import { projectStore } from "./projects.svelte.ts";
import type { Project, Recording } from "../domain/recording.ts";

interface Options<State extends { directory: string }> {
  project(): Project;
  eligible?(recording: Recording): boolean;
  load(directory: string): Promise<State>;
  subscribe(receive: (state: State) => void): () => void;
  has(directory: string): boolean;
  receive(state: State): void;
  failed?(directory: string, error: unknown): void;
}

/** Follow main-owned jobs for the current project. Domain-specific reconciliation stays in the caller. */
export function observeRecordingJobs<State extends { directory: string }>(
  options: Options<State>,
): void {
  let disposed = false;
  const requested = new Map<string, Set<string>>();
  const belongs = (directory: string) =>
    options
      .project()
      .recordings.some(
        (recording) => recording.directory === directory && (options.eligible?.(recording) ?? true),
      );
  onMount(() => {
    const off = options.subscribe((state) => {
      if (!disposed && belongs(state.directory)) options.receive(state);
    });
    return () => {
      disposed = true;
      off();
    };
  });
  $effect(() => {
    const project = options.project();
    let directories = requested.get(project.id);
    if (!directories) requested.set(project.id, (directories = new Set()));
    for (const recording of project.recordings) {
      const directory = recording.directory;
      if (!directory || !(options.eligible?.(recording) ?? true) || directories.has(directory))
        continue;
      directories.add(directory);
      const current = () => !disposed && options.project().id === project.id && belongs(directory);
      void projectStore
        .saved()
        .then(async () => {
          if (!current()) return;
          const state = await options.load(directory);
          // A live event may already have supplied a newer state while disk was being read.
          if (current() && !options.has(directory)) options.receive(state);
        })
        .catch((error: unknown) => {
          if (current() && !options.has(directory)) options.failed?.(directory, error);
        })
        .finally(() => {
          // A project left before its read completed still needs an initial read when opened again.
          if (!current()) directories.delete(directory);
        });
    }
  });
}
