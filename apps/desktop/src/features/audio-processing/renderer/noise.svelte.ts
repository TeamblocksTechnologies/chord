import { projectEdits } from "#features/editing/renderer/edits";
import { observeRecordingJobs } from "#project-document/renderer/recordingJobState.svelte";
import { audioTrackKey } from "#features/editing/domain/audioSettings";
import type { NoiseState } from "../contracts/noiseReduction.ts";
import type { Project, Recording } from "#project-document/domain/recording";

type Kind = "microphone" | "systemAudio";

/** The main process owns noise reduction jobs and their cleaned copies; this follows them for one project. */
export class NoiseStates {
  states = $state<Record<string, NoiseState>>({});
  readonly #project: () => Project;
  readonly #measuring = new Set<string>();

  constructor(project: () => Project) {
    this.#project = project;
    observeRecordingJobs({
      project,
      eligible: (recording) => recording.hasMicrophone || recording.hasSystemAudio,
      load: (directory) => window.chord.desktop.noise.get(directory),
      subscribe: (receive) => window.chord.desktop.noise.onChange(receive),
      has: (directory) => !!this.states[directory],
      receive: (state) => {
        this.#receive(state);
      },
    });
  }

  /** Reduces the noise of a track with the engine now in use. How it goes arrives as the state changes. */
  async start(directory: string, kind: Kind, index: number): Promise<void> {
    const key = audioTrackKey(kind, index);
    const before = this.states[directory];
    this.states[directory] = {
      directory,
      tracks: {
        ...before?.tracks,
        [key]: { ...before?.tracks[key], phase: "queued", progress: 0, error: undefined },
      },
    };
    try {
      this.#receive(await window.chord.desktop.noise.start(directory, kind, index));
    } catch (error) {
      const previous = before?.tracks[key]?.result;
      this.states[directory] = {
        directory,
        tracks: {
          ...before?.tracks,
          [key]: {
            phase: "failed",
            error: error instanceof Error ? error.message : String(error),
            ...(previous && { result: previous }),
          },
        },
      };
    }
  }

  async cancel(directory: string, kind: Kind, index: number): Promise<void> {
    await window.chord.desktop.noise.cancel(directory, kind, index).catch(() => {});
  }

  /**
   * Makes sure leveling, if it's on for the track, has the gain for the audio that plays: the original's, or the cleaned
   * copy's when noise reduction is on and the copy is ready. Returns false when there is nothing to level.
   */
  async ensureLevel(recording: Recording, kind: Kind, index: number): Promise<boolean> {
    const key = audioTrackKey(kind, index);
    const stored = recording.audio?.[key];
    const directory = recording.directory;
    if (!directory || !stored?.leveled) return true;
    const result = this.states[directory]?.tracks[key]?.result;
    const clean = stored.denoised === true && !!result;
    const has = (gain: number | undefined) => Number.isFinite(gain) && gain! > 0;
    if (
      clean
        ? has(stored.denoisedLevelGain) && stored.denoisedLevelFor === result.id
        : has(stored.levelGain)
    )
      return true;
    const id = `${directory}:${key}:${clean ? result.id : "original"}`;
    if (this.#measuring.has(id)) return true;
    this.#measuring.add(id);
    try {
      const gain = await window.chord.desktop.recording.levelAudio(directory, kind, index, clean);
      if (gain === null) return false;
      // The copy may have been replaced, or noise reduction turned off, while it was measured.
      const now = this.states[directory]?.tracks[key]?.result;
      const project = this.#project();
      if (clean && now?.id !== result.id) return true;
      projectEdits.setAudio(
        project,
        recording,
        kind,
        index,
        clean ? { denoisedLevelGain: gain, denoisedLevelFor: result.id } : { levelGain: gain },
      );
      return true;
    } catch {
      return true;
    } finally {
      this.#measuring.delete(id);
    }
  }

  #receive(state: NoiseState): void {
    this.states[state.directory] = state;
    const recording = this.#project().recordings.find(
      (candidate) => candidate.directory === state.directory,
    );
    if (!recording) return;
    // A cleaned copy that has just arrived may need its loudness measured, if leveling is on and noise reduction too.
    for (const [key, track] of Object.entries(state.tracks)) {
      if (track.phase !== "done" || !track.result) continue;
      const [kind, index] = key.split(":") as [Kind, string];
      void this.ensureLevel(recording, kind, Number(index));
    }
  }
}
