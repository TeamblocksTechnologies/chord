import { formatDuration } from "#shared/domain/format";

/** The least space between labelled ticks, in pixels. */
const TICK_SPACING = 80;
/** Room a tick's label needs after it, in pixels. */
const LABEL_WIDTH = 40;
/** The ruler's labelled and unlabelled tick intervals, in seconds. */
const INTERVALS: [major: number, minor: number][] = [
  [0.5, 0.1],
  [1, 0.25],
  [2, 0.5],
  [5, 1],
  [10, 2],
  [15, 5],
  [30, 5],
  [60, 15],
  [120, 30],
  [300, 60],
  [600, 120],
  [900, 300],
  [1800, 300],
  [3600, 900],
];

export interface Tick {
  index: number;
  /** Where it is from the timeline's start, in pixels. */
  x: number;
  label?: string;
}

/**
 * The ruler's ticks for a timeline `duration` seconds long at `scale` pixels per second, only those in the `width`
 * pixels in view from `scrollLeft`, as a long recording zoomed in is very wide.
 */
export function rulerTicks(
  scale: number,
  duration: number,
  scrollLeft: number,
  width: number,
): Tick[] {
  if (scale <= 0) return [];
  const [major, minor] =
    INTERVALS.find(([major]) => major * scale >= TICK_SPACING) ?? INTERVALS.at(-1)!;
  const perMajor = Math.round(major / minor);
  const first = Math.max(0, Math.floor(scrollLeft / scale / minor));
  const last = Math.min(
    Math.floor(duration / minor + 1e-6),
    Math.ceil((scrollLeft + width) / scale / minor),
  );
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => {
    const index = first + i;
    const x = index * minor * scale;
    const labelled = index % perMajor === 0 && x + LABEL_WIDTH <= duration * scale;
    return { index, x, label: labelled ? rulerLabel(index * minor) : undefined };
  });
}

/** `1:05`, with tenths between whole seconds. */
export function rulerLabel(time: number): string {
  const tenths = Math.round(time * 10);
  return tenths % 10 === 0
    ? formatDuration(tenths / 10)
    : `${formatDuration(Math.floor(tenths / 10))}.${tenths % 10}`;
}
