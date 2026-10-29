import type {
  BackgroundModelState,
  BackgroundState,
  CameraBackground,
} from "#features/background-removal/contracts/backgroundRemoval";

export interface BackgroundAPI {
  get(directory: string): Promise<BackgroundState>;
  start(directory: string): Promise<BackgroundState>;
  cancel(directory: string): Promise<void>;
  update(directory: string, patch: Partial<CameraBackground>): Promise<BackgroundState>;
  onChange(listener: (state: BackgroundState) => void): () => void;
}

export interface BackgroundModelsAPI {
  list(): Promise<BackgroundModelState[]>;
  /** Starts a download; how it goes arrives with `onChange`. */
  download(id: string): Promise<void>;
  /** Stops a download. */
  cancel(id: string): Promise<void>;
  /** Deletes a downloaded model. */
  remove(id: string): Promise<void>;
  /** Every model's state, whenever one changes. */
  onChange(listener: (models: BackgroundModelState[]) => void): () => void;
}
