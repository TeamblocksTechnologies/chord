import { observeRecordingJobs } from "#project-document/renderer/recordingJobState.svelte";
import type { TranscriptionState } from "../domain/captions.ts";
import type { Project } from "#project-document/domain/recording";

/** Local reactive view of main's recording jobs. No project writes, so text edits can't race timeline saves. */
export class Transcriptions {
  states = $state<Record<string, TranscriptionState>>({});
  constructor(project: () => Project) {
    observeRecordingJobs({
      project,
      load: (directory) => window.chord.desktop.transcription.get(directory),
      subscribe: (receive) => window.chord.desktop.transcription.onChange(receive),
      has: (directory) => !!this.states[directory],
      receive: (state) => {
        this.states[state.directory] = state;
      },
      failed: (directory, error) => {
        this.states[directory] = { directory, phase: "failed", error: String(error) };
      },
    });
  }

  async run(directory: string, timingOnly = false): Promise<void> {
    const previous = this.states[directory];
    if (previous?.phase === "queued" || previous?.phase === "transcribing") return;
    this.states[directory] = {
      ...previous,
      directory,
      phase: "queued",
      operation: timingOnly ? "timing" : undefined,
      error: undefined,
    };
    try {
      const state = await window.chord.desktop.transcription.start(directory, timingOnly);
      if (this.states[directory]?.phase === "queued") this.states[directory] = state;
    } catch (error) {
      this.states[directory] = {
        ...this.states[directory],
        directory,
        phase: "failed",
        error: String(error),
      };
    }
  }
}
