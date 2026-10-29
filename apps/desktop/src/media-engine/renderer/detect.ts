/**
 * Finds what's shown in a `focusedWindow` frame from the image itself. Everything else in the frame is fully
 * transparent, so it's the bounding box of non-transparent pixels. Recorded bounds are read as each frame arrives
 * and can be a frame behind the image during fast motion; this is exact.
 */
import type { Rect } from "./camera.ts";

/**
 * Pixels with more alpha than this (of 255) count as shown. Window shadows are captured as partly transparent
 * pixels, offset downward, and aren't part of the window; only near-opaque pixels are.
 */
const THRESHOLD = 224;
/** Analysis resolution: points per pixel. */
const POINTS_PER_PIXEL = 1;

export class ShownDetector {
  private readonly canvas = new OffscreenCanvas(1, 1);
  private readonly context = this.canvas.getContext("2d", { willReadFrequently: true })!;

  /**
   * The bounds of what `frame` shows, searched within `tolerance` points of `hint` (the recorded
   * bounds) so the cursor or other stray pixels far from it don't count. Each edge without a confident match
   * falls back to the hint's. `area` is the recorded display's frame.
   */
  detect(frame: VideoFrame, area: Rect, hint: Rect, tolerance: number): Rect | undefined {
    // The search region, in points, clipped to the display.
    const left = Math.max(area.x, hint.x - tolerance);
    const top = Math.max(area.y, hint.y - tolerance);
    const right = Math.min(area.x + area.width, hint.x + hint.width + tolerance);
    const bottom = Math.min(area.y + area.height, hint.y + hint.height + tolerance);
    if (right <= left || bottom <= top) return undefined;

    const width = Math.ceil((right - left) / POINTS_PER_PIXEL);
    const height = Math.ceil((bottom - top) / POINTS_PER_PIXEL);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    // The canvas is reused, and drawing composites over what's there: clear so old pixels don't read as shown.
    this.context.clearRect(0, 0, width, height);
    const scaleX = frame.displayWidth / area.width;
    const scaleY = frame.displayHeight / area.height;
    this.context.drawImage(
      frame,
      (left - area.x) * scaleX,
      (top - area.y) * scaleY,
      (right - left) * scaleX,
      (bottom - top) * scaleY,
      0,
      0,
      width,
      height,
    );
    const pixels = this.context.getImageData(0, 0, width, height).data;

    // Scan inward from each side, so only the margin around the window is read.
    const bright = (x: number, y: number) => pixels[(y * width + x) * 4 + 3]! > THRESHOLD;
    const rowHas = (y: number) => {
      for (let x = 0; x < width; x++) if (bright(x, y)) return true;
      return false;
    };
    let minY = 0;
    while (minY < height && !rowHas(minY)) minY++;
    if (minY === height) return undefined;
    let maxY = height - 1;
    while (!rowHas(maxY)) maxY--;
    const columnHas = (x: number) => {
      for (let y = minY; y <= maxY; y++) if (bright(x, y)) return true;
      return false;
    };
    let minX = 0;
    while (!columnHas(minX)) minX++;
    let maxX = width - 1;
    while (!columnHas(maxX)) maxX--;

    // An edge found right at the search region's limit may continue past it: trust the hint there instead.
    const edge = (found: number, limitHit: boolean, fallback: number) =>
      limitHit ? fallback : found;
    const x0 = edge(left + minX * POINTS_PER_PIXEL, minX === 0 && left > area.x, hint.x);
    const y0 = edge(top + minY * POINTS_PER_PIXEL, minY === 0 && top > area.y, hint.y);
    const x1 = edge(
      left + (maxX + 1) * POINTS_PER_PIXEL,
      maxX === width - 1 && right < area.x + area.width,
      hint.x + hint.width,
    );
    const y1 = edge(
      top + (maxY + 1) * POINTS_PER_PIXEL,
      maxY === height - 1 && bottom < area.y + area.height,
      hint.y + hint.height,
    );
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
}
