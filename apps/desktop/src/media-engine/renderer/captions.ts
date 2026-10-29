import {
  CAPTION_LENGTHS,
  DEFAULT_CAPTION_SETTINGS,
  type CaptionSettings,
  type TimedText,
  type TranscriptionState,
} from "#features/transcription/domain/captions";
import type { Recording } from "#project-document/domain/recording";
import { lengthOf, showingOf, toProject, type Part } from "./timeline.ts";
import { transcriptWords } from "./transcript.ts";

/** A transcript word where it plays in the edit, on the project's timeline. `source` is its start in the recording. */
export interface PlayedWord extends TimedText {
  id: string;
  recordingId: string;
  trackId: string;
  source: number;
}
/** What's on screen together: one caption, on the project's timeline. */
export interface CaptionLine {
  start: number;
  end: number;
  words: PlayedWord[];
}

/** How long a caption stays up after its last word, unless the next one starts sooner. */
const HOLD = 0.6;
/** A silence this long starts a new caption. */
const PAUSE = 0.7;
/** The longest a caption stays up while words are spoken. */
const LONGEST = 6;

/** The transcript words that play in the current edit, clipped at cuts and mapped from the original session clock. */
export function playedWords(
  parts: Part[],
  recordings: Recording[],
  states: Record<string, TranscriptionState>,
): PlayedWord[] {
  return showingOf(parts)
    .flatMap(({ part, from, to }) => {
      const directory = recordings.find(
        (recording) => recording.id === part.recordingId,
      )?.directory;
      const words = transcriptWords(directory ? (states[directory]?.transcript?.cues ?? []) : []);
      return part.timeline.clips.flatMap((clip) =>
        words.flatMap((word) => {
          const a = Math.max(word.start, clip.start);
          const b = Math.min(word.end, clip.start + clip.duration);
          if (b - a <= 1e-6) return [];
          const start = Math.max(from, toProject(part, clip.offset + a - clip.start));
          const end = Math.min(to, toProject(part, clip.offset + b - clip.start));
          return end - start > 1e-6
            ? [
                {
                  id: word.id,
                  recordingId: part.recordingId,
                  trackId: word.trackId,
                  source: word.start,
                  start,
                  end,
                  text: word.text,
                },
              ]
            : [];
        }),
      );
    })
    .sort((a, b) => a.start - b.start || a.trackId.localeCompare(b.trackId));
}

/** Group the words that play into captions: at pauses, sentence ends and the chosen length. */
export function captionLines(
  words: PlayedWord[],
  settings: CaptionSettings = DEFAULT_CAPTION_SETTINGS,
): CaptionLine[] {
  const lines: CaptionLine[] = [];
  const longest = CAPTION_LENGTHS[settings.length];
  for (const word of words) {
    const line = lines.at(-1);
    const last = line?.words.at(-1);
    const characters = line ? line.words.reduce((sum, item) => sum + item.text.length + 1, -1) : 0;
    const split =
      !line ||
      !last ||
      settings.style === "word" ||
      last.recordingId !== word.recordingId ||
      last.trackId !== word.trackId ||
      word.start - last.end > PAUSE ||
      /[.!?。！？]["')\]]?$/.test(last.text) ||
      characters + 1 + word.text.length > longest ||
      word.end - line.start > LONGEST ||
      (/[,;:،、，]$/.test(last.text) && characters >= longest * 0.6);
    if (split) lines.push({ start: word.start, end: word.end, words: [word] });
    else {
      line.words.push(word);
      line.end = Math.max(line.end, word.end);
    }
  }
  // Keep each caption up through short silences, so it doesn't flicker between words or lines.
  return lines.map((line, index) => ({
    ...line,
    end: Math.max(line.end, Math.min(line.end + HOLD, lines[index + 1]?.start ?? line.end + HOLD)),
  }));
}

export function projectCaptions(
  parts: Part[],
  recordings: Recording[],
  states: Record<string, TranscriptionState>,
  settings?: CaptionSettings,
): CaptionLine[] {
  const end = Math.max(0, ...parts.map((part) => part.offset + lengthOf(part)));
  return captionLines(playedWords(parts, recordings, states), settings).map((line) => ({
    ...line,
    end: Math.min(line.end, Math.max(end, line.start)),
  }));
}

/**
 * Captions as subtitle cues, for sidecar files. Within a `range` of the project, only its captions, timed from its
 * start and cut at its ends.
 */
export function captionCues(
  lines: CaptionLine[],
  range?: { start: number; end: number },
): TimedText[] {
  const { start, end } = range ?? { start: 0, end: Infinity };
  return lines
    .filter((line) => !range || (line.end > start && line.start < end))
    .map((line) => ({
      start: Math.max(line.start, start) - start,
      end: Math.min(line.end, end) - start,
      text: line.words.map((word) => word.text).join(" "),
    }));
}
