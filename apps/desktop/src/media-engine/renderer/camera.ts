/**
 * Plans a virtual camera over a `focusedWindow` recording so playback zooms in on what's shown.
 *
 * Bounds changes come in three kinds:
 * - Cut: the followed window switches (or a new segment starts). Switching windows is instant on screen, so the
 *   camera cuts too, and never looks across a cut when making room.
 * - Instant: a lone change, like a menu or popup opening or closing. The camera reacts the moment the change
 *   appears, growing or shrinking with a quick ease-out over `transition` seconds.
 * - Live: a run of per-frame changes, like a drag, resize, or window animation. The camera is locked to the bounds
 *   frame by frame so it stays in sync, rather than anticipating where the motion ends up. Recorded bounds can be
 *   a frame off the image during fast motion, so playback corrects live framing from the image (`detect.ts`).
 *
 * Times are in seconds on one timeline. Rects are in global display points.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What's shown from `time` until the next sample. `frame` is missing when nothing is. */
export interface ShownSample {
  time: number;
  frame?: Rect;
  /** The followed window. The camera cuts when it changes. */
  window?: number;
  /** Cut to this sample, e.g. at the start of a segment. */
  cut?: boolean;
}

export interface CameraOptions {
  /** Output width / height. */
  aspect: number;
  /** The recorded area. Bounds are clipped to it; it's framed when nothing is shown. */
  area: Rect;
  /** Margin around what's shown, as a share of its size on each side. */
  padding: number;
  /** Narrowest the camera gets, in points, so small windows aren't blown up. */
  minWidth: number;
  /** Changes closer together than this are one burst. */
  burstGap: number;
  /** A burst spanning longer than this is live motion; shorter is an instant change. */
  instantSpan: number;
  /** Duration of eased transitions after an instant change. */
  transition: number;
  /**
   * Live motion: bounds are read as each frame arrives, so they trail the image. The camera frames the bounds this
   * far ahead of now.
   */
  liveShift: number;
  /** Live motion: how long the camera takes to lock on when motion starts somewhere it isn't framing. */
  liveBlend: number;
  /** Simulation and sampling rate. */
  rate: number;
}

export const DEFAULT_CAMERA_OPTIONS: Omit<CameraOptions, "aspect" | "area"> = {
  padding: 0,
  minWidth: 640,
  burstGap: 0.12,
  instantSpan: 0.15,
  transition: 0.2,
  liveShift: 0.025,
  liveBlend: 0.15,
  rate: 120,
};

/** One camera state per `1 / rate` seconds from 0. */
export interface CameraPath {
  rate: number;
  /** Center x, center y, width: three numbers per sample. */
  samples: Float64Array;
  aspect: number;
  /** Times the camera cuts; it isn't interpolated across them. */
  cuts: number[];
}

/** A period where what's shown doesn't change. */
export interface Hold {
  start: number;
  end: number;
  frame: Rect;
  /** It starts with a cut. */
  cut?: boolean;
}

/** A period of live motion: from its first change until its last. */
export interface LiveSpan {
  start: number;
  end: number;
}

export interface CameraPlan {
  path: CameraPath;
  holds: Hold[];
  live: LiveSpan[];
  /** Times of instant changes. */
  instant: number[];
  cuts: number[];
}

export function planCamera(
  samples: ShownSample[],
  duration: number,
  options: CameraOptions,
): CameraPlan {
  const holds = toHolds(samples, duration, options.area);
  const { live, instant } = classify(holds, options);
  const cuts = holds.filter((hold) => hold.cut).map((hold) => hold.start);
  const path = simulate(holds, live, cuts, duration, options);
  return { path, holds, live, instant, cuts };
}

/** The camera rect at `time`, interpolated between samples. */
export function cameraAt(path: CameraPath, time: number): Rect {
  const count = path.samples.length / 3;
  const position = Math.min(Math.max(time * path.rate, 0), count - 1);
  const index = Math.floor(position);
  const next = Math.min(index + 1, count - 1);
  let fraction = position - index;
  // Show one side of a cut or the other, never a blend.
  const cut = path.cuts.find((cut) => cut > index / path.rate && cut <= next / path.rate);
  if (cut !== undefined) fraction = time < cut ? 0 : 1;
  const value = (component: number) =>
    path.samples[index * 3 + component]! * (1 - fraction) +
    path.samples[next * 3 + component]! * fraction;
  return toRect([value(0), value(1), value(2)], path.aspect);
}

/** A camera state (center x, center y, width) as a rect. */
export function toRect([cx, cy, width]: Vec3, aspect: number): Rect {
  const height = width / aspect;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/** The live span `time` is in, counting `margin` seconds either side of it. */
export function liveSpanAt(
  plan: Pick<CameraPlan, "live">,
  time: number,
  margin = 0,
): LiveSpan | undefined {
  return plan.live.find((span) => time >= span.start - margin && time <= span.end + margin);
}

/** What's shown at `time`. */
export function frameAt(holds: Hold[], time: number): Rect | undefined {
  return holds[holdIndex(holds, time)]?.frame;
}

/** Fits `frame` with padding at the camera's aspect, centered on it. As center x, center y, width. */
export function fit(
  frame: Rect,
  options: Pick<CameraOptions, "aspect" | "padding" | "minWidth">,
): Vec3 {
  let width = frame.width * (1 + 2 * options.padding);
  const height = frame.height * (1 + 2 * options.padding);
  width = Math.max(width, height * options.aspect, options.minWidth);
  return [frame.x + frame.width / 2, frame.y + frame.height / 2, width];
}

/** Center x, center y, width. */
export type Vec3 = [number, number, number];

// MARK: Holds

/**
 * Clips samples to the recorded area and merges unchanged ones. While nothing is shown, the last frame holds. A
 * hold cuts when it's marked to or the followed window changed.
 */
export function toHolds(samples: ShownSample[], duration: number, area: Rect): Hold[] {
  const sorted = [...samples].sort((a, b) => a.time - b.time);
  const clipped = sorted.map((sample) => ({
    ...sample,
    frame: sample.frame && intersect(sample.frame, area),
  }));
  let last = clipped.find((sample) => sample.frame)?.frame ?? area;
  let window: number | undefined;
  let cut = false;
  const holds: Hold[] = [];
  for (const [index, sample] of clipped.entries()) {
    const start = index === 0 ? 0 : Math.max(sample.time, 0);
    const end = Math.min(clipped[index + 1]?.time ?? duration, duration);
    last = sample.frame ?? last;
    if (
      sample.cut ||
      (sample.window !== undefined && window !== undefined && sample.window !== window)
    )
      cut = true;
    window = sample.window ?? window;
    if (end <= start) continue;
    const previous = holds.at(-1);
    if (previous && !cut && equal(previous.frame, last)) {
      previous.end = end;
    } else {
      holds.push({ start, end, frame: last, ...(cut && previous ? { cut: true } : {}) });
    }
    cut = false;
  }
  if (holds.length === 0) holds.push({ start: 0, end: Math.max(duration, 0), frame: last });
  return holds;
}

// MARK: Classification

/** Groups changes other than cuts into bursts. Cuts end bursts. */
export function classify(holds: Hold[], options: Pick<CameraOptions, "burstGap" | "instantSpan">) {
  const live: LiveSpan[] = [];
  const instant: number[] = [];
  let burst: number[] = [];
  const close = () => {
    const start = burst[0];
    const end = burst.at(-1);
    if (start !== undefined && end !== undefined) {
      if (end - start > options.instantSpan) live.push({ start, end });
      else instant.push(start);
    }
    burst = [];
  };
  for (const hold of holds.slice(1)) {
    const last = burst.at(-1);
    if (hold.cut || (last !== undefined && hold.start - last > options.burstGap)) close();
    if (!hold.cut) burst.push(hold.start);
  }
  close();
  return { live, instant };
}

// MARK: Simulation

interface Transition {
  from: Vec3;
  velocity: Vec3;
  to: Vec3;
  start: number;
}

function simulate(
  holds: Hold[],
  live: LiveSpan[],
  cuts: number[],
  duration: number,
  options: CameraOptions,
): CameraPath {
  const dt = 1 / options.rate;
  const count = Math.max(1, Math.ceil(duration * options.rate) + 1);
  const samples = new Float64Array(count * 3);

  const liveAt = (time: number) => live.find((span) => time >= span.start && time <= span.end);
  const targetAt = (time: number): Vec3 => {
    const after = cuts.find((cut) => cut > time) ?? Infinity;
    if (liveAt(time))
      return fit(frameAt(holds, Math.min(time + options.liveShift, after - 1e-6))!, options);
    return fit(frameAt(holds, time)!, options);
  };

  let position = targetAt(0);
  let velocity: Vec3 = [0, 0, 0];
  let transition: Transition | undefined;
  /** How far the camera was from framing the window when live motion started, eased out over `liveBlend`. */
  let entry: { offset: Vec3; start: number } | undefined;
  let nextCut = 0;

  for (let step = 0; step < count; step++) {
    const time = step * dt;
    const target = targetAt(time);
    let cut = false;
    while (nextCut < cuts.length && cuts[nextCut]! <= time) {
      cut = true;
      nextCut++;
    }
    if (cut) {
      position = target;
      velocity = [0, 0, 0];
      transition = { from: target, velocity, to: target, start: time };
      entry = undefined;
    } else if (liveAt(time)) {
      // Locked to the bounds. If the camera was framing something else (say, room for a menu) when the motion
      // started, that offset eases out; otherwise it's locked from the first frame.
      transition = undefined;
      if (!entry) {
        const still = fit(frameAt(holds, liveAt(time)!.start - 1e-6)!, options);
        entry = {
          offset: [position[0] - still[0], position[1] - still[1], position[2] - still[2]],
          start: time,
        };
      }
      const remaining = 1 - ease(Math.min((time - entry.start) / options.liveBlend, 1));
      position = [
        target[0] + entry.offset[0] * remaining,
        target[1] + entry.offset[1] * remaining,
        target[2] + entry.offset[2] * remaining,
      ];
      velocity = [0, 0, 0];
    } else {
      entry = undefined;
      if (!transition || !equal3(transition.to, target)) {
        transition = { from: position, velocity, to: target, start: time };
      }
      [position, velocity] = animate(transition, time, options.transition);
    }
    samples.set(position, step * 3);
  }
  return { rate: options.rate, samples, aspect: options.aspect, cuts };
}

/** Eases to rest at the transition's target over `duration`, carrying any velocity the camera had. */
function animate(transition: Transition, time: number, duration: number): [Vec3, Vec3] {
  const s = duration > 0 ? Math.min((time - transition.start) / duration, 1) : 1;
  if (s >= 1) return [[...transition.to], [0, 0, 0]];
  // Hermite basis carrying the initial velocity: starts at slope 1, ends at 0 with no displacement.
  const carry = s ** 3 - 2 * s ** 2 + s;
  const carrySlope = 3 * s ** 2 - 4 * s + 1;
  const position = [0, 0, 0] as Vec3;
  const velocity = [0, 0, 0] as Vec3;
  for (let axis = 0; axis < 3; axis++) {
    const distance = transition.to[axis]! - transition.from[axis]!;
    const initial = transition.velocity[axis]!;
    position[axis] = transition.from[axis]! + distance * ease(s) + initial * duration * carry;
    velocity[axis] = (distance * easeSlope(s)) / duration + initial * carrySlope;
  }
  return [position, velocity];
}

/** Ease-out cubic: moves off right away and settles softly, so it feels snappy. */
function ease(s: number): number {
  return 1 - (1 - s) ** 3;
}

function easeSlope(s: number): number {
  return 3 * (1 - s) ** 2;
}

// MARK: Geometry

/** The hold at `time`, by binary search. */
function holdIndex(holds: Hold[], time: number): number {
  let low = 0;
  let high = holds.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (holds[middle]!.start <= time) low = middle;
    else high = middle - 1;
  }
  return low;
}

function intersect(a: Rect, b: Rect): Rect | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

function equal(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function equal3(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
