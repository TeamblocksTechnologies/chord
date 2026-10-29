export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}
export interface Hsva {
  h: number;
  s: number;
  v: number;
  a: number;
}

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** Accept CSS hex colors, with or without #. Invalid drafts never become a color. */
export function parseHex(value: string): Rgba | null {
  let hex = value.trim().replace(/^#/, "");
  if (!/^(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(hex)) return null;
  if (hex.length <= 4) hex = [...hex].map((char) => char + char).join("");
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1,
  };
}

/** Opaque colors stay six digits; transparent colors use CSS's eight-digit hex form. */
export function toHex({ r, g, b, a }: Rgba, alpha = true): string {
  const byte = (value: number) =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}${alpha && a < 1 ? byte(a * 255) : ""}`;
}

export function toHsva({ r, g, b, a }: Rgba): Hsva {
  r /= 255;
  g /= 255;
  b /= 255;
  const v = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = v - min;
  let h = 0;
  if (delta) {
    if (v === r) h = ((g - b) / delta) % 6;
    else if (v === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: v ? delta / v : 0, v, a };
}

export function toRgba({ h, s, v, a }: Hsva): Rgba {
  const hue = (((h % 360) + 360) % 360) / 60;
  const c = v * s,
    x = c * (1 - Math.abs((hue % 2) - 1)),
    m = v - c;
  const [r, g, b] =
    hue < 1
      ? [c, x, 0]
      : hue < 2
        ? [x, c, 0]
        : hue < 3
          ? [0, c, x]
          : hue < 4
            ? [0, x, c]
            : hue < 5
              ? [x, 0, c]
              : [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    a,
  };
}
