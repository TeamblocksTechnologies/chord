import { rename, rm } from "node:fs/promises";
import {
  DEEP_FILTER_RATE,
  DeepFilter,
  type DeepFilterOptions,
  type Networks,
} from "./deepFilter.ts";
import { WavReader, WavWriter } from "#shared/main/wavFile";

const READ_FRAMES = 4800;

/**
 * Writes `output` as `source` with its noise reduced: a WAV of the same length, channels and sample rate, with every
 * sample where it was. The result is made under another name and moved into place whole, so a failure or `signal`
 * leaves no half-written file.
 */
export async function denoiseWav(
  networks: Networks,
  source: string,
  output: string,
  options: DeepFilterOptions = {},
  progress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const probe = await WavReader.open(source);
  const { channels, rate, frames } = probe;
  await probe.close();
  if (rate !== DEEP_FILTER_RATE) throw new Error("Noise reduction needs 48 kHz audio");
  const partial = `${output}.partial`;
  const writer = await WavWriter.create(partial, channels, rate);
  const failure = new AbortController();
  const stop = () => failure.abort(signal?.reason ?? new Error("Noise reduction was cancelled"));
  signal?.addEventListener("abort", stop, { once: true });
  const readers: WavReader[] = [];
  try {
    signal?.throwIfAborted();
    // The channels run side by side, each through its own reader of the file, and are written back together.
    const queues: Float32Array[][] = Array.from({ length: channels }, () => []);
    const fractions = new Array<number>(channels).fill(0);
    let flushing: Promise<void> = Promise.resolve();
    const flush = () => {
      flushing = flushing.then(async () => {
        for (;;) {
          const ready = Math.min(
            ...queues.map((queue) => queue.reduce((total, part) => total + part.length, 0)),
          );
          if (ready === 0) return;
          await writer.write(queues.map((queue) => take(queue, ready)));
        }
      });
      return flushing;
    };
    await Promise.all(
      Array.from({ length: channels }, async (_, channel) => {
        const reader = await WavReader.open(source);
        readers.push(reader);
        await new DeepFilter(networks, options).process(
          async () => {
            failure.signal.throwIfAborted();
            const read = await reader.read(READ_FRAMES);
            return read ? read[channel]! : null;
          },
          async (samples) => {
            failure.signal.throwIfAborted();
            queues[channel]!.push(samples);
            await flush();
          },
          frames,
          (fraction) => {
            fractions[channel] = fraction;
            progress?.(fractions.reduce((total, value) => total + value, 0) / channels);
          },
        );
      }).map((work) =>
        work.catch((error: unknown) => {
          failure.abort(error);
          throw error;
        }),
      ),
    );
    await flush();
    signal?.throwIfAborted();
    await Promise.all(readers.map((reader) => reader.close()));
    readers.length = 0;
    await writer.close();
    await rename(partial, output);
    progress?.(1);
  } catch (error) {
    await Promise.allSettled(readers.map((reader) => reader.close()));
    await writer.close().catch(() => {});
    await rm(partial, { force: true });
    throw error;
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}

/** The first `count` samples queued, removed from the queue. */
function take(queue: Float32Array[], count: number): Float32Array {
  const out = new Float32Array(count);
  let filled = 0;
  while (filled < count) {
    const part = queue[0]!;
    const used = Math.min(part.length, count - filled);
    out.set(part.subarray(0, used), filled);
    filled += used;
    if (used === part.length) queue.shift();
    else queue[0] = part.subarray(used);
  }
  return out;
}
