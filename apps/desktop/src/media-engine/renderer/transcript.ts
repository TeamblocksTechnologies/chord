import {
  preciseWords,
  type TranscriptCue,
  type TimedText,
} from "#features/transcription/domain/captions";
import {
  lengthOf,
  showingOf,
  toProject,
  toRecording,
  type Part,
  type Timeline,
} from "./timeline.ts";

export interface TranscriptPlayback {
  parts: Part[];
  time: number;
  ready: boolean;
  canUndoCut?: boolean;
  timeline?: Timeline;
}
/** `item` is its index in the passage's word timings, or its text where those no longer match. */
export interface TranscriptWord extends TimedText {
  id: string;
  cueId: string;
  item: number;
  trackId: string;
  estimated: boolean;
}
/** A retained stretch of session time and where it starts in the project. */
export interface TranscriptRange {
  start: number;
  end: number;
  offset: number;
}
export interface TranscriptCut {
  start: number;
  end: number;
}

/** A transcript item's extent on the recording's timeline, leaving pauses out. */
export function transcriptRecordedSpan(
  span: TranscriptCut,
  clips: Timeline["clips"],
): TranscriptCut | undefined {
  const ranges = clips.flatMap((clip) => {
    const start = Math.max(span.start, clip.start);
    const end = Math.min(span.end, clip.start + clip.duration);
    return end > start
      ? [{ start: clip.offset + start - clip.start, end: clip.offset + end - clip.start }]
      : [];
  });
  return ranges.length ? { start: ranges[0].start, end: ranges.at(-1)!.end } : undefined;
}

export interface TranscriptCutMarker {
  index: number;
  edge: "start" | "end";
  id: string;
  progress: number;
}

/** Place both cut edges within words/silences, or at the nearest text boundary for an unshown short gap. */
export function transcriptCutMarkers(
  cuts: TranscriptCut[],
  items: (TranscriptCut & { id: string })[],
): TranscriptCutMarker[] {
  if (!items.length) return [];
  return cuts.flatMap((cut, index) =>
    (["start", "end"] as const).map((edge) => {
      const time = cut[edge];
      const contains = (item: TranscriptCut) =>
        edge === "start"
          ? time >= item.start - 1e-6 && time < item.end - 1e-6
          : time > item.start + 1e-6 && time <= item.end + 1e-6;
      const item =
        items.find(contains) ??
        items.reduce((nearest, item) => {
          const distance = (span: TranscriptCut) => Math.max(span.start - time, time - span.end, 0);
          return distance(item) < distance(nearest) ? item : nearest;
        });
      return {
        index,
        edge,
        id: item.id,
        progress: Math.min(1, Math.max(0, (time - item.start) / (item.end - item.start))),
      };
    }),
  );
}

// Media clocks round to microseconds; a seek to a word's start can land just before its boundary.
const CLOCK_ROUNDING = 1e-5;

/** Real word timings when available; approximate positions for older or corrected captions. */
export function transcriptWords(cues: TranscriptCue[]): TranscriptWord[] {
  return cues
    .flatMap((cue) => {
      const tokens = cue.text.trim().split(/\s+/).filter(Boolean);
      const precise = preciseWords(cue);
      const words =
        precise ??
        tokens.map((text, index) => ({
          text,
          start: cue.start + ((cue.end - cue.start) * index) / tokens.length,
          end: cue.start + ((cue.end - cue.start) * (index + 1)) / tokens.length,
        }));
      // Some helpers return several words in one timing item. Those still need separate seek targets.
      return words.flatMap((word, index) => {
        const text = word.text.trim().split(/\s+/);
        return text.map((token, nth) => ({
          id: `${cue.id}:${index}:${nth}`,
          cueId: cue.id,
          item: index,
          trackId: cue.trackId,
          text: token,
          estimated: !precise || text.length > 1,
          start: word.start + ((word.end - word.start) * nth) / text.length,
          end: word.start + ((word.end - word.start) * (nth + 1)) / text.length,
        }));
      });
    })
    .sort((a, b) => a.start - b.start);
}

/** Follow the visible edit, including pauses, trims, moved/duplicated pieces and overlapping recordings. */
export function transcriptRanges(parts: Part[], recordingId: string): TranscriptRange[] {
  return showingOf(parts)
    .filter(({ part }) => part.recordingId === recordingId)
    .flatMap(({ part, from, to }) =>
      part.timeline.clips.flatMap((clip) => {
        const start = Math.max(toRecording(part, from), clip.offset);
        const end = Math.min(toRecording(part, to), clip.offset + clip.duration);
        return end > start
          ? [
              {
                start: clip.start + start - clip.offset,
                end: clip.start + end - clip.offset,
                offset: toProject(part, start),
              },
            ]
          : [];
      }),
    );
}

export function wordOccurrences(
  word: TimedText,
  ranges: TranscriptRange[],
): { start: number; end: number }[] {
  return ranges.flatMap((range) => {
    const start = Math.max(word.start, range.start);
    const end = Math.min(word.end, range.end);
    return end - start > 1e-6
      ? [{ start: range.offset + start - range.start, end: range.offset + end - range.start }]
      : [];
  });
}

/** How much of a stretch of session time the edit plays at least once. */
export function keptLength(
  span: { start: number; end: number },
  ranges: TranscriptRange[],
): number {
  const intervals = ranges
    .map((range) => ({
      start: Math.max(span.start, range.start),
      end: Math.min(span.end, range.end),
    }))
    .filter(({ start, end }) => end - start > 1e-6)
    .sort((a, b) => a.start - b.start);
  let covered = 0;
  let until = span.start;
  for (const interval of intervals) {
    covered += Math.max(0, interval.end - Math.max(until, interval.start));
    until = Math.max(until, interval.end);
  }
  return covered;
}

/** A cut can fall inside a spoken word; distinguish that from removing the whole word. */
export function wordCutState(
  word: TimedText,
  ranges: TranscriptRange[],
): "kept" | "partial" | "cut" {
  const covered = keptLength(word, ranges);
  return covered === 0 ? "cut" : covered < word.end - word.start - 1e-6 ? "partial" : "kept";
}

/** Silences shorter than this aren't shown. */
export const SILENCE_MINIMUM = 0.5;
/** What's left either side of a removed silence, so the words around it aren't clipped. */
export const SILENCE_PADDING = 0.15;

/**
 * A stretch with no words, on session time. `after` is the index of the word before it, -1 before the first word.
 * `length` counts only recorded time, leaving out pauses.
 */
export interface TranscriptSilence {
  id: string;
  start: number;
  end: number;
  after: number;
  length: number;
}

/** The silences before, between and after the words, where at least `minimum` of recorded time has no speech. */
export function transcriptSilences(
  words: TranscriptWord[],
  recorded: { start: number; end: number }[],
  minimum = SILENCE_MINIMUM,
): TranscriptSilence[] {
  if (!words.length || !recorded.length) return [];
  const silences: TranscriptSilence[] = [];
  const add = (after: number, from: number, to: number) => {
    const spans = recorded
      .map((span) => ({ start: Math.max(from, span.start), end: Math.min(to, span.end) }))
      .filter(({ start, end }) => end - start > 1e-6);
    const length = spans.reduce((total, span) => total + span.end - span.start, 0);
    if (length >= minimum - 1e-6)
      silences.push({
        id: `silence:${after === -1 ? "start" : words[after].id}`,
        start: spans[0].start,
        end: spans.at(-1)!.end,
        after,
        length,
      });
  };
  add(-1, Math.min(...recorded.map((span) => span.start)), words[0].start);
  let spoken = words[0].end;
  for (let index = 1; index < words.length; index++) {
    add(index - 1, spoken, words[index].start);
    spoken = Math.max(spoken, words[index].end);
  }
  add(words.length - 1, spoken, Math.max(...recorded.map((span) => span.end)));
  return silences;
}

/** The silence playing at a session time. A seek to the next word's start can land just before it, so that's the word. */
export function silenceAt<T extends TranscriptSilence>(
  silences: T[],
  sessionTime: number,
): T | undefined {
  return silences.find(
    (silence) => sessionTime >= silence.start && sessionTime < silence.end - CLOCK_ROUNDING,
  );
}

/** What removing a silence cuts: all of it but `padding` seconds next to the words around it, at most half each. */
export function silenceCut(
  silence: TranscriptSilence,
  words: number,
  padding = SILENCE_PADDING,
): TranscriptCut {
  const kept = Math.min(Math.max(padding, 0), (silence.end - silence.start) / 2);
  return {
    start: silence.after === -1 ? silence.start : silence.start + kept,
    end: silence.after === words - 1 ? silence.end : silence.end - kept,
  };
}

/** Prefer the copy nearest the playhead when a recording is used more than once. */
export function wordSeekTime(
  occurrences: { start: number; end: number }[],
  time: number,
): number | undefined {
  return occurrences.reduce<{ start: number; distance: number } | undefined>(
    (nearest, occurrence) => {
      const distance = Math.max(occurrence.start - time, time - occurrence.end, 0);
      return !nearest || distance < nearest.distance
        ? { start: occurrence.start, distance }
        : nearest;
    },
    undefined,
  )?.start;
}

function playingRange(ranges: TranscriptRange[], time: number): TranscriptRange | undefined {
  return ranges.findLast(
    (range) =>
      time >= range.offset - CLOCK_ROUNDING && time < range.offset + range.end - range.start,
  );
}

/** The session time playing at a project time, if the recording is showing then. */
export function transcriptSessionTime(ranges: TranscriptRange[], time: number): number | undefined {
  const range = playingRange(ranges, time);
  return range && range.start + time - range.offset;
}

/** The word being spoken in the retained stretch at the playhead, holding on the last one through silence. */
export function currentTranscriptWord(
  words: TranscriptWord[],
  ranges: TranscriptRange[],
  time: number,
): string | undefined {
  return transcriptPosition(words, ranges, time)?.id;
}

/**
 * Where the playhead is in the transcript: the current word, and how far through it, from 0 at its start to 1 at its
 * end. Through silence it stays after the last word spoken.
 */
export function transcriptPosition(
  words: TranscriptWord[],
  ranges: TranscriptRange[],
  time: number,
): { id: string; progress: number } | undefined {
  const range = playingRange(ranges, time);
  if (!range) return undefined;
  const sessionTime = range.start + time - range.offset;
  const playing = words.filter(
    (word) => Math.min(word.end, range.end) - Math.max(word.start, range.start) > 1e-6,
  );
  // The last word to have started, so a silence holds after it rather than jumping ahead to the next word. Seeks to
  // a word's start can land just before it, so those count as started. Before the first word, wait at its start.
  const word = playing.findLast((word) => word.start <= sessionTime + CLOCK_ROUNDING) ?? playing[0];
  return (
    word && {
      id: word.id,
      progress: Math.min(1, Math.max(0, (sessionTime - word.start) / (word.end - word.start))),
    }
  );
}

/** Where the playhead moves when the selected stretches are closed up. Cuts must be disjoint. */
export function timeAfterTranscriptCut(time: number, cuts: TranscriptCut[]): number {
  return (
    time -
    cuts.reduce(
      (removed, cut) => removed + Math.min(Math.max(time - cut.start, 0), cut.end - cut.start),
      0,
    )
  );
}

/** Cut the selected source words wherever they play, closing the removed time across every project layer. */
export function cutTranscriptRange(
  parts: Part[],
  recordingId: string,
  start: number,
  end: number,
  newId: () => string,
): { parts: Part[]; cuts: TranscriptCut[] } {
  const occurrences = wordOccurrences(
    { start, end, text: "" },
    transcriptRanges(parts, recordingId),
  ).sort((a, b) => a.start - b.start);
  const cuts = occurrences.reduce<TranscriptCut[]>((joined, range) => {
    const last = joined.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else joined.push({ ...range });
    return joined;
  }, []);
  if (!cuts.length) return { parts, cuts };
  return {
    cuts,
    parts: parts.flatMap((part) => {
      const end = part.offset + part.end - part.start;
      let from = part.offset;
      const kept: TranscriptCut[] = [];
      for (const cut of cuts) {
        if (cut.end <= from) continue;
        if (cut.start >= end) break;
        if (cut.start > from) kept.push({ start: from, end: cut.start });
        from = Math.max(from, cut.end);
      }
      if (from < end) kept.push({ start: from, end });
      return kept
        .filter((range) => range.end - range.start > 1e-6)
        .map((range, index) => ({
          ...part,
          pieceId: index === 0 ? part.pieceId : newId(),
          offset: timeAfterTranscriptCut(range.start, cuts),
          start: toRecording(part, range.start),
          end: toRecording(part, range.end),
        }));
    }),
  };
}

/** Cut several stretches of source time as one edit, moving the playhead with them. */
export function cutTranscriptRanges(
  parts: Part[],
  recordingId: string,
  ranges: TranscriptCut[],
  time: number,
  newId: () => string,
): { parts: Part[]; time: number; changed: boolean } {
  let changed = false;
  for (const range of ranges) {
    const result = cutTranscriptRange(parts, recordingId, range.start, range.end, newId);
    if (!result.cuts.length) continue;
    parts = result.parts;
    time = timeAfterTranscriptCut(time, result.cuts);
    changed = true;
  }
  return { parts, time, changed };
}

/** Where the playhead moves when time is opened up at each insert's `at`, in order. */
export function timeAfterTranscriptRestore(
  time: number,
  inserts: { at: number; length: number }[],
): number {
  return inserts.reduce(
    (moved, insert) => (moved >= insert.at - 1e-6 ? moved + insert.length : moved),
    time,
  );
}

/**
 * Put back the source words between `start` and `end` the edit leaves out, right after the words spoken before them,
 * opening up the time across every project layer. A cut followed by its restore gives back the original pieces.
 */
export function restoreTranscriptRange(
  parts: Part[],
  recordingId: string,
  start: number,
  end: number,
  newId: () => string,
): { parts: Part[]; inserts: { at: number; length: number }[] } {
  const inserts: { at: number; length: number }[] = [];
  const timeline = parts.find((part) => part.recordingId === recordingId)?.timeline;
  if (!timeline) return { parts, inserts };
  for (let guard = 0; guard < 1000; guard++) {
    const ranges = transcriptRanges(parts, recordingId);
    // The first stretch of the source range nothing plays.
    let from = start;
    for (const range of [...ranges].sort((a, b) => a.start - b.start))
      if (range.start <= from + 1e-6 && range.end > from) from = range.end;
    if (end - from <= 1e-6) break;
    const to = Math.min(
      end,
      ...ranges.filter((range) => range.start > from + 1e-6).map((range) => range.start),
    );
    // On the recording's own timeline, which leaves pauses out.
    const recorded = timeline.clips.flatMap((clip) => {
      const a = Math.max(from, clip.start);
      const b = Math.min(to, clip.start + clip.duration);
      return b - a > 1e-6 ? [[clip.offset + a - clip.start, clip.offset + b - clip.start]] : [];
    });
    if (!recorded.length) {
      start = to;
      continue;
    }
    const [recordStart, recordEnd] = [recorded[0][0], recorded.at(-1)![1]];
    const length = recordEnd - recordStart;
    // Right after the nearest earlier words that play; otherwise before the next ones; otherwise at the end.
    const before = ranges
      .filter((range) => range.end <= from + 1e-6)
      .sort((a, b) => b.end - a.end || a.offset - b.offset)[0];
    const after = ranges
      .filter((range) => range.start >= to - 1e-6)
      .sort((a, b) => a.start - b.start || a.offset - b.offset)[0];
    const at = before
      ? before.offset + before.end - before.start
      : after
        ? after.offset
        : Math.max(0, ...parts.map((part) => part.offset + lengthOf(part)));
    const joins = (part: Part) =>
      part.recordingId === recordingId &&
      Math.abs(part.end - recordStart) < 1e-6 &&
      Math.abs(part.offset + lengthOf(part) - at) < 1e-6;
    const template =
      parts.find(joins) ??
      parts.find((part) => part.recordingId === recordingId && Math.abs(part.offset - at) < 1e-6);
    const opened = parts.flatMap((part): Part[] => {
      const partEnd = part.offset + lengthOf(part);
      if (part.offset >= at - 1e-6) return [{ ...part, offset: part.offset + length }];
      if (partEnd <= at + 1e-6) return [part];
      return [
        { ...part, end: toRecording(part, at) },
        { ...part, pieceId: newId(), offset: at + length, start: toRecording(part, at) },
      ];
    });
    const added: Part = {
      pieceId: newId(),
      recordingId,
      offset: at,
      start: recordStart,
      end: recordEnd,
      timeline,
      ...(template?.cameraLayout && { cameraLayout: template.cameraLayout }),
      ...(template?.layout && { layout: template.layout }),
    };
    let next = opened;
    const kept =
      template && joins(template)
        ? next.findIndex((part) => part.pieceId === template.pieceId)
        : -1;
    if (kept !== -1) {
      next = next.map((part, index) => (index === kept ? { ...part, end: recordEnd } : part));
      // The piece a cut split off continues straight on: join it back.
      const tail = next.findIndex(
        (part) =>
          part.recordingId === recordingId &&
          Math.abs(part.start - recordEnd) < 1e-6 &&
          Math.abs(part.offset - at - length) < 1e-6 &&
          JSON.stringify(part.cameraLayout) === JSON.stringify(next[kept].cameraLayout) &&
          JSON.stringify(part.layout) === JSON.stringify(next[kept].layout),
      );
      if (tail !== -1)
        next = next.flatMap((part, index) =>
          index === kept ? [{ ...part, end: next[tail].end }] : index === tail ? [] : [part],
        );
    } else {
      const index = template ? next.findIndex((part) => part.pieceId === template.pieceId) : -1;
      next =
        index === -1
          ? [...next, added]
          : [...next.slice(0, index + 1), added, ...next.slice(index + 1)];
    }
    parts = next;
    inserts.push({ at, length });
  }
  return { parts, inserts };
}
