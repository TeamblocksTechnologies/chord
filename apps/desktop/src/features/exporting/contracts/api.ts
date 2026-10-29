import type { TimedText } from "#features/transcription/domain/captions";
import type { ExportedVideo } from "#platform/contracts/desktop";

export interface ExportAPI {
  /** Names a new export of the project `name` in its project folder `folder`, returning its path. */
  create(folder: string, name: string, extension: "mp4" | "webm" | "gif"): Promise<string>;
  /** Starts writing a created file, returning its id. */
  open(path: string): Promise<number>;
  write(id: number, position: number, data: Uint8Array): Promise<void>;
  /** Finishes writing; the file is removed unless `keep`. */
  close(id: number, keep: boolean): Promise<void>;
  /** Saves the PNG `data` of the frame at `time` seconds of the project `name`, in its folder `folder`'s Exports. Returns its path. */
  saveFrame(folder: string, name: string, time: number, data: Uint8Array): Promise<string>;
  /** Puts the PNG `data` of a frame on the clipboard as an image. */
  copyFrame(data: Uint8Array): Promise<void>;
  captions(path: string, cues: TimedText[]): Promise<void>;
  /** The finished exports in the project folder `folder`, newest first. */
  list(folder: string): Promise<ExportedVideo[]>;
  /** Opens an export in the default video player. */
  play(path: string): Promise<void>;
  /** Shows an export in Finder. */
  reveal(path: string): Promise<void>;
  /** Moves an export to the Trash. */
  trash(path: string): Promise<void>;
}
