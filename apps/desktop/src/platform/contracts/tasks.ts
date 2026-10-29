/** Work currently queued or running. Feature-specific results stay with their recording or model. */
export interface AppTask {
  id: string;
  kind: string;
  key: string;
  label: string;
  resource?: string;
  phase: "queued" | "running";
  progress: number | null;
  cancellable: boolean;
}
