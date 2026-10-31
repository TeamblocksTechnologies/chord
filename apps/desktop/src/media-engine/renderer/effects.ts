/**
 * Draws the pointer effects over a recording in playback, from the recorded mouse and keys, wherever they're on. They
 * look as the presenter's live overlay does (see `pointerStyle.ts`), scaled with the recorded display; shortcuts sit
 * at the bottom middle of the stage, like captions.
 */
import { spanAt, type AnnotationSpan } from "#features/editing/domain/annotations";
import type { CursorStyle, EffectKind } from "#features/editing/domain/visualLayers";
import { formatKey } from "#features/recording/domain/keys";
import {
  LASER_COLOR,
  LASER_RADIUS,
  LASER_TRAIL,
  RELEASE,
  RIPPLE,
  SETTLE,
  SHORTCUT_LIMIT,
  SHORTCUT_TIME,
  circle,
  drawHold,
  drawRipple,
  drawShortcuts,
  drawTrail,
  type TrailPoint,
} from "@teamblocks.dev/chord-ui/pointer/pointerStyle";
import { cursorAt as followedAt, drawCursor } from "./cursor.ts";
import type { PlaybackInput } from "./timeline.ts";

/** Places the recorded display on the canvas: a point lands at `(point - origin) * scale`, in canvas pixels. */
export interface Projection {
  x: number;
  y: number;
  scale: number;
}

/** What some effects need beyond their own spans. */
export interface EffectOptions {
  /** The cursor layer's style. */
  cursor?: CursorStyle;
  /** When the laser is on, in any of the recording's laser layers: it stands in for the cursor. */
  laser?: readonly AnnotationSpan[];
  /** Whether the hold ring follows the smoothed cursor, as the replacement cursor does. */
  smooth?: boolean;
}

/** How long a shortcut takes to come in and go, in seconds. */
/** One independent annotation layer, drawn at its place in the visual stack. */
export function drawEffect(
  context: CanvasRenderingContext2D,
  input: PlaybackInput,
  kind: EffectKind,
  spans: readonly AnnotationSpan[],
  time: number,
  projection: Projection,
  clickColor: string,
  options: EffectOptions = {},
): void {
  if (kind === "cursor") {
    if (spanAt(spans, time) && !(options.laser && spanAt(options.laser, time)))
      drawCursor(context, input, time, projection, options.cursor);
    return;
  }
  const point = (sample: { x: number; y: number }) => ({
    x: (sample.x - projection.x) * projection.scale,
    y: (sample.y - projection.y) * projection.scale,
  });

  if (kind === "clicks")
    for (const press of input.clicks) {
      if (press.time > time) break;
      if (!spanAt(spans, press.time)) continue;
      const since = (time - press.time) * 1000;
      if (since < RIPPLE) {
        const at = point(press);
        drawRipple(context, clickColor, at.x, at.y, since / RIPPLE, projection.scale);
      }
      const released = (time - press.end) * 1000;
      if (released < RELEASE) {
        // The ring follows the cursor while the button is held.
        const at = point(followedAt(input, Math.min(time, press.end), !!options.smooth) ?? press);
        drawHold(
          context,
          clickColor,
          at.x,
          at.y,
          Math.min(since / SETTLE, 1),
          released <= 0 ? 1 : 1 - released / RELEASE,
          projection.scale,
        );
      }
    }

  const laser = kind === "laser" ? spanAt(spans, time) : undefined;
  const head = laser && lastAtOrBefore(input.cursor, time);
  if (laser && head !== undefined && head >= 0) {
    // The trail starts no earlier than the laser was switched on, and doesn't join across a cut.
    const from = Math.max(laser.start, time - LASER_TRAIL / 1000);
    const trail: TrailPoint[] = [];
    for (let i = head; i >= 0 && input.cursor[i]!.time >= from; i--) {
      const sample = input.cursor[i]!;
      trail.unshift({ ...point(sample), life: 1 - ((time - sample.time) * 1000) / LASER_TRAIL });
      if (sample.cut) break;
    }
    const at = point(input.cursor[head]!);
    trail.push({ ...at, life: 1 });
    drawTrail(context, trail, LASER_RADIUS * projection.scale);
    context.fillStyle = `rgb(${LASER_COLOR})`;
    circle(context, at.x, at.y, LASER_RADIUS * projection.scale);
    context.fill();
  }

  if (kind !== "keys") return;
  const shortcuts = input.keys
    .filter(
      (key) =>
        key.time <= time && (time - key.time) * 1000 < SHORTCUT_TIME && spanAt(spans, key.time),
    )
    .slice(-SHORTCUT_LIMIT);
  drawShortcuts(
    context,
    shortcuts.map((key) => ({
      parts: formatKey(key.key, key.modifiers) ?? [],
      age: time - key.time,
    })),
  );
}

/** The index of the last sample at or before `time`, or -1. Samples are in time order. */
function lastAtOrBefore(samples: { time: number }[], time: number): number {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (samples[middle]!.time <= time) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}
