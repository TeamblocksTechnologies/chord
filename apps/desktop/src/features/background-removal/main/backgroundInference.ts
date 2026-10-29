import type { BackgroundModelId } from "../contracts/backgroundRemoval.ts";

/** Pinned model preprocessing: MODNet uses [-1,1]; BEN2 uses ImageNet means and standard deviations. */
export function backgroundInput(
  pixels: Uint8Array,
  width: number,
  height: number,
  model: BackgroundModelId,
): Float32Array {
  const count = width * height;
  if (pixels.length !== count * 4) throw new Error("Invalid camera frame size");
  const mean = model === "modnet" ? [0.5, 0.5, 0.5] : [0.485, 0.456, 0.406];
  const std = model === "modnet" ? [0.5, 0.5, 0.5] : [0.229, 0.224, 0.225];
  const tensor = new Float32Array(count * 3);
  for (let channel = 0; channel < 3; channel++) {
    for (let i = 0; i < count; i++)
      tensor[channel * count + i] =
        (pixels[i * 4 + 2 - channel]! / 255 - mean[channel]!) / std[channel]!;
  }
  return tensor;
}

export function maskDimensions(
  model: BackgroundModelId,
  width: number,
  height: number,
): { width: number; height: number } {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)))
    throw new Error("Invalid camera dimensions");
  if (model === "ben2") return { width: 1024, height: 1024 };
  // MODNet has dynamic dimensions, divisible by 32. Preserve aspect and bound memory for unusually wide cameras.
  const scale = Math.min(512 / Math.min(width, height), 1024 / Math.max(width, height));
  const rounded = (size: number) => Math.max(32, Math.round((size * scale) / 32) * 32);
  return { width: rounded(width), height: rounded(height) };
}

export function alphaBytes(values: Float32Array, count: number): Uint8Array {
  if (values.length !== count) throw new Error("The local model returned an unexpected mask size");
  const alpha = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const value = values[i]!;
    if (!Number.isFinite(value))
      throw new Error("The local model returned an invalid foreground mask");
    alpha[i] = Math.round(Math.max(0, Math.min(1, value)) * 255);
  }
  return alpha;
}
