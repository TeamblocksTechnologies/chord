import type { NotePage } from "#features/recording/domain/notes";
import type { LoadedSession } from "#media-engine/contracts/playback";
import type { DesktopState, FinishedRecording } from "#platform/contracts/desktop";
import type { RecordingSetup } from "#project-document/domain/recording";

export interface RecordingAPI {
  /** `folder` names the project's folder in the recordings folder, kept from its first recording. */
  start(
    setup: RecordingSetup,
    projectId?: string,
    notes?: NotePage[],
    folder?: string,
  ): Promise<void>;
  quickStart(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  addMark(): Promise<void>;
  /** Shows another notes page, noting when for the recording. */
  setPage(page: number): Promise<void>;
  /** Switches the laser pointer on or off. */
  setLaser(on: boolean): Promise<void>;
  /** Switches click highlighting on or off. */
  setClicks(on: boolean): Promise<void>;
  /** Switches the keyboard shortcut overlay on or off. */
  setKeys(on: boolean): Promise<void>;
  cancel(): Promise<void>;
  /** The main window saves the take; see `claimFinished`. */
  stop(): Promise<void>;
  /** Changes the live recording's setup. Rejects changes it can't make mid-recording. */
  update(patch: Partial<RecordingSetup>): Promise<DesktopState>;
  /** Takes the finished recordings waiting to be saved. Main window only. */
  claimFinished(): Promise<FinishedRecording[]>;
  /** Moves recordings' session folders to the Trash, with their project folders once empty. */
  trash(directories: string[]): Promise<void>;
  /** Shows a recording's file or session folder in Finder. */
  reveal(directory: string): Promise<void>;
  /** Reads a recording's session folder for playback, letting its media load with `mediaUrl`. */
  load(directory: string): Promise<LoadedSession>;
  /**
   * Measures a recording's `index`-th microphone or system audio track and returns the gain that levels it; null
   * when it's silent. With `clean`, measures the track's noise-reduced copy, which must exist.
   */
  levelAudio(
    directory: string,
    kind: "microphone" | "systemAudio",
    index: number,
    clean?: boolean,
  ): Promise<number | null>;
  /** Where recordings are saved, with the home folder as `~`. */
  folder(): Promise<string>;
  /** Opens the recordings folder in Finder. */
  openFolder(): Promise<void>;
}

export interface ToolbarAPI {
  show(): Promise<void>;
  hide(): Promise<void>;
}
