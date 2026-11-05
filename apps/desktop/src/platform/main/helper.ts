import { type ChildProcessByStdio, execFile, spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  type MethodName,
  type MethodParams,
  type MethodResult,
  type Permissions,
  type PreviewFrame,
  type RpcError,
  type RpcFailure,
  type RpcNotification,
  type RpcSuccess,
  readPreviewFrames,
} from "@teamblocks.dev/chord-recorder-protocol";
import { app } from "electron";

/** CHORD_RECORDER_HELPER overrides; dev uses the release build from `native/macos/scripts/build.sh`. */
export function helperBinary(): string {
  if (process.env.CHORD_RECORDER_HELPER) return process.env.CHORD_RECORDER_HELPER;
  if (app.isPackaged) return join(process.resourcesPath, "recorder-helper");
  return resolve(app.getAppPath(), "../../native/macos/.build/release/recorder-helper");
}

/**
 * Routes a line of the helper's stderr by the level `Log.swift` prefixes it with. `INFO` lines appear only in source
 * runs or with CHORD_HELPER_LOGS set; errors and unprefixed output, such as a crash, always appear.
 */
function logHelperLine(line: string): void {
  if (line.startsWith("INFO ")) {
    if (!app.isPackaged || process.env.CHORD_HELPER_LOGS)
      console.info(`[recorder-helper] ${line.slice(5)}`);
  } else console.error(`[recorder-helper] ${line.startsWith("ERROR ") ? line.slice(6) : line}`);
}

export class HelperRequestError extends Error {
  readonly error: RpcError;

  constructor(error: RpcError) {
    super(error.message);
    this.error = error;
  }
}

type Pending = { resolve: (result: unknown) => void; reject: (error: Error) => void };
type HelperProcess = ChildProcessByStdio<Writable, Readable, Readable>;

/**
 * The recorder helper child process, spoken to over JSON-RPC on stdio. Spawned on first use and restarted if it
 * crashes; its `ready` notification tells listeners to resend any state it lost.
 */
export class RecorderHelper {
  #process: HelperProcess | undefined;
  #pending = new Map<number, Pending>();
  #nextId = 1;
  #listeners = new Set<(notification: RpcNotification) => void>();
  #frameListeners = new Set<(frame: PreviewFrame) => void>();
  #stopping = false;
  /** Helpers replaced by `restart`, whose exit isn't a crash. */
  #retired = new WeakSet<HelperProcess>();
  readonly binary: string;

  constructor(binary: string) {
    this.binary = binary;
  }

  request<M extends MethodName>(method: M, params?: MethodParams<M>): Promise<MethodResult<M>> {
    const child = this.#start();
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined && { params }) })}\n`,
      );
    });
  }

  onNotification(listener: (notification: RpcNotification) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Display preview frames, from the helper's frame pipe. */
  onFrame(listener: (frame: PreviewFrame) => void): () => void {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  /**
   * Permissions as a newly started helper sees them, or null if it can't say. A running one can keep seeing a
   * permission allowed in System Settings since it started as denied.
   */
  probePermissions(): Promise<Permissions | null> {
    return new Promise((resolve) => {
      const child = execFile(this.binary, ["--permissions"], { timeout: 3000 }, (error, stdout) => {
        if (error) return resolve(null);
        try {
          const permissions = JSON.parse(stdout) as Permissions;
          resolve(typeof permissions?.screen === "string" ? permissions : null);
        } catch {
          resolve(null);
        }
      });
      child.stdin?.end();
    });
  }

  /**
   * Swaps in a new helper, so permissions allowed since this one started work without quitting the app. Only between
   * sessions: it finalizes any session as it exits. Its `ready` notification has listeners resend their state.
   */
  restart(): void {
    const child = this.#process;
    if (!child) return;
    this.#retired.add(child);
    this.#process = undefined;
    for (const { reject } of this.#pending.values()) reject(new Error("recorder helper restarted"));
    this.#pending.clear();
    child.stdin.end();
    this.#start();
  }

  /** Closing stdin makes the helper finalize any session and exit. */
  stop(): void {
    this.#stopping = true;
    this.#process?.stdin.end();
  }

  #start(): HelperProcess {
    if (this.#process) return this.#process;
    // The fourth pipe is the helper's file descriptor 3, for preview frames.
    const child = spawn(this.binary, [], { stdio: ["pipe", "pipe", "pipe", "pipe"] });
    this.#process = child;
    const feed = readPreviewFrames((frame) => {
      for (const listener of this.#frameListeners) listener(frame);
    });
    (child.stdio[3] as Readable).on("data", (chunk: Buffer) => feed(chunk));

    createInterface({ input: child.stderr }).on("line", logHelperLine);
    createInterface({ input: child.stdout }).on("line", (line) => this.#receive(line));

    const ended = (reason: string) => {
      if (this.#process !== child) return;
      this.#process = undefined;
      for (const { reject } of this.#pending.values())
        reject(new Error(`recorder helper ${reason}`));
      this.#pending.clear();
    };
    child.on("error", (error) => {
      console.error(`[recorder-helper] failed to start ${this.binary}: ${error.message}`);
      ended(`failed to start: ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      ended(`exited (${signal ?? code})`);
      if (this.#stopping || this.#retired.has(child)) return;
      console.error(`[recorder-helper] exited unexpectedly (${signal ?? code}); restarting`);
      setTimeout(() => this.#start(), 1000);
    });
    // Writes to a helper that died fail here rather than crashing the main process.
    child.stdin.on("error", () => {});
    return child;
  }

  #receive(line: string): void {
    let message: RpcSuccess | RpcFailure | RpcNotification;
    try {
      message = JSON.parse(line);
    } catch {
      console.error(`[recorder-helper] unreadable message: ${line}`);
      return;
    }
    if ("method" in message) {
      for (const listener of this.#listeners) listener(message);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.#pending.get(message.id);
    this.#pending.delete(message.id);
    if ("error" in message) pending?.reject(new HelperRequestError(message.error));
    else pending?.resolve(message.result);
  }
}
