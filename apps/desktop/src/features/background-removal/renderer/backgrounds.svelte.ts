import { observeRecordingJobs } from "#project-document/renderer/recordingJobState.svelte";
import type { BackgroundState, CameraBackground } from "../contracts/backgroundRemoval.ts";
import type { Project } from "#project-document/domain/recording";

/** The main process owns processing jobs and persisted per-take background settings. */
export class Backgrounds {
  states = $state<Record<string, BackgroundState>>({});
  #pending = new Map<string, Partial<CameraBackground>>();
  #sequence = new Map<string, number>();

  constructor(project: () => Project) {
    observeRecordingJobs({
      project,
      eligible: (recording) => recording.hasCamera,
      load: (directory) => window.chord.desktop.background.get(directory),
      subscribe: (receive) => window.chord.desktop.background.onChange(receive),
      has: (directory) => !!this.states[directory],
      receive: (state) => {
        this.#receive(state);
      },
      failed: (directory, error) => {
        this.states[directory] = { directory, phase: "failed", error: String(error) };
      },
    });
  }

  #receive(state: BackgroundState): void {
    const pending = this.#pending.get(state.directory);
    if (state.result && pending) state.result.settings = { ...state.result.settings, ...pending };
    this.states[state.directory] = state;
  }

  async run(directory: string): Promise<void> {
    const previous = this.states[directory];
    if (previous?.phase === "queued" || previous?.phase === "processing") return;
    this.states[directory] = { ...previous, directory, phase: "queued", error: undefined };
    try {
      const state = await window.chord.desktop.background.start(directory);
      if (this.states[directory]?.phase === "queued") this.#receive(state);
    } catch (error) {
      this.states[directory] = {
        ...this.states[directory],
        directory,
        phase: "failed",
        error: String(error),
      };
    }
  }

  update(directory: string, patch: Partial<CameraBackground>): void {
    const sequence = (this.#sequence.get(directory) ?? 0) + 1;
    this.#sequence.set(directory, sequence);
    this.#pending.set(directory, { ...this.#pending.get(directory), ...patch });
    const result = this.states[directory]?.result;
    if (result) Object.assign(result.settings, patch);
    void window.chord.desktop.background
      .update(directory, patch)
      .then(async () => {
        if (this.#sequence.get(directory) !== sequence) return;
        this.#pending.delete(directory);
        this.#receive(await window.chord.desktop.background.get(directory));
      })
      .catch((error: unknown) => {
        if (this.#sequence.get(directory) !== sequence) return;
        this.#pending.delete(directory);
        this.states[directory] = { ...this.states[directory]!, error: String(error) };
      });
  }
}
