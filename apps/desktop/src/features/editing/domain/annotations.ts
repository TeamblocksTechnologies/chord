/**
 * Pointer effects drawn over a recording's screen: the laser pointer, click highlights and keyboard shortcuts. The
 * mouse and keys are always recorded (see `InputEvent`); what's kept with the recording is when each effect is on,
 * so they can be switched on while recording, or added, moved and removed afterwards.
 */
export type AnnotationKind = "laser" | "clicks" | "keys";

export const ANNOTATION_KINDS: readonly AnnotationKind[] = ["laser", "clicks", "keys"];

/** When an effect is on, in seconds of recorded time. */
export interface AnnotationSpan {
  start: number;
  end: number;
}

/** Each effect's spans, in order, apart from one another. */
export type Annotations = Record<AnnotationKind, AnnotationSpan[]>;

/** Spans shorter than this, in seconds, are dropped. */
const SHORTEST = 0.05;

export function noAnnotations(): Annotations {
  return { laser: [], clicks: [], keys: [] };
}

/** Whether `value` is a set of spans as stored. */
export function isAnnotations(value: unknown): value is Annotations {
  if (!value || typeof value !== "object") return false;
  return ANNOTATION_KINDS.every((kind) => {
    const spans = (value as Partial<Annotations>)[kind];
    return (
      Array.isArray(spans) &&
      spans.every((span) => Number.isFinite(span?.start) && Number.isFinite(span?.end))
    );
  });
}

/** `spans` in order within `0...duration`, with overlapping or touching spans joined and tiny ones dropped. */
export function normalizeSpans(
  spans: readonly AnnotationSpan[],
  duration = Infinity,
): AnnotationSpan[] {
  const clamped = spans
    .map(({ start, end }) => ({
      start: Math.max(0, Math.min(start, end)),
      end: Math.min(duration, Math.max(start, end)),
    }))
    .filter(({ start, end }) => end - start >= SHORTEST)
    .sort((a, b) => a.start - b.start);
  const joined: AnnotationSpan[] = [];
  for (const span of clamped) {
    const last = joined.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else joined.push({ ...span });
  }
  return joined;
}

/** The span on at `time`, if any. */
export function spanAt(spans: readonly AnnotationSpan[], time: number): AnnotationSpan | undefined {
  return spans.find((span) => time >= span.start && time < span.end);
}
