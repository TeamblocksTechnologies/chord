/**
 * How the pointer effects look, shared by the presenter's live overlay and playback. Sizes are in points on the
 * recorded display; times in ms.
 */

export const LASER_COLOR = "255 40 40";
export const LASER_RADIUS = 4;
/** How long a trail point takes to fade out. */
export const LASER_TRAIL = 450;

export const CLICK_RADIUS = 18;
/** How long a click's ripple takes to spread and fade. */
export const RIPPLE = 500;
export const RIPPLE_RADIUS = 44;
/** How long the hold ring takes to fade after release. */
export const RELEASE = 180;
/** How long the hold ring takes to settle in from the ripple's start. */
export const SETTLE = 120;

/** How long a shortcut stays on screen, and how many show at once. */
export const SHORTCUT_TIME = 1800;
export const SHORTCUT_LIMIT = 3;
/** Seconds a shortcut takes to rise in, and to fade out at the end. */
const SHORTCUT_IN = 0.2;
const SHORTCUT_OUT = 0.26;

/** A point of the laser's trail. `life` runs from 1 at the head to 0 where it has faded. */
export interface TrailPoint {
  x: number;
  y: number;
  life: number;
}

/**
 * The trail as one filled shape, tapering to nothing at its tail. A single opaque fill leaves no overlaps to show
 * as dots, and the curves run through the midpoints of the samples, which arrive unevenly, to smooth them.
 */
export function drawTrail(
  context: CanvasRenderingContext2D,
  trail: TrailPoint[],
  radius: number,
): void {
  if (trail.length < 2) return;
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  let nx = 0;
  let ny = 0;
  trail.forEach((point, i) => {
    const before = trail[Math.max(i - 1, 0)]!;
    const after = trail[Math.min(i + 1, trail.length - 1)]!;
    const length = Math.hypot(after.x - before.x, after.y - before.y);
    if (length > 0) {
      nx = -(after.y - before.y) / length;
      ny = (after.x - before.x) / length;
    }
    const half = radius * point.life;
    left.push({ x: point.x + nx * half, y: point.y + ny * half });
    right.push({ x: point.x - nx * half, y: point.y - ny * half });
  });
  right.reverse();
  context.beginPath();
  for (const side of [left, right]) {
    context[side === left ? "moveTo" : "lineTo"](side[0]!.x, side[0]!.y);
    for (let i = 1; i < side.length - 1; i++) {
      context.quadraticCurveTo(
        side[i]!.x,
        side[i]!.y,
        (side[i]!.x + side[i + 1]!.x) / 2,
        (side[i]!.y + side[i + 1]!.y) / 2,
      );
    }
    context.lineTo(side[side.length - 1]!.x, side[side.length - 1]!.y);
  }
  context.closePath();
  context.fillStyle = `rgb(${LASER_COLOR})`;
  context.fill();
}

export function circle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
): void {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
}

/** A click's ripple, `progress` of the way through spreading and fading. */
export function drawRipple(
  context: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  progress: number,
  scale = 1,
): void {
  const eased = 1 - (1 - progress) ** 3;
  context.strokeStyle = `rgb(from ${color} r g b / ${0.8 * (1 - progress)})`;
  context.lineWidth = (3 * (1 - progress) + 1) * scale;
  circle(context, x, y, (CLICK_RADIUS + (RIPPLE_RADIUS - CLICK_RADIUS) * eased) * scale);
  context.stroke();
}

/** The ring held while a button is, `settle` of the way in and at `fade` opacity. */
export function drawHold(
  context: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  settle: number,
  fade: number,
  scale = 1,
): void {
  context.fillStyle = `rgb(from ${color} r g b / ${0.28 * fade * settle})`;
  context.strokeStyle = `rgb(from ${color} r g b / ${0.9 * fade * settle})`;
  context.lineWidth = 3 * scale;
  circle(context, x, y, CLICK_RADIUS * (1.25 - 0.25 * settle) * scale);
  context.fill();
  context.stroke();
}

/** The standard pointer, its tip at `x`, `y`: for recordings without shapes, or a shape whose image is missing. */
export function drawArrow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
): void {
  const points = [
    [0, 0],
    [0, 16.5],
    [4, 12.7],
    [6.6, 18.7],
    [9.3, 17.6],
    [6.8, 11.7],
    [12.2, 11.7],
  ] as const;
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.beginPath();
  points.forEach(([px, py], i) => context[i === 0 ? "moveTo" : "lineTo"](px, py));
  context.closePath();
  context.lineJoin = "round";
  context.shadowColor = "rgb(0 0 0 / 0.35)";
  context.shadowBlur = 3 * scale;
  context.shadowOffsetY = scale;
  context.strokeStyle = "white";
  context.lineWidth = 2.2;
  context.stroke();
  context.shadowColor = "transparent";
  context.fillStyle = "black";
  context.fill();
  context.restore();
}

/** Shortcuts as key caps in translucent pills, newest at the bottom, sized to the canvas. */
export function drawShortcuts(
  context: CanvasRenderingContext2D,
  shortcuts: { parts: string[]; age: number }[],
  /** The keys' text size in canvas pixels, e.g. on a canvas too small for their usual size to read. */
  textSize?: number,
): void {
  const { width, height } = context.canvas;
  const size = textSize ?? Math.max(height / 26, 10);
  const pad = { x: size * 0.66, y: size * 0.42 };
  const cap = { x: size * 0.42, y: size * 0.18, gap: size * 0.25 };
  const capHeight = size + 2 * cap.y;
  const pillHeight = capHeight + 2 * pad.y;
  context.font = `500 ${size}px "DM Sans Variable", ui-sans-serif, system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  let bottom = height - height * 0.07;
  shortcuts.reverse().forEach(({ parts, age }, i) => {
    if (parts.length === 0) return;
    const comeIn = Math.min(age / SHORTCUT_IN, 1);
    const go = Math.min((SHORTCUT_TIME / 1000 - age) / SHORTCUT_OUT, 1);
    const eased = 1 - (1 - comeIn) ** 3;
    context.globalAlpha = Math.max(0, Math.min(comeIn, go)) * (i === 0 ? 1 : 0.55);
    const widths = parts.map((part) =>
      Math.max(context.measureText(part).width + 2 * cap.x, size * 1.5),
    );
    const pillWidth =
      widths.reduce((total, w) => total + w, 0) + cap.gap * (parts.length - 1) + 2 * pad.x;
    const top = bottom - pillHeight + (1 - eased) * size;
    let x = (width - pillWidth) / 2;
    context.fillStyle = "rgb(0 0 0 / 0.5)";
    context.beginPath();
    context.roundRect(x, top, pillWidth, pillHeight, size * 0.66);
    context.fill();
    x += pad.x;
    parts.forEach((part, k) => {
      context.fillStyle = "rgb(255 255 255 / 0.15)";
      context.beginPath();
      context.roundRect(x, top + pad.y, widths[k]!, capHeight, size * 0.33);
      context.fill();
      context.fillStyle = "white";
      context.fillText(part, x + widths[k]! / 2, top + pad.y + capHeight / 2);
      x += widths[k]! + cap.gap;
    });
    bottom = top - size * 0.33;
  });
  context.globalAlpha = 1;
}
