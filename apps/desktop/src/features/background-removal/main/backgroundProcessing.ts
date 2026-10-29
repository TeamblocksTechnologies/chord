import { workerTask } from "#platform/main/workerTask";
import { app } from "electron";
import { join, resolve } from "node:path";
import type { BackgroundWork } from "./backgroundWorker.ts";

export function backgroundBinary(): string {
  if (process.env.CHORD_BACKGROUND_HELPER) return process.env.CHORD_BACKGROUND_HELPER;
  return app.isPackaged
    ? join(process.resourcesPath, "background-helper")
    : resolve(app.getAppPath(), "../../native/macos/.build/release/background-helper");
}

/** A utility process contains native ONNX inference; killing it closes the video helper's pipes too. */
export function processBackground(
  work: Omit<BackgroundWork, "helper">,
  signal: AbortSignal,
  progress: (value: number) => void,
): Promise<void> {
  return workerTask(
    process.env.CHORD_BACKGROUND_WORKER ?? join(import.meta.dirname, "backgroundWorker.js"),
    "Camera background removal",
    "Background processing stopped",
    { ...work, helper: backgroundBinary() },
    signal,
    progress,
  );
}
