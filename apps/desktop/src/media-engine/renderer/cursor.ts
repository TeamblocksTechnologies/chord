/**
 * The replacement cursor: drawn from the recorded mouse, in the shape the system cursor had, over the recording's
 * screen. Whatever the recording's own pixels show is left alone, so a cursor recorded into them still shows beneath.
 *
 * Smoothing is worked out once for a recording's whole timeline, using samples either side of each moment, so the
 * path is the same however playback seeks or whatever frame rate draws it. It never runs across a cut or a jump, and
 * lands on the recorded position whenever a button is down, so clicks and drags stay on what they hit.
 */
import { DEFAULT_CURSOR_STYLE, type CursorStyle } from "#features/editing/domain/visualLayers";
import type { Projection } from "./effects.ts";
import type { CursorSample, PlaybackInput, ShapeSample } from "./timeline.ts";

/** The smoothing's reach: a gaussian's standard deviation, in seconds. */
export const SMOOTHING = 0.05;
/** How far apart the smoothed path's points are, in seconds. */
const STEP = 1 / 120;
/** How long the path takes to blend from smoothed to recorded around a press, in seconds. */
const ANCHOR_BLEND = 0.12;
/** A move further than this between samples, in points, is a jump the path doesn't smooth across. */
const JUMP = 800;
/** How long the cursor waits still before hiding, when it hides while idle, and how long it fades. In seconds. */
export const IDLE = 1.5;
const FADE_OUT = 0.3;
const FADE_IN = 0.12;

/** A stretch of the smoothed path, sampled every `STEP` from `start`. */
interface Run {
  start: number;
  x: Float64Array;
  y: Float64Array;
}

interface Interval {
  start: number;
  end: number;
}

/** Everything worked out once per timeline. */
interface Paths {
  runs: Run[];
  /** When a button is down, joined where they overlap. */
  holds: Interval[];
  /** When the cursor is moving or clicking, with gaps shorter than `IDLE` joined. `fade` is false where it appears at once. */
  active: (Interval & { fade: boolean })[];
}

const paths = new WeakMap<PlaybackInput, Paths>();

function pathsOf(input: PlaybackInput): Paths {
  let found = paths.get(input);
  if (!found) {
    const holds = joined(input.clicks.map((press) => ({ start: press.time, end: press.end })));
    found = { runs: smoothRuns(input.cursor), holds, active: activity(input) };
    paths.set(input, found);
  }
  return found;
}

/** Where the cursor was at `time`, as recorded. */
export function rawCursorAt(input: PlaybackInput, time: number): CursorSample | undefined {
  return input.cursor[lastAtOrBefore(input.cursor, time)];
}

/** Where the replacement cursor is at `time`: smoothed, except on a press, or as recorded. */
export function cursorAt(
  input: PlaybackInput,
  time: number,
  smooth: boolean,
): { x: number; y: number } | undefined {
  const raw = rawCursorAt(input, time);
  if (!raw || !smooth) return raw;
  const { runs, holds } = pathsOf(input);
  const smoothed = smoothedAt(runs, time);
  if (!smoothed) return raw;
  const weight = anchorWeight(holds, time);
  return {
    x: smoothed.x + (raw.x - smoothed.x) * weight,
    y: smoothed.y + (raw.y - smoothed.y) * weight,
  };
}

/** How visible the cursor is at `time` when it hides while idle, from 0 to 1. */
export function idleOpacity(input: PlaybackInput, time: number): number {
  const { active } = pathsOf(input);
  const run = active[lastStartingBy(active, time)];
  if (!run) return 0;
  const fadeIn = run.fade ? Math.min((time - run.start) / FADE_IN, 1) : 1;
  const fadeOut = time > run.end + IDLE ? 1 - (time - run.end - IDLE) / FADE_OUT : 1;
  return Math.max(0, Math.min(fadeIn, fadeOut));
}

/** The shape the cursor had at `time`. */
export function shapeAt(input: PlaybackInput, time: number): ShapeSample | undefined {
  return input.shapes?.[lastAtOrBefore(input.shapes, time)];
}

/** Draws the replacement cursor at `time`, its hotspot where the cursor was. */
export function drawCursor(
  context: CanvasRenderingContext2D,
  input: PlaybackInput,
  time: number,
  projection: Projection,
  style: CursorStyle = DEFAULT_CURSOR_STYLE,
): void {
  const at = cursorAt(input, time, style.smooth);
  if (!at) return;
  const opacity = style.hideWhenIdle ? idleOpacity(input, time) : 1;
  if (opacity <= 0) return;
  const x = (at.x - projection.x) * projection.scale;
  const y = (at.y - projection.y) * projection.scale;
  const scale = projection.scale * style.size;
  const shape = shapeAt(input, time);
  const image = shape?.image ? input.images?.[shape.image] : undefined;
  context.save();
  context.globalAlpha *= opacity;
  if (shape && image) {
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      x - shape.hotspotX * scale,
      y - shape.hotspotY * scale,
      shape.width * scale,
      shape.height * scale,
    );
  } else {
    drawArrow(context, x, y, scale);
  }
  context.restore();
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

/**
 * The recorded path in stretches between cuts and jumps, each resampled every `STEP` and blurred by a gaussian of
 * `SMOOTHING`, weighed within its stretch so its ends aren't pulled towards what's beyond them.
 */
export function smoothRuns(samples: CursorSample[]): Run[] {
  const runs: Run[] = [];
  let first = 0;
  for (let i = 1; i <= samples.length; i++) {
    const sample = samples[i];
    const previous = samples[i - 1]!;
    if (sample && !sample.cut && Math.hypot(sample.x - previous.x, sample.y - previous.y) <= JUMP)
      continue;
    const start = samples[first]!.time;
    // A stretch lasts until the next begins; the last, until its final move has settled.
    const end = sample ? sample.time : previous.time + 4 * SMOOTHING;
    runs.push(smoothRun(samples, first, i, start, end));
    first = i;
  }
  return runs;
}

function smoothRun(
  samples: CursorSample[],
  from: number,
  to: number,
  start: number,
  end: number,
): Run {
  const count = Math.max(1, Math.floor((end - start) / STEP) + 1);
  const rawX = new Float64Array(count);
  const rawY = new Float64Array(count);
  let index = from;
  for (let i = 0; i < count; i++) {
    const time = start + i * STEP;
    while (index + 1 < to && samples[index + 1]!.time <= time) index++;
    rawX[i] = samples[index]!.x;
    rawY[i] = samples[index]!.y;
  }
  const reach = Math.ceil((3 * SMOOTHING) / STEP);
  const weights = Array.from({ length: reach + 1 }, (_, k) =>
    Math.exp(-((k * STEP) ** 2) / (2 * SMOOTHING ** 2)),
  );
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    let [sx, sy, total] = [0, 0, 0];
    for (let j = Math.max(0, i - reach); j <= Math.min(count - 1, i + reach); j++) {
      const weight = weights[Math.abs(i - j)]!;
      sx += rawX[j]! * weight;
      sy += rawY[j]! * weight;
      total += weight;
    }
    x[i] = sx / total;
    y[i] = sy / total;
  }
  return { start, x, y };
}

function smoothedAt(runs: Run[], time: number): { x: number; y: number } | undefined {
  const run = runs[lastStartingBy(runs, time)];
  if (!run) return undefined;
  const at = (time - run.start) / STEP;
  const i = Math.floor(at);
  if (i >= run.x.length - 1) return undefined;
  const t = at - i;
  return {
    x: run.x[i]! + (run.x[i + 1]! - run.x[i]!) * t,
    y: run.y[i]! + (run.y[i + 1]! - run.y[i]!) * t,
  };
}

/** 1 while a button is down, easing to 0 within `ANCHOR_BLEND` either side. */
export function anchorWeight(holds: Interval[], time: number): number {
  const i = lastStartingBy(holds, time);
  const before = holds[i];
  const after = holds[i + 1];
  if (before && time <= before.end) return 1;
  const distance = Math.min(
    before ? time - before.end : Infinity,
    after ? after.start - time : Infinity,
  );
  if (distance >= ANCHOR_BLEND) return 0;
  const t = 1 - distance / ANCHOR_BLEND;
  return t * t * (3 - 2 * t);
}

/** Intervals in order, with overlapping ones joined. */
function joined(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const result: Interval[] = [];
  for (const interval of sorted) {
    const last = result.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else result.push({ ...interval });
  }
  return result;
}

/**
 * When the cursor is in use: each move and press, joined across stillness shorter than `IDLE`. Cuts aren't moves;
 * only the timeline's start shows the cursor without a move, and without fading in.
 */
function activity(input: PlaybackInput): Paths["active"] {
  const moments = [
    ...input.cursor
      .filter((sample, i) => i === 0 || !sample.cut)
      .map((sample, i) => ({ start: sample.time, end: sample.time, fade: i !== 0 })),
    ...input.clicks.map((press) => ({ start: press.time, end: press.end, fade: true })),
  ].sort((a, b) => a.start - b.start);
  const runs: Paths["active"] = [];
  for (const moment of moments) {
    const last = runs.at(-1);
    if (last && moment.start <= last.end + IDLE) last.end = Math.max(last.end, moment.end);
    else runs.push({ ...moment });
  }
  return runs;
}

/** The index of the last sample at or before `time`, or -1. Samples are in time order. */
function lastAtOrBefore(samples: readonly { time: number }[], time: number): number {
  return lastBy(samples, time, (sample) => sample.time);
}

/** The index of the last of `items`, in order of `start`, starting at or before `time`, or -1. */
function lastStartingBy(items: readonly { start: number }[], time: number): number {
  return lastBy(items, time, (item) => item.start);
}

function lastBy<T>(items: readonly T[], time: number, at: (item: T) => number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (at(items[middle]!) <= time) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}
