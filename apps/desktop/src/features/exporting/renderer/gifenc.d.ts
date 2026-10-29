/** The parts of gifenc (https://github.com/mattdesl/gifenc) GIF export uses; it ships no types of its own. */
declare module "gifenc/dist/gifenc.esm.js" {
  export type Palette = number[][];

  export interface FrameOptions {
    palette?: Palette;
    /** In milliseconds; written in hundredths of a second. */
    delay?: number;
    /** -1 plays once, 0 loops forever. Only the first frame's counts. */
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    /** What happens to the frame before the next is drawn: 1 leaves it showing. */
    dispose?: number;
  }

  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: FrameOptions): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
    readonly stream: { reset(): void };
  }

  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): Encoder;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: "rgb565" | "rgb444" | "rgba4444" },
  ): Palette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;
}
