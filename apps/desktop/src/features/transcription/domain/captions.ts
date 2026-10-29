/** Model timestamps are seconds in the original audio file. Corrections keep these anchors. */
export interface TimedText {
  start: number;
  end: number;
  text: string;
}
export interface TranscriptCue extends TimedText {
  id: string;
  trackId: string;
  /** Original model word timings, on the session clock. Older transcripts may only have cue anchors. */
  words?: TimedText[];
}
export interface RecordingTranscript {
  version: 1;
  model: string;
  /** When timings were refreshed with a different recognition pass, without replacing the text. */
  timingModel?: string;
  /** Cue times are on the manifest's session clock, including pauses. */
  cues: TranscriptCue[];
}
export interface TranscriptionState {
  directory: string;
  phase: "idle" | "queued" | "transcribing" | "done" | "failed";
  progress?: number;
  operation?: "timing";
  error?: string;
  transcript?: RecordingTranscript;
}

/** Refresh matching passages from measured words, preserving corrections and deleted text verbatim. */
export function refreshWordTimings(
  saved: RecordingTranscript,
  recognized: RecordingTranscript,
): { transcript: RecordingTranscript; updated: number } {
  const normalize = (text: string) =>
    text
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
  const tracks = new Map<string, TimedText[]>();
  for (const cue of recognized.cues) {
    const words = tracks.get(cue.trackId) ?? [];
    words.push(...(cue.words ?? []));
    tracks.set(cue.trackId, words);
  }
  for (const words of tracks.values()) words.sort((a, b) => a.start - b.start);
  let updated = 0;
  const cues = saved.cues.map((cue) => {
    const tokens = cue.text.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return cue;
    const source = tracks.get(cue.trackId) ?? [];
    let match: TimedText[] | undefined;
    let distance = Infinity;
    for (let index = 0; index <= source.length - tokens.length; index++) {
      // Don't attach a repeated phrase from a different part of the recording or another microphone.
      if (source[index].start > cue.end + 0.5) break;
      if (source[index + tokens.length - 1].end < cue.start - 0.5) continue;
      const words = source.slice(index, index + tokens.length);
      if (
        !words.every(
          (word, nth) =>
            isTimedText(word) &&
            !/\s/.test(word.text.trim()) &&
            normalize(word.text) &&
            normalize(word.text) === normalize(tokens[nth]),
        )
      )
        continue;
      const gap = Math.abs(words[0].start - cue.start) + Math.abs(words.at(-1)!.end - cue.end);
      if (gap < distance) {
        match = words;
        distance = gap;
      }
    }
    if (!match) return cue;
    updated++;
    return {
      ...cue,
      start: match[0].start,
      end: match.at(-1)!.end,
      words: match.map((word, index) => ({ ...word, text: tokens[index] })),
    };
  });
  return { transcript: { ...saved, timingModel: recognized.model, cues }, updated };
}

/** A passage's model word timings, when they still match its text after corrections. */
export function preciseWords(cue: TranscriptCue): TimedText[] | undefined {
  const tokens = cue.text.trim().split(/\s+/).filter(Boolean);
  return cue.words?.every(
    (word) => isTimedText(word) && word.start >= cue.start && word.end <= cue.end,
  ) && cue.words.map((word) => word.text.trim()).join(" ") === tokens.join(" ")
    ? cue.words
    : undefined;
}

/** A word in a passage: an item of its word timings, or of its text where those no longer match. */
export interface WordAddress {
  cue: string;
  word: number;
}

/**
 * Replace the words from `from` through `to` with `text`, keeping their timing: the new text spans the replaced
 * words' time. Passages in between are joined, so a correction can cross them.
 */
export function replaceWords(
  transcript: RecordingTranscript,
  from: WordAddress,
  to: WordAddress,
  text: string,
): RecordingTranscript {
  const replacement = text.trim().replace(/\s+/g, " ");
  if (!replacement) throw new Error("Type the corrected words");
  const first = transcript.cues.findIndex((cue) => cue.id === from.cue);
  const last = transcript.cues.findIndex((cue) => cue.id === to.cue);
  if (first === -1 || last === -1) throw new Error("These words are no longer in the transcript");
  if (last < first || transcript.cues[first].trackId !== transcript.cues[last].trackId)
    throw new Error("Correct words from one microphone at a time");
  const joined = transcript.cues
    .slice(first, last + 1)
    .filter((cue) => cue.trackId === transcript.cues[first].trackId);
  const timed = joined.map(preciseWords);
  // Each passage's items, in order, so `to` can be found in the joined passage.
  const items = joined.map(
    (cue, index) =>
      timed[index] ??
      cue.text
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => ({ text: word, start: cue.start, end: cue.end })),
  );
  const start = from.word;
  const end = items.slice(0, -1).reduce((sum, list) => sum + list.length, 0) + to.word;
  const all = items.flat();
  if (start < 0 || end >= all.length || end < start)
    throw new Error("These words are no longer in the transcript");
  const words = [
    ...all.slice(0, start),
    { text: replacement, start: all[start].start, end: all[end].end },
    ...all.slice(end + 1),
  ];
  const cue: TranscriptCue = {
    id: joined[0].id,
    trackId: joined[0].trackId,
    start: Math.min(...joined.map((cue) => cue.start)),
    end: Math.max(...joined.map((cue) => cue.end)),
    text: words.map((word) => word.text).join(" "),
    // Without real timings for every joined passage, positions stay estimated rather than invented.
    ...(timed.every(Boolean) && { words }),
  };
  const removed = new Set(joined.map((cue) => cue.id));
  return {
    ...transcript,
    cues: transcript.cues.flatMap((existing) =>
      existing.id === cue.id ? [cue] : removed.has(existing.id) ? [] : [existing],
    ),
  };
}

/** How captions show the words that play. */
export type CaptionStyle = "lines" | "highlight" | "word";
export type CaptionLength = "short" | "medium" | "long";
/** Captions are a view of the transcript: the words come from it, these decide how they're shown. Project-wide. */
export interface CaptionSettings {
  style: CaptionStyle;
  length: CaptionLength;
}

export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = { style: "lines", length: "medium" };
/** The most characters a caption line holds before starting the next. */
export const CAPTION_LENGTHS: Record<CaptionLength, number> = { short: 20, medium: 42, long: 80 };

export function isCaptionSettings(value: unknown): value is CaptionSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as CaptionSettings;
  return (
    ["lines", "highlight", "word"].includes(settings.style) && settings.length in CAPTION_LENGTHS
  );
}

export function isTimedText(value: unknown): value is TimedText {
  if (!value || typeof value !== "object") return false;
  const cue = value as TimedText;
  return (
    Number.isFinite(cue.start) &&
    cue.start >= 0 &&
    Number.isFinite(cue.end) &&
    cue.end > cue.start &&
    typeof cue.text === "string"
  );
}

/** Group real model word timings into readable captions, never estimating timestamps from text length. */
export function captionGroups(words: TimedText[]): TimedText[] {
  const cues: TimedText[] = [];
  for (const word of words.filter(isTimedText)) {
    if (!word.text.trim()) continue;
    const last = cues.at(-1);
    if (
      last &&
      word.start - last.end < 0.8 &&
      word.end - last.start <= 4 &&
      last.text.length + word.text.length < 76 &&
      !/[.!?。！？]$/.test(last.text)
    ) {
      last.text += ` ${word.text.trim()}`;
      last.end = Math.max(last.end, word.end);
    } else cues.push({ ...word, text: word.text.trim() });
  }
  return cues;
}

/** Map session timestamps to the lead track's pause-free recording clock. */
export function onRecording(
  cues: TimedText[],
  clips: { start: number; duration: number; offset: number }[],
): TimedText[] {
  return clips
    .flatMap((clip) =>
      cues.flatMap((cue) => {
        const start = Math.max(cue.start, clip.start);
        const end = Math.min(cue.end, clip.start + clip.duration);
        return end > start
          ? [
              {
                text: cue.text,
                start: clip.offset + start - clip.start,
                end: clip.offset + end - clip.start,
              },
            ]
          : [];
      }),
    )
    .sort((a, b) => a.start - b.start);
}

export function captionFiles(cues: TimedText[]): { txt: string; srt: string; vtt: string } {
  const visible = cues
    .filter((cue) => isTimedText(cue) && cue.text.trim())
    .sort((a, b) => a.start - b.start);
  // Escape caption markup: corrections must appear literally in subtitle players.
  const escape = (text: string) =>
    text
      .trim()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\r?\n\s*\r?\n/g, "\n");
  const blocks = (vtt: boolean) =>
    visible
      .map(
        (cue, i) =>
          `${vtt ? "" : `${i + 1}\n`}${stamp(cue.start, vtt)} --> ${stamp(Math.max(cue.end, cue.start + 0.001), vtt)}\n${escape(cue.text)}\n`,
      )
      .join("\n");
  return {
    txt: visible.map((cue) => cue.text.trim()).join("\n") + (visible.length ? "\n" : ""),
    srt: blocks(false),
    vtt: `WEBVTT\n\n${blocks(true)}`,
  };
}

function stamp(seconds: number, vtt: boolean): string {
  const ms = Math.round(seconds * 1000);
  const pad = (n: number, digits = 2) => String(n).padStart(digits, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${vtt ? "." : ","}${pad(ms % 1000, 3)}`;
}
