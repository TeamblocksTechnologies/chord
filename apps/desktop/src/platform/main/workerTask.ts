import { utilityProcess } from "electron";

/** Shared lifecycle for inference workers: cancellation, progress, diagnostics, and orderly completion. */
export function workerTask(
  path: string,
  name: string,
  stopped: string,
  work: unknown,
  signal: AbortSignal,
  progress: (value: number) => void,
): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = utilityProcess.fork(path, [], {
      stdio: "pipe",
      serviceName: name,
      allowLoadingUnsignedLibraries: true,
    });
    let failure: string | undefined;
    let done = false;
    let stderr = "";
    const abort = () => worker.kill();
    signal.addEventListener("abort", abort, { once: true });
    worker.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8000);
    });
    worker.on("message", (message: { progress?: unknown; done?: unknown; error?: unknown }) => {
      if (typeof message.progress === "number" && Number.isFinite(message.progress))
        progress(Math.min(1, Math.max(0, message.progress)));
      if (message.done === true || typeof message.error === "string") {
        done = message.done === true;
        failure = typeof message.error === "string" ? message.error : undefined;
        worker.kill();
      }
    });
    worker.once("exit", (code) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(signal.reason);
      else if (done) resolve();
      else reject(new Error(failure || stderr.trim() || `${stopped} (${code})`));
    });
    worker.once("spawn", () => {
      if (signal.aborted) worker.kill();
      else worker.postMessage(work);
    });
  });
}
