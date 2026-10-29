import type { TranscriptHit } from "#features/transcription/contracts/transcriptSearch";
import type { TranscriptionState, WordAddress } from "#features/transcription/domain/captions";
import type { ModelState } from "#features/transcription/domain/transcription";

export interface TranscriptionAPI {
  get(directory: string): Promise<TranscriptionState>;
  /** Where the words in `query` are said across every project's recordings, most recently edited projects first. */
  search(query: string): Promise<TranscriptHit[]>;
  start(directory: string, timingOnly?: boolean): Promise<TranscriptionState>;
  cancel(directory: string): Promise<void>;
  correct(directory: string, id: string, text: string): Promise<TranscriptionState>;
  /** Retype the words from `from` through `to`, keeping their timing. */
  replace(
    directory: string,
    from: WordAddress,
    to: WordAddress,
    text: string,
  ): Promise<TranscriptionState>;
  onChange(listener: (state: TranscriptionState) => void): () => void;
}

export interface TranscriptionModelsAPI {
  /** Every model and its state, asking macOS about Apple Speech again. */
  list(): Promise<ModelState[]>;
  /** Starts a download; how it goes arrives with `onChange`. */
  download(id: string): Promise<void>;
  /** Stops a download, keeping what's done for the next. */
  cancel(id: string): Promise<void>;
  /** Deletes a downloaded model. */
  remove(id: string): Promise<void>;
  /** Transcribes mono samples with a downloaded model. Rejects with why it couldn't. */
  transcribe(id: string, samples: Float32Array, sampleRate: number): Promise<string>;
  /** Every model's state, whenever one changes. */
  onChange(listener: (models: ModelState[]) => void): () => void;
}
