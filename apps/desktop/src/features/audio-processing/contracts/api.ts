import type {
  NoiseEngineState,
  NoiseState,
} from "#features/audio-processing/contracts/noiseReduction";

export interface NoiseAPI {
  /** A recording's tracks that have been cleaned or are being cleaned. */
  get(directory: string): Promise<NoiseState>;
  /** Cleans the `index`-th `kind` track with the engine in use, unless a copy made with it is already there. */
  start(directory: string, kind: "microphone" | "systemAudio", index: number): Promise<NoiseState>;
  /** Stops a track's job; a copy made earlier stays. */
  cancel(directory: string, kind: "microphone" | "systemAudio", index: number): Promise<void>;
  /** A recording's state, whenever it changes. */
  onChange(listener: (state: NoiseState) => void): () => void;
}

export interface NoiseEnginesAPI {
  /** Every engine's state, asking again whether Apple's can run. */
  list(): Promise<NoiseEngineState[]>;
  /** Starts DeepFilterNet3's download; how it goes arrives with `onChange`. */
  download(id: string): Promise<void>;
  /** Stops a download. */
  cancel(id: string): Promise<void>;
  /** Deletes a downloaded engine. */
  remove(id: string): Promise<void>;
  /** Every engine's state, whenever one changes. */
  onChange(listener: (engines: NoiseEngineState[]) => void): () => void;
}
