import { workerTask } from "#platform/main/workerTask";
import { execFile, spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import { app } from "electron";
import { join, resolve } from "node:path";
import {
  NOISE_STRENGTH,
  type NoiseEngineId,
  type NoiseEngineStatus,
} from "../contracts/noiseReduction.ts";
import type { NoiseWork } from "./noiseWorker.ts";

export function audioBinary(): string {
  if (process.env.CHORD_AUDIO_HELPER) return process.env.CHORD_AUDIO_HELPER;
  return app.isPackaged
    ? join(process.resourcesPath, "audio-helper")
    : resolve(app.getAppPath(), "../../native/macos/.build/release/audio-helper");
}

/** Whether Apple's Sound Isolation can run on this computer, from the native helper. */
export function appleIsolationStatus(binary = audioBinary()): Promise<NoiseEngineStatus> {
  if (process.platform !== "darwin")
    return Promise.resolve({ state: "unavailable", reason: "Only on macOS" });
  return new Promise((resolve) => {
    execFile(binary, ["available"], { timeout: 10_000 }, (error, stdout) => {
      if (error) return resolve({ state: "unavailable", reason: "The audio helper isn't built" });
      try {
        const reply = JSON.parse(stdout) as { available?: unknown; reason?: unknown };
        resolve(
          reply.available === true
            ? { state: "ready" }
            : {
                state: "unavailable",
                reason:
                  typeof reply.reason === "string" ? reply.reason : "Not available on this Mac",
              },
        );
      } catch {
        resolve({ state: "unavailable", reason: "The audio helper gave an unexpected answer" });
      }
    });
  });
}

export interface NoiseJob {
  engine: NoiseEngineId;
  /** The folder DeepFilterNet3's networks are in; unused by Apple's engine. */
  folder: string | null;
  /** Decoded WAV files to clean, and where each cleaned copy goes. */
  files: { source: string; output: string }[];
}

/**
 * Cleans `job.files`. Files already made are left in place when it fails or `signal` aborts, for the caller to
 * remove; none of them is ever half-written.
 */
export async function processNoise(
  job: NoiseJob,
  signal: AbortSignal,
  progress: (value: number) => void,
  binary = audioBinary(),
): Promise<void> {
  signal.throwIfAborted();
  if (job.engine === "apple") return processWithApple(job.files, signal, progress, binary);
  if (!job.folder) throw new Error("Download DeepFilterNet3 in Settings first");
  return workerTask(
    process.env.CHORD_NOISE_WORKER ?? join(import.meta.dirname, "noiseWorker.js"),
    "Noise reduction",
    "Noise reduction stopped",
    {
      folder: job.folder,
      files: job.files,
      attenuationLimit: NOISE_STRENGTH.deepFilterAttenuationDb,
    } satisfies NoiseWork,
    signal,
    progress,
  );
}

async function processWithApple(
  files: NoiseJob["files"],
  signal: AbortSignal,
  progress: (value: number) => void,
  binary: string,
): Promise<void> {
  const sizes = await Promise.all(files.map(async (file) => (await stat(file.source)).size));
  const total = sizes.reduce((sum, size) => sum + size, 0) || 1;
  let before = 0;
  for (const [index, file] of files.entries()) {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, ["isolate", file.source, file.output, "voice"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let errors = "";
      let pending = "";
      const abort = () => child.kill();
      signal.addEventListener("abort", abort, { once: true });
      child.stderr.on("data", (chunk: Buffer) => {
        errors = (errors + chunk.toString()).slice(-4000);
      });
      child.stdout.on("data", (chunk: Buffer) => {
        const lines = (pending + chunk.toString()).split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const match = /^progress ([\d.]+)$/.exec(line);
          if (match) progress(Math.min(1, (before + Number(match[1]) * sizes[index]!) / total));
        }
      });
      child.once("error", (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      });
      child.once("close", (code) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(signal.reason);
        else if (code === 0) resolve();
        else reject(new Error(errors.trim() || `The audio helper stopped (${code})`));
      });
    }).catch(async (error: unknown) => {
      await rm(file.output, { force: true });
      throw error;
    });
    before += sizes[index]!;
  }
  progress(1);
}
