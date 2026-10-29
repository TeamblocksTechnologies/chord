/** Runs in an Electron utility process, so model loading/inference never blocks capture or the editor. */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import * as ort from "onnxruntime-node";
import type { BackgroundModelId } from "../contracts/backgroundRemoval.ts";
import { alphaBytes, backgroundInput, maskDimensions } from "./backgroundInference.ts";

export interface BackgroundWork {
  model: BackgroundModelId;
  weights: string;
  helper: string;
  files: { source: string; output: string }[];
}

const port = process.parentPort;
if (!port) throw new Error("Background inference must run in a utility process");
port.once("message", async ({ data }: { data: BackgroundWork }) => {
  let session: ort.InferenceSession | undefined;
  try {
    const options: ort.InferenceSession.SessionOptions = {
      intraOpNumThreads: 2,
      interOpNumThreads: 1,
      graphOptimizationLevel: "all",
      enableCpuMemArena: false,
      enableMemPattern: false,
    };
    // Keep BEN2's large fp16 graph unpartitioned. Disable the growing CPU arena to bound
    // individual allocations under Electron's allocator; frames are processed serially.
    try {
      session = await ort.InferenceSession.create(data.weights, {
        ...options,
        executionProviders:
          process.platform === "darwin" && data.model === "modnet" ? ["coreml", "cpu"] : ["cpu"],
      });
    } catch {
      session = await ort.InferenceSession.create(data.weights, {
        ...options,
        executionProviders: ["cpu"],
      });
    }
    for (const [index, file] of data.files.entries()) {
      const { stdout } = await promisify(execFile)(data.helper, ["info", file.source]);
      const info = JSON.parse(stdout) as { width: number; height: number; duration: number };
      if (!(info.duration > 0 && Number.isFinite(info.duration)))
        throw new Error("This camera segment has no playable duration");
      const size = maskDimensions(data.model, info.width, info.height);
      await processFile(data, file, size, session, (time) => {
        port.postMessage({
          progress: (index + Math.min(1, time / info.duration)) / data.files.length,
        });
      });
    }
    await session.release();
    session = undefined;
    port.postMessage({ done: true });
  } catch (error) {
    await session?.release().catch(() => {});
    port.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});

async function processFile(
  work: BackgroundWork,
  file: BackgroundWork["files"][number],
  size: { width: number; height: number },
  session: ort.InferenceSession,
  progress: (time: number) => void,
): Promise<void> {
  const child = spawn(
    work.helper,
    ["mask", file.source, file.output, String(size.width), String(size.height)],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let errors = "";
  child.stderr.on("data", (chunk: Buffer) => {
    errors = (errors + chunk.toString()).slice(-8000);
  });
  child.stdin.on("error", () => {}); // An exited helper is reported by its close/error event below.
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(errors.trim() || `Background video helper exited (${code})`)),
    );
  });
  // Attach rejection immediately, even if the helper exits while inference is running.
  void closed.catch(() => {});
  const read = byteReader(child.stdout);
  try {
    while (true) {
      const header = await read(12);
      const time = header.readDoubleLE(0);
      const length = header.readUInt32LE(8);
      if (length === 0) break;
      if (length !== size.width * size.height * 4)
        throw new Error("Invalid background helper frame");
      const pixels = await read(length);
      const input = new ort.Tensor(
        "float32",
        backgroundInput(pixels, size.width, size.height, work.model),
        [1, 3, size.height, size.width],
      );
      let result: ort.InferenceSession.ReturnType | undefined;
      try {
        result = await session.run({ [session.inputNames[0]!]: input });
        const output = result[session.outputNames[0]!]!;
        if (!(output.data instanceof Float32Array))
          throw new Error("The local model returned an unsupported mask");
        const mask = alphaBytes(output.data, size.width * size.height);
        if (!child.stdin.write(mask)) await once(child.stdin, "drain");
      } finally {
        input.dispose();
        for (const value of Object.values(result ?? {})) value.dispose();
      }
      progress(time);
    }
    child.stdin.end();
    await closed;
  } catch (error) {
    child.kill();
    await closed.catch(() => {});
    throw new Error(errors.trim() || (error instanceof Error ? error.message : String(error)), {
      cause: error,
    });
  }
}

/** Reads framed binary data without buffering a whole video or assuming pipe chunks match frames. */
export function byteReader(stream: AsyncIterable<Buffer>): (length: number) => Promise<Buffer> {
  const iterator = stream[Symbol.asyncIterator]();
  let pending: Buffer = Buffer.alloc(0);
  return async (length) => {
    const chunks: Buffer[] = [];
    let needed = length;
    while (needed > 0) {
      if (!pending.length) {
        const next = await iterator.next();
        if (next.done) throw new Error("The background video helper stopped before finishing");
        pending = next.value;
      }
      const take = Math.min(needed, pending.length);
      chunks.push(pending.subarray(0, take));
      pending = pending.subarray(take);
      needed -= take;
    }
    return Buffer.concat(chunks, length);
  };
}
