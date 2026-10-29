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
