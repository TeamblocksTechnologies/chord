/**
 * A recording's cleanup: stretches of it left out wherever it plays, such as filler words and long silences. Cuts are
 * on the recording's own timeline, which leaves pauses out, and close up as pauses do. The project's edit still says
 * what each piece plays on that same timeline, so a cut made while editing a recording carries into every piece of it.
 */
import {
  ANNOTATION_KINDS,
  normalizeSpans,
  type AnnotationSpan,
  type Annotations,
} from "./annotations.ts";
import type { Piece } from "#project-document/domain/recording";

export interface Cut {
  start: number;
  end: number;
}

export type CutEdge = "start" | "end";

/** Bounds for one edge in ordered, non-overlapping cuts. A collapsed draft is removed when normalized on save. */
export function cutEdgeBounds(
  cuts: readonly Cut[],
  index: number,
  edge: CutEdge,
  duration: number,
): { min: number; max: number } {
  const cut = cuts[index]!;
  return edge === "start"
    ? { min: cuts[index - 1]?.end ?? 0, max: cut.end }
    : { min: cut.start, max: cuts[index + 1]?.start ?? duration };
}

/** Move an edge without crossing its other edge or neighbouring cuts; the input is never mutated. */
export function moveCutEdge(
  cuts: readonly Cut[],
  index: number,
  edge: CutEdge,
  time: number,
  duration: number,
): Cut[] {
  const { min, max } = cutEdgeBounds(cuts, index, edge, duration);
  return cuts.map((cut, at) =>
    at === index ? { ...cut, [edge]: Math.min(max, Math.max(min, time)) } : cut,
  );
}

/** A stretch the cuts keep, from `start` to `end` on the recording's timeline; `offset` is where it starts once they close up. */
export interface Kept {
  start: number;
  end: number;
  offset: number;
}

const EPSILON = 1e-6;

export function isCut(value: unknown): value is Cut {
  if (!value || typeof value !== "object") return false;
  const cut = value as Partial<Cut>;
  return Number.isFinite(cut.start) && Number.isFinite(cut.end) && cut.end! > cut.start!;
}

/** In order, joined where they touch or overlap, leaving out empty ones and any time before the recording starts. */
export function normalizeCuts(cuts: readonly Cut[]): Cut[] {
  return cuts
    .map((cut) => ({ start: Math.max(cut.start, 0), end: cut.end }))
    .filter((cut) => cut.end - cut.start > EPSILON)
    .sort((a, b) => a.start - b.start)
    .reduce<Cut[]>((joined, cut) => {
      const last = joined.at(-1);
      if (last && cut.start <= last.end + EPSILON) last.end = Math.max(last.end, cut.end);
      else joined.push({ ...cut });
      return joined;
    }, []);
}

/** What the cuts keep of a recording `duration` long, in order. */
export function keptRanges(cuts: readonly Cut[], duration: number): Kept[] {
  const kept: Kept[] = [];
  let from = 0;
  let offset = 0;
  const keep = (to: number) => {
    if (to - from > EPSILON) {
      kept.push({ start: from, end: to, offset });
      offset += to - from;
    }
  };
  for (const cut of cuts) {
    if (cut.start >= duration) break;
    keep(cut.start);
    from = Math.max(from, cut.end);
  }
  keep(duration);
  return kept;
}

/** The cuts that leave only `kept` of a recording `duration` long: the time no stretch of it plays. */
export function cutsOutside(
  kept: readonly { start: number; end: number }[],
  duration: number,
): Cut[] {
  const played = normalizeCuts(kept);
  const cuts: Cut[] = [];
  let from = 0;
  for (const range of played) {
    if (range.start - from > EPSILON) cuts.push({ start: from, end: range.start });
    from = Math.max(from, range.end);
  }
  if (duration - from > EPSILON) cuts.push({ start: from, end: duration });
  return cuts;
}

/** Where `time` on the recording's timeline is once the cuts close up. Inside a cut, it's where the cut closes. */
export function toEdited(cuts: readonly Cut[], time: number): number {
  let removed = 0;
  for (const cut of cuts) {
    if (time <= cut.start) break;
    removed += Math.min(time, cut.end) - cut.start;
  }
  return time - removed;
}

/**
 * Where `time`, once the cuts close up, is on the recording's timeline. Where a cut closes, a piece's `start` is after
 * it and its `end` before it, so neither takes in what's cut.
 */
export function toRecorded(cuts: readonly Cut[], time: number, side: "start" | "end"): number {
  let recorded = time;
  for (const cut of cuts) {
    if (recorded < cut.start - EPSILON || (side === "end" && recorded <= cut.start + EPSILON))
      break;
    recorded += cut.end - cut.start;
  }
  return recorded;
}

/** A piece as it plays once its recording's cuts close up. */
export function editedPiece<T extends Pick<Piece, "start" | "end">>(
  piece: T,
  cuts: readonly Cut[],
): T {
  return {
    ...piece,
    start: toEdited(cuts, piece.start),
    end: piece.end === null ? null : toEdited(cuts, piece.end),
  };
}

/**
 * The stretch a piece plays, from where it's measured once its recording's cuts close up back to the recording's own
 * timeline. A piece playing to the end of what's kept plays to the end, so time put back there plays too.
 */
export function recordedPiece<T extends Pick<Piece, "start" | "end">>(
  piece: T,
  cuts: readonly Cut[],
  editedDuration: number,
): T {
  const start = piece.start <= EPSILON ? 0 : toRecorded(cuts, piece.start, "start");
  const end =
    piece.end === null || piece.end >= editedDuration - EPSILON
      ? null
      : toRecorded(cuts, piece.end, "end");
  return { ...piece, start, end };
}

/** How long a stretch of a recording `duration` long plays once its cuts close up. */
function playedLength(
  cuts: readonly Cut[],
  piece: Pick<Piece, "start" | "end">,
  duration: number,
): number {
  const end = Math.min(piece.end ?? duration, duration);
  return Math.max(0, toEdited(cuts, end) - toEdited(cuts, Math.min(piece.start, end)));
}

/**
 * The edit once `recordingId`'s cuts change from `before` to `after`. Its pieces get longer or shorter by what's put
 * back or cut in them, and pieces placed after them move with their ends, so nothing is covered and no gap opens.
 */
export function rippleCuts(
  pieces: readonly Piece[],
  recordingId: string,
  before: readonly Cut[],
  after: readonly Cut[],
  recording: (recordingId: string) => { duration: number; cuts: readonly Cut[] } | undefined,
): Piece[] {
  // Where each piece was, placed as the player places them.
  let duration = 0;
  const placed = pieces.map((piece) => {
    const source = recording(piece.recordingId);
    const length = source
      ? playedLength(
          piece.recordingId === recordingId ? before : source.cuts,
          piece,
          source.duration,
        )
      : 0;
    const from = Math.max(piece.offset ?? duration, 0);
    if (length > EPSILON) duration = Math.max(duration, from + length);
    const change =
      piece.recordingId === recordingId && source
        ? playedLength(after, piece, source.duration) - length
        : 0;
    return { piece, from, to: from + length, change };
  });
  return placed.map(({ piece, from }) => {
    if (piece.offset === undefined) return piece;
    const shift = placed.reduce(
      (total, other) =>
        other.piece !== piece && other.change !== 0 && other.to <= from + EPSILON
          ? total + other.change
          : total,
      0,
    );
    return shift === 0 ? piece : { ...piece, offset: Math.max(0, piece.offset + shift) };
  });
}

/** A recording's effects where they play once its cuts close up. A span across a cut is joined up around it. */
export function editedAnnotations(annotations: Annotations, cuts: readonly Cut[]): Annotations {
  if (cuts.length === 0) return annotations;
  return Object.fromEntries(
    ANNOTATION_KINDS.map((kind) => [kind, editedSpans(annotations[kind], cuts)]),
  ) as Annotations;
}

/** Spans of recorded time, where they are once `cuts` close up. */
export function editedSpans(
  spans: readonly AnnotationSpan[],
  cuts: readonly Cut[],
): AnnotationSpan[] {
  if (cuts.length === 0) return [...spans];
  const kept = keptRanges(cuts, Infinity);
  return normalizeSpans(
    spans.flatMap((span) =>
      kept.flatMap((range) => {
        const start = Math.max(span.start, range.start);
        const end = Math.min(span.end, range.end);
        return end - start > EPSILON
          ? [{ start: range.offset + start - range.start, end: range.offset + end - range.start }]
          : [];
      }),
    ),
  );
}
