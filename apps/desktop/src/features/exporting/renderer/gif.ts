/**
 * Exports a project's edit, or a stretch of it, as a GIF: each frame is drawn as stills are, through the same `Stage`
 * as the preview, and encoded in a worker. GIFs have no sound, and are always opaque.
 */
import type { StreamTargetChunk } from "mediabunny";
import { type ExportOptions, type ExportSource, drawStills } from "./exporter.ts";
import GifWorker from "./gif.worker.ts?worker";
import type { GifReply, GifRequest } from "./gif.worker.ts";
import {
  type ExportRange,
  type ExportSettings,
  GIF_LONGEST,
  aspectOf,
  frameCount,
  gifDelay,
  gifSize,
  rangeWithin,
} from "./settings.ts";

/** How many frames can be waiting to be encoded, so drawing keeps ahead of the worker without frames piling up. */
const AHEAD = 3;
/** How many stretches of the range a size estimate encodes, and how long each is, in seconds. */
const SAMPLES = 3;
const SAMPLE_LENGTH = 1;

/** Exports `source`, or the range asked for, to `writable` as a GIF. Rejects, with the file left incomplete, if it fails or `signal` aborts. */
export async function exportGif(
  source: ExportSource,
  settings: ExportSettings,
  writable: WritableStream<StreamTargetChunk>,
  options: ExportOptions = {},
): Promise<void> {
  const range = gifRange(source, options.range);
  const writer = writable.getWriter();
  let position = 0;
  const write = async (bytes: Uint8Array<ArrayBuffer>) => {
    if (bytes.length === 0) return;
    const at = position;
    position += bytes.length;
    await writer.write({ type: "write", data: bytes, position: at });
  };
  const encoder = new GifEncoder();
  try {
    const frames = frameCount(range.end - range.start, settings.gifFrameRate);
    await encode(encoder, source, settings, range.start, frames, write, options);
    options.signal?.throwIfAborted();
    await write((await encoder.finish()).bytes);
    await writer.close();
  } finally {
    encoder.close();
    writer.releaseLock();
  }
}

/**
 * About how many bytes the GIF of `range` will take, from encoding a few short stretches of it: a GIF's size depends
 * on how much its picture changes, more than on its size or length.
 */
export async function estimateGifSize(
  source: ExportSource,
  settings: ExportSettings,
  range: ExportRange | null,
  signal?: AbortSignal,
): Promise<number> {
  const { start, end } = gifRange(source, range);
  const length = end - start;
  const frameRate = settings.gifFrameRate;
  const encoder = new GifEncoder();
  try {
    // A short GIF is encoded whole.
    if (length <= SAMPLES * SAMPLE_LENGTH) {
      let bytes = 0;
      await encode(
        encoder,
        source,
        settings,
        start,
        frameCount(length, frameRate),
        async (chunk) => void (bytes += chunk.length),
        { signal },
      );
      return bytes + (await encoder.finish()).bytes.length;
    }
    // Every GIF has one full first frame; the rest is measured per second.
    let first = 0;
    let rest = 0;
    let seconds = 0;
    const frames = frameCount(SAMPLE_LENGTH, frameRate);
    for (let sample = 0; sample < SAMPLES; sample++) {
      let bytes = 0;
      const at = start + ((length - SAMPLE_LENGTH) * sample) / (SAMPLES - 1);
      await encode(
        encoder,
        source,
        settings,
        at,
        frames,
        async (chunk) => void (bytes += chunk.length),
        { signal },
      );
      const done = await encoder.finish();
      bytes += done.bytes.length;
      first += done.firstBytes / SAMPLES;
      rest += bytes - done.firstBytes;
      seconds += (frames - 1) / frameRate;
    }
    return Math.round(first + (rest / seconds) * (length - 1 / frameRate));
  } finally {
    encoder.close();
  }
}

/** The range a GIF of `source` covers, which can be no longer than a GIF can be. */
function gifRange(source: ExportSource, range: ExportRange | null | undefined): ExportRange {
  const within = rangeWithin(range, source.duration);
  if (within.end - within.start > GIF_LONGEST + 1e-6)
    throw new Error(`A GIF can be at most ${GIF_LONGEST} seconds long. Choose a shorter range.`);
  return within;
}

/** Starts a GIF in `encoder` and adds `frames` frames to it from project time `start`, handing on its bytes as they're done. */
async function encode(
  encoder: GifEncoder,
  source: ExportSource,
  settings: ExportSettings,
  start: number,
  frames: number,
  write: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>,
  options: ExportOptions,
): Promise<void> {
  const aspect = aspectOf(settings.aspect, source.aspect);
  const { width, height } = gifSize(aspect, settings.gifWidth);
  const frameRate = settings.gifFrameRate;
  await encoder.start(width, height, settings.loop);
  const times = Array.from({ length: frames }, (_, frame) => start + frame / frameRate);
  const encoding: Promise<void>[] = [];
  let drawn = 0;
  let done = 0;
  try {
    await drawStills(
      source,
      width,
      height,
      times,
      async (canvas) => {
        const { data } = canvas.getContext("2d")!.getImageData(0, 0, width, height);
        encoding.push(
          encoder.frame(data.buffer, gifDelay(drawn++, frameRate)).then(async ({ bytes }) => {
            await write(bytes);
            options.onProgress?.(++done, frames);
          }),
        );
        if (encoding.length >= AHEAD) await encoding.shift();
      },
      options.signal,
      { aspect, captions: settings.captions },
    );
    await Promise.all(encoding);
  } catch (error) {
    // Frames still encoding fail with the encoder, which this failure closes.
    for (const frame of encoding) frame.catch(() => {});
    throw error;
  }
}

/** The GIF worker, asked one thing at a time; its replies come back in the order asked. */
class GifEncoder {
  #worker = new GifWorker();
  #waiting: { resolve: (reply: GifReply) => void; reject: (error: Error) => void }[] = [];

  constructor() {
    this.#worker.onmessage = ({ data }: MessageEvent<GifReply>) => {
      const waiting = this.#waiting.shift();
      if (data.type === "error") waiting?.reject(new Error(data.message));
      else waiting?.resolve(data);
    };
    this.#worker.onerror = (event) =>
      this.#fail(new Error(event.message || "The GIF encoder stopped"));
  }

  start(width: number, height: number, loop: boolean): Promise<GifReply> {
    return this.#ask({ type: "start", width, height, loop });
  }

  /** Adds a frame, taking its pixels. */
  frame(rgba: ArrayBuffer, delay: number): Promise<{ bytes: Uint8Array<ArrayBuffer> }> {
    return this.#ask({ type: "frame", rgba, delay }, [rgba]) as Promise<{
      bytes: Uint8Array<ArrayBuffer>;
    }>;
  }

  finish(): Promise<Extract<GifReply, { type: "done" }>> {
    return this.#ask({ type: "finish" }) as Promise<Extract<GifReply, { type: "done" }>>;
  }

  close(): void {
    this.#worker.terminate();
    this.#fail(new Error("The GIF encoder was closed"));
  }

  #ask(request: GifRequest, transfer: Transferable[] = []): Promise<GifReply> {
    return new Promise((resolve, reject) => {
      this.#waiting.push({ resolve, reject });
      this.#worker.postMessage(request, transfer);
    });
  }

  #fail(error: Error): void {
    for (const { reject } of this.#waiting.splice(0)) reject(error);
  }
}
