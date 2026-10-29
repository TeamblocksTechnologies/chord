/**
 * Encodes a GIF a frame at a time, handing back its bytes as they're done, so a long one is never held whole. Each
 * frame has its own palette, made from the pixels it changes; the rest are left transparent over the frame before,
 * and a frame that changes nothing shows the one before it for longer. Screen recordings change little from frame to
 * frame, so their GIFs stay small.
 */
import { GIFEncoder, type Palette, applyPalette, quantize } from "gifenc/dist/gifenc.esm.js";

/** How far a pixel's channels can drift from what's showing before it's drawn again: decoded video is never quite still. */
const STILL = 4;
/** Leaves a frame showing under the next, so the next's transparent pixels show it. */
const KEEP = 1;

interface Frame {
  index: Uint8Array;
  palette: Palette;
  /** The palette index left transparent, if any. */
  transparent?: number;
  /** In hundredths of a second. */
  delay: number;
}

export class GifFrames {
  readonly width: number;
  readonly height: number;
  #loop: boolean;
  #gif = GIFEncoder();
  /** The picture once the waiting frame is showing, which later frames are compared with. */
  #shown: Uint8Array | null = null;
  /** The pixels the frame being added changes, packed together. */
  #changed: Uint8Array;
  /** Which pixel each packed one is. */
  #where: Uint32Array;
  /** The last frame, kept until it's known how long it shows. */
  #waiting: Frame | null = null;
  /** Frames written, and how many bytes the first took with the GIF's header. */
  frames = 0;
  firstBytes = 0;
  #written = 0;

  constructor(width: number, height: number, loop: boolean) {
    this.width = width;
    this.height = height;
    this.#loop = loop;
    this.#changed = new Uint8Array(width * height * 4);
    this.#where = new Uint32Array(width * height);
  }

  /** Adds an opaque RGBA frame that shows for `delay` hundredths of a second. Returns the bytes finished so far. */
  add(rgba: Uint8Array | Uint8ClampedArray, delay: number): Uint8Array<ArrayBuffer> {
    const pixels = this.width * this.height;
    if (rgba.length !== pixels * 4)
      throw new Error(
        `A ${this.width} × ${this.height} frame has ${pixels * 4} bytes, not ${rgba.length}`,
      );
    const shown = this.#shown;
    if (!shown) {
      const palette = quantize(rgba, 256);
      this.#shown = Uint8Array.from(rgba);
      return this.#wait({ index: applyPalette(rgba, palette), palette, delay });
    }
    let count = 0;
    for (let pixel = 0; pixel < pixels; pixel++) {
      const at = pixel * 4;
      if (
        Math.abs(rgba[at]! - shown[at]!) <= STILL &&
        Math.abs(rgba[at + 1]! - shown[at + 1]!) <= STILL &&
        Math.abs(rgba[at + 2]! - shown[at + 2]!) <= STILL
      )
        continue;
      const to = count * 4;
      this.#changed[to] = shown[at] = rgba[at]!;
      this.#changed[to + 1] = shown[at + 1] = rgba[at + 1]!;
      this.#changed[to + 2] = shown[at + 2] = rgba[at + 2]!;
      this.#changed[to + 3] = 255;
      this.#where[count++] = pixel;
    }
    if (count === 0) {
      this.#waiting!.delay += delay;
      return new Uint8Array(0);
    }
    const changed = this.#changed.subarray(0, count * 4);
    // One color is kept for the transparent pixels.
    const palette = quantize(changed, 255);
    const packed = applyPalette(changed, palette);
    const transparent = palette.length;
    const index = new Uint8Array(pixels).fill(transparent);
    for (let i = 0; i < count; i++) index[this.#where[i]!] = packed[i]!;
    return this.#wait({ index, palette: [...palette, [0, 0, 0]], transparent, delay });
  }

  /** Ends the GIF, returning its last bytes. */
  finish(): Uint8Array<ArrayBuffer> {
    if (this.#waiting) this.#write(this.#waiting);
    this.#waiting = null;
    this.#gif.finish();
    return this.#take();
  }

  #wait(frame: Frame): Uint8Array<ArrayBuffer> {
    if (this.#waiting) this.#write(this.#waiting);
    this.#waiting = frame;
    return this.#take();
  }

  #write({ index, palette, transparent, delay }: Frame): void {
    this.#gif.writeFrame(index, this.width, this.height, {
      palette,
      delay: delay * 10,
      repeat: this.#loop ? 0 : -1,
      dispose: KEEP,
      ...(transparent !== undefined && { transparent: true, transparentIndex: transparent }),
    });
    this.frames++;
  }

  #take(): Uint8Array<ArrayBuffer> {
    const bytes = this.#gif.bytes();
    this.#gif.stream.reset();
    this.#written += bytes.length;
    if (this.frames === 1 && this.firstBytes === 0) this.firstBytes = this.#written;
    return bytes;
  }
}
