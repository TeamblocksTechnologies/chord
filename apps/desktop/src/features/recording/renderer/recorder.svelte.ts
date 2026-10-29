import {
  projectFolder,
  projectStore,
  quickProjectName,
} from "#project-document/renderer/projects.svelte";
import { desktop } from "#platform/renderer/desktop.svelte";
import type { Project, RecordingSetup } from "#project-document/domain/recording";

export {
  activeCameraIds,
  activeMicrophoneIds,
  recordsAnything,
} from "#project-document/domain/recording";
export type RecorderPhase = import("#platform/contracts/desktop").RecordingState["phase"];

/** Main-window facade. The main process owns the session clock; this view saves finished takes to projects. */
class Recorder {
  get phase() {
    return desktop.recording.phase;
  }
  get countdown() {
    return desktop.recording.countdown;
  }
  get elapsed() {
    return desktop.recording.elapsed;
  }
  get markCount() {
    return desktop.recording.markCount;
  }
  get page() {
    return desktop.recording.page;
  }
  get target() {
    return desktop.recording.target;
  }
  get active() {
    return this.phase !== "idle";
  }
  get project() {
    return this.target?.projectId ? projectStore.get(this.target.projectId) : undefined;
  }
  lastRecordingId = $state<string | null>(null);

  start(setup: RecordingSetup, project?: Project): void {
    // Blank pages are left out rather than shown empty.
    const notes = project?.notes.filter((page) => page.title.trim() || page.body.trim());
    void window.chord.desktop.recording.start(
      $state.snapshot(setup),
      project?.id,
      notes && $state.snapshot(notes),
      project && projectFolder(project),
    );
  }
  pause(): void {
    void window.chord.desktop.recording.pause();
  }
  resume(): void {
    void window.chord.desktop.recording.resume();
  }
  addMark(): void {
    void window.chord.desktop.recording.addMark();
  }
  setPage(page: number): void {
    void window.chord.desktop.recording.setPage(page);
  }
  cancel(): void {
    void window.chord.desktop.recording.cancel();
  }

  stop(): void {
    void window.chord.desktop.recording.stop();
  }

  /** Saves takes finished from any window to their projects, and returns the project of the last one. */
  async claimFinished(): Promise<Project | undefined> {
    let project: Project | undefined;
    for (const {
      target: { setup, startedAt, projectId, notes },
      elapsed,
      markCount,
      pageChanges,
      annotations,
      used,
      directory,
    } of await window.chord.desktop.recording.claimFinished()) {
      project =
        (projectId && projectStore.get(projectId)) ||
        projectStore.create({ name: quickProjectName(new Date(startedAt)), setup });
      const recording = {
        id: crypto.randomUUID(),
        createdAt: startedAt,
        duration: Math.round(elapsed),
        mode: used.screen ? setup.mode : null,
        hasMicrophone: used.microphone,
        hasCamera: used.camera,
        hasSystemAudio: used.systemAudio,
        markCount,
        pageChanges: pageChanges.map(({ at, page }) => ({
          at,
          pageId: notes[page].id,
          title: notes[page].title,
        })),
        annotations,
        directory,
      };
      projectStore.addRecording(project, recording);
      this.lastRecordingId = recording.id;
    }
    return project;
  }
}
export const recorder = new Recorder();
