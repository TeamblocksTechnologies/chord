/** Where the app is in checking for, downloading and installing an update. */
export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string }
  /** Running from source, which has nothing to update. */
  | { status: "unsupported" };

export interface UpdatesAPI {
  getState(): Promise<UpdateState>;
  check(): Promise<void>;
  download(): Promise<void>;
  /** Quits and installs the downloaded update. */
  install(): Promise<void>;
  onState(listener: (state: UpdateState) => void): () => void;
}
