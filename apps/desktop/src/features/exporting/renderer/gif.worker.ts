/** Encodes a GIF off the page's thread, as `GifFrames` does. Each request gets one reply, in order. */
import { GifFrames } from "./gifFrames.ts";

export type GifRequest =
  | { type: "start"; width: number; height: number; loop: boolean }
  | { type: "frame"; rgba: ArrayBuffer; delay: number }
  | { type: "finish" };

export type GifReply =
  | { type: "bytes"; bytes: Uint8Array<ArrayBuffer> }
  | { type: "done"; bytes: Uint8Array<ArrayBuffer>; frames: number; firstBytes: number }
  | { type: "error"; message: string };

let gif: GifFrames | null = null;

self.onmessage = ({ data: request }: MessageEvent<GifRequest>) => {
  const reply = (message: GifReply) =>
    self.postMessage(message, { transfer: "bytes" in message ? [message.bytes.buffer] : [] });
  try {
    if (request.type === "start") {
      gif = new GifFrames(request.width, request.height, request.loop);
      reply({ type: "bytes", bytes: new Uint8Array(0) });
    } else if (!gif) {
      throw new Error("The GIF hasn't started");
    } else if (request.type === "frame") {
      reply({ type: "bytes", bytes: gif.add(new Uint8Array(request.rgba), request.delay) });
    } else {
      const bytes = gif.finish();
      reply({ type: "done", bytes, frames: gif.frames, firstBytes: gif.firstBytes });
      gif = null;
    }
  } catch (error) {
    reply({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
