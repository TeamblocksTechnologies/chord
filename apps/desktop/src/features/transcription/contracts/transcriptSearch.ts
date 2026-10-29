/**
 * Finding words in a recording's transcript. Matches are on the words that play: pauses and anything cut from the
 * recording are left out, so a phrase spoken across a cut is found as it sounds, and a result's time is always one the
 * recording can be opened at.
 */
import { preciseWords, type RecordingTranscript } from "../domain/captions.ts";
import { normalizeCuts, type Cut } from "#features/editing/domain/cuts";

/** A stretch of the recording's pause-free clock, and where it starts in session time. */
export interface SearchClip {
  /** On the manifest's session clock, including pauses. */
  start: number;
  duration: number;
  /** On the pause-free recording clock. */
  offset: number;
}

export interface TranscriptMatch {
  /** Where the matched words start, in seconds on the recording's own timeline before cuts. */
  time: number;
  /** The words around the match, from the same microphone. */
  before: string;
  match: string;
  after: string;
}

export interface TranscriptHit extends TranscriptMatch {
  projectId: string;
  recordingId: string;
}

/** The longest search main answers, and the fewest letters worth searching for. */
export const MAX_SEARCH_LENGTH = 200;
export const MIN_SEARCH_LENGTH = 2;

const CONTEXT_WORDS = 6;

/** What a word is compared as: no case, accents, or punctuation. */
export function searchKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** The words of a search, as they're compared. Empty when it has nothing to look for. */
export function searchTerms(query: string): string[] {
  return query.split(/\s+/).map(searchKey).filter(Boolean);
}

interface Word {
  text: string;
  key: string;
  start: number;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Map a normalized match back to the original text, keeping accents and expanded characters intact. */
function originalRange(text: string, from: number, to: number): [number, number] {
  let offset = 0;
  let start = 0;
  for (const { segment, index } of graphemes.segment(text)) {
    const next = offset + searchKey(segment).length;
    if (offset <= from && from < next) start = index;
    if (offset < to && to <= next) return [start, index + segment.length];
    offset = next;
  }
  return [start, text.length];
}

/** Split a result for display. The pieces concatenate with their spaces, highlighting only the query's characters. */
export function highlightTranscriptMatch(
  hit: TranscriptMatch,
  query: string,
): Pick<TranscriptMatch, "before" | "match" | "after"> {
  const terms = searchTerms(query);
  const words = hit.match.split(/\s+/);
  const first = words[0];
  const last = words.at(-1)!;
  const from =
    terms.length === 1
      ? searchKey(first).indexOf(terms[0])
      : searchKey(first).length - (terms[0]?.length ?? 0);
  if (!terms.length || from < 0)
    return {
      before: hit.before ? `${hit.before} ` : "",
      match: hit.match,
      after: hit.after ? ` ${hit.after}` : "",
    };
  const firstRange = originalRange(first, from, from + terms[0].length);
  const lastRange = terms.length === 1 ? firstRange : originalRange(last, 0, terms.at(-1)!.length);
  const start = firstRange[0];
  const end = hit.match.length - last.length + lastRange[1];
  return {
    before: (hit.before ? `${hit.before} ` : "") + hit.match.slice(0, start),
    match: hit.match.slice(start, end),
    after: hit.match.slice(end) + (hit.after ? ` ${hit.after}` : ""),
  };
}

/**
 * A microphone's words that play, in order, on the recording's clock. Words without model timings are spread across
 * their passage, as the transcript editor places them.
 */
function playedWords(
  transcript: RecordingTranscript,
  clips: readonly SearchClip[],
  cuts: readonly Cut[],
): Word[][] {
  const tracks = new Map<string, Word[]>();
  for (const cue of [...transcript.cues].sort((a, b) => a.start - b.start)) {
    const tokens = cue.text.trim().split(/\s+/).filter(Boolean);
    const timed =
      preciseWords(cue) ??
      tokens.map((text, index) => ({
        text,
        start: cue.start + ((cue.end - cue.start) * index) / tokens.length,
        end: cue.start + ((cue.end - cue.start) * (index + 1)) / tokens.length,
      }));
    const words = tracks.get(cue.trackId) ?? [];
    for (const item of timed) {
      const parts = item.text.trim().split(/\s+/).filter(Boolean);
      for (const [nth, text] of parts.entries()) {
        const key = searchKey(text);
        if (!key) continue;
        const start = item.start + ((item.end - item.start) * nth) / parts.length;
        const end = item.start + ((item.end - item.start) * (nth + 1)) / parts.length;
        const spans = clips.flatMap((clip) => {
          const from = Math.max(start, clip.start);
          const to = Math.min(end, clip.start + clip.duration);
          return to > from
            ? [{ start: clip.offset + from - clip.start, end: clip.offset + to - clip.start }]
            : [];
        });
        if (!spans.length) continue;
        const recorded = { start: spans[0].start, end: spans.at(-1)!.end };
        const middle = (recorded.start + recorded.end) / 2;
        if (cuts.some((cut) => middle >= cut.start && middle < cut.end)) continue;
        words.push({ text, key, start: recorded.start });
      }
    }
    tracks.set(cue.trackId, words);
  }
  return [...tracks.values()];
}

/**
 * Where `query` is said. One word matches inside a word; a phrase matches whole words, though it may start and end
 * partway through the words at its edges, so a search can be found while it's still being typed.
 */
export function searchTranscript(
  transcript: RecordingTranscript,
  clips: readonly SearchClip[],
  cuts: readonly Cut[],
  query: string,
  limit = Infinity,
): TranscriptMatch[] {
  const terms = searchTerms(query);
  if (!terms.length || limit <= 0) return [];
  const matches: TranscriptMatch[] = [];
  for (const words of playedWords(transcript, clips, normalizeCuts(cuts))) {
    for (let at = 0; at + terms.length <= words.length; at++) {
      const found = terms.every((term, nth) => {
        const key = words[at + nth].key;
        if (terms.length === 1) return key.includes(term);
        return nth === 0
          ? key.endsWith(term)
          : nth === terms.length - 1
            ? key.startsWith(term)
            : key === term;
      });
      if (!found) continue;
      const text = (from: number, to: number) =>
        words
          .slice(Math.max(from, 0), to)
          .map((word) => word.text)
          .join(" ");
      matches.push({
        time: words[at].start,
        before: text(at - CONTEXT_WORDS, at),
        match: text(at, at + terms.length),
        after: text(at + terms.length, at + terms.length + CONTEXT_WORDS),
      });
      at += terms.length - 1;
    }
  }
  return matches.sort((a, b) => a.time - b.time).slice(0, limit);
}
