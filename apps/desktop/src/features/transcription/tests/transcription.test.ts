import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Manifest, ManifestTrack } from "@teamblocks.dev/chord-recorder-protocol";
import { RecordingTranscriptions } from "../main/recordingTranscriptions.ts";
import {
  captionFiles,
  captionGroups,
  onRecording,
  refreshWordTimings,
  replaceWords,
  type RecordingTranscript,
  type TranscriptionState,
} from "../domain/captions.ts";
import {
  captionCues,
  captionLines,
  playedWords,
  projectCaptions,
  type PlayedWord,
} from "#media-engine/renderer/captions";
import {
  currentTranscriptWord,
  transcriptPosition,
  cutTranscriptRange,
  cutTranscriptRanges,
  keptLength,
  restoreTranscriptRange,
  silenceCut,
  transcriptCutMarkers,
  transcriptRecordedSpan,
  transcriptSessionTime,
  transcriptSilences,
  timeAfterTranscriptCut,
  timeAfterTranscriptRestore,
  transcriptRanges,
  transcriptWords,
  wordCutState,
  wordOccurrences,
  wordSeekTime,
} from "#media-engine/renderer/transcript";
import { buildTimeline, sequence } from "#media-engine/renderer/timeline";
import type { Recording } from "#project-document/domain/recording";

const track = (
  id: string,
  kind: ManifestTrack["kind"],
  segments: ManifestTrack["segments"],
): ManifestTrack => ({
  id,
  kind,
  source: id,
  segments,
  ...(kind === "screen" && {
    display: { id: 1, frame: { x: 0, y: 0, width: 100, height: 100 }, scale: 1 },
  }),
});
const manifest = (tracks: ManifestTrack[]): Manifest => ({
  version: 1,
  id: "take",
  createdAt: "",
  hostTimeOrigin: 0,
  config: {} as Manifest["config"],
  tracks,
  pauses: [],
  marks: [],
});
const screen = track("screen", "screen", [
  { file: "a.mov", start: 1, end: 5 },
  { file: "b.mov", start: 9, end: 13 },
]);

test("caption grouping uses word timestamps and preserves silence and punctuation", () => {
  assert.deepEqual(
    captionGroups([
      { start: 0.1, end: 0.4, text: "Hello" },
      { start: 0.4, end: 0.8, text: "Chord." },
      { start: 0.9, end: 1.1, text: "Next" },
      { start: 3, end: 3.3, text: "topic" },
      { start: NaN, end: 4, text: "invalid" },
    ]),
    [
      { start: 0.1, end: 0.8, text: "Hello Chord." },
      { start: 0.9, end: 1.1, text: "Next" },
      { start: 3, end: 3.3, text: "topic" },
    ],
  );
});

test("sidecars have accurate hours/millisecond rollover and escape markup while plain text stays literal", () => {
  const files = captionFiles([
    { start: 3599.9996, end: 3601.025, text: "<API> & code\n\nNext" },
    { start: 1, end: 2, text: "" },
  ]);
  assert.equal(files.txt, "<API> & code\n\nNext\n");
  assert.equal(files.srt, "1\n01:00:00,000 --> 01:00:01,025\n&lt;API&gt; &amp; code\nNext\n");
  assert.equal(
    files.vtt,
    "WEBVTT\n\n01:00:00.000 --> 01:00:01.025\n&lt;API&gt; &amp; code\nNext\n",
  );
});

test("continuous transcript uses model word timings and estimates older or corrected passages", () => {
  const cue = {
    id: "cue",
    trackId: "mic",
    start: 1,
    end: 5,
    text: "Hello there",
    words: [
      { start: 1.2, end: 1.5, text: "Hello" },
      { start: 3, end: 4, text: "there" },
    ],
  };
  assert.deepEqual(
    transcriptWords([cue]).map(({ start, end, text }) => ({ start, end, text })),
    cue.words,
  );
  assert.deepEqual(
    transcriptWords([{ ...cue, text: "Corrected words here" }]).map(({ text }) => text),
    ["Corrected", "words", "here"],
  );
  const old = transcriptWords([{ ...cue, words: undefined }]);
  assert.deepEqual(
    old.map(({ start, end }) => [start, end]),
    [
      [1, 3],
      [3, 5],
    ],
  );
  assert.deepEqual(transcriptWords([{ ...cue, text: "  " }]), []);
});

test("transcript cuts and word seeking follow pauses, moved copies, and coverage by another recording", async () => {
  const timeline = (await buildTimeline(
    { directory: "/take", manifest: manifest([screen]), bounds: {}, input: [] },
    async () => 0,
  ))!;
  const { parts } = sequence([
    { recordingId: "other", timeline, start: 0, end: 1, offset: 2 },
    { recordingId: "r", timeline, start: 0, end: 8, offset: 0 },
    { recordingId: "r", timeline, start: 4, end: 6, offset: 10 },
  ]);
  const ranges = transcriptRanges(parts, "r");
  assert.deepEqual(ranges, [
    { start: 1, end: 3, offset: 0 },
    { start: 4, end: 5, offset: 3 },
    { start: 9, end: 13, offset: 4 },
    { start: 9, end: 11, offset: 10 },
  ]);
  assert.deepEqual(wordOccurrences({ start: 6, end: 8, text: "pause" }, ranges), []);
  assert.deepEqual(wordOccurrences({ start: 3.2, end: 3.8, text: "covered" }, ranges), []);
  const occurrences = wordOccurrences({ start: 9.5, end: 10, text: "copy" }, ranges);
  assert.deepEqual(occurrences, [
    { start: 4.5, end: 5 },
    { start: 10.5, end: 11 },
  ]);
  assert.equal(wordSeekTime(occurrences, 9), 10.5);
  assert.equal(wordSeekTime(occurrences, 0), 4.5);
  assert.equal(wordSeekTime([], 0), undefined);
  // A cut within a word seeks to its surviving audio, never back into removed material.
  assert.deepEqual(wordOccurrences({ start: 0.8, end: 1.5, text: "boundary" }, ranges), [
    { start: 0, end: 0.5 },
  ]);
  assert.equal(wordCutState({ start: 0.8, end: 1.5, text: "boundary" }, ranges), "partial");
  assert.equal(wordCutState({ start: 6, end: 8, text: "pause" }, ranges), "cut");
  assert.equal(
    wordCutState({ start: 9.5, end: 10, text: "copy" }, ranges),
    "kept",
    "Duplicated intervals count once",
  );
});

test("transcript cut markers use recorded time through pauses and fall within partial words and silences", async () => {
  const timeline = (await buildTimeline(
    { directory: "/take", manifest: manifest([screen]), bounds: {}, input: [] },
    async () => 0,
  ))!;
  const words = [
    { id: "word", start: 2, end: 3 },
    { id: "silence", start: 3, end: 10 },
    { id: "last", start: 10, end: 11 },
  ];
  const items = words.map((word) => ({
    id: word.id,
    ...transcriptRecordedSpan(word, timeline.clips)!,
  }));
  assert.deepEqual(
    items,
    [
      { id: "word", start: 1, end: 2 },
      { id: "silence", start: 2, end: 5 },
      { id: "last", start: 5, end: 6 },
    ],
    "Pauses take no space in the silence's recorded extent",
  );
  assert.equal(
    transcriptRecordedSpan({ start: 6, end: 8 }, timeline.clips),
    undefined,
    "An unrecorded pause has no extent",
  );
  assert.deepEqual(transcriptCutMarkers([{ start: 1.5, end: 4 }], items), [
    { index: 0, edge: "start", id: "word", progress: 0.5 },
    { index: 0, edge: "end", id: "silence", progress: 2 / 3 },
  ]);
  assert.deepEqual(
    transcriptCutMarkers([{ start: 2, end: 5 }], items),
    [
      { index: 0, edge: "start", id: "silence", progress: 0 },
      { index: 0, edge: "end", id: "silence", progress: 1 },
    ],
    "At shared boundaries both brackets face the cut",
  );
  assert.deepEqual(
    transcriptCutMarkers([{ start: 0, end: 8 }], items),
    [
      { index: 0, edge: "start", id: "word", progress: 0 },
      { index: 0, edge: "end", id: "last", progress: 1 },
    ],
    "A fully removed recording still has both markers",
  );
  assert.deepEqual(transcriptCutMarkers([{ start: 0, end: 8 }], []), []);
});

test("separate cuts within one word keep distinct markers and short gaps use the nearest text boundary", () => {
  const items = [
    { id: "first", start: 0, end: 1 },
    { id: "second", start: 1.2, end: 2 },
  ];
  assert.deepEqual(
    transcriptCutMarkers(
      [
        { start: 0.1, end: 0.2 },
        { start: 0.6, end: 0.9 },
      ],
      items,
    ),
    [
      { index: 0, edge: "start", id: "first", progress: 0.1 },
      { index: 0, edge: "end", id: "first", progress: 0.2 },
      { index: 1, edge: "start", id: "first", progress: 0.6 },
      { index: 1, edge: "end", id: "first", progress: 0.9 },
    ],
  );
  assert.deepEqual(transcriptCutMarkers([{ start: 1.01, end: 1.19 }], items), [
    { index: 0, edge: "start", id: "first", progress: 1 },
    { index: 0, edge: "end", id: "second", progress: 0 },
  ]);
});

test("transcript marker follows the source word through moves and disappears over other recordings", async () => {
  const timeline = (await buildTimeline(
    { directory: "/take", manifest: manifest([screen]), bounds: {}, input: [] },
    async () => 0,
  ))!;
  const { parts } = sequence([{ recordingId: "r", timeline, start: 4, end: 8, offset: 2 }]);
  const ranges = transcriptRanges(parts, "r");
  const words = transcriptWords([
    { id: "cue", trackId: "mic", start: 9, end: 11, text: "First second" },
  ]);
  assert.equal(currentTranscriptWord(words, ranges, 2.5), words[0].id);
  assert.equal(currentTranscriptWord(words, ranges, 3.5), words[1].id);
  assert.equal(
    currentTranscriptWord(words, ranges, 5),
    words[1].id,
    "Holds near the last word during silence",
  );
  assert.equal(currentTranscriptWord(words, ranges, 1), undefined);
  assert.equal(currentTranscriptWord(words, ranges, 6), undefined);
  assert.deepEqual(
    transcriptPosition(words, ranges, 2.25),
    { id: words[0].id, progress: 0.25 },
    "The marker moves through the word being spoken",
  );
  assert.deepEqual(
    transcriptPosition(words, ranges, 5),
    { id: words[1].id, progress: 1 },
    "and waits after the last word during silence",
  );
  const gap = transcriptWords([
    {
      id: "gap",
      trackId: "mic",
      start: 9,
      end: 12,
      text: "One two",
      words: [
        { start: 9, end: 9.5, text: "One" },
        { start: 11.5, end: 12, text: "two" },
      ],
    },
  ]);
  assert.deepEqual(
    transcriptPosition(gap, ranges, 4.4),
    { id: gap[0].id, progress: 1 },
    "A pause holds after the word before it, not the start of the next",
  );
  assert.deepEqual(transcriptPosition(gap, ranges, 4.5), { id: gap[1].id, progress: 0 });
});

test("clicking adjacent words keeps the clicked word highlighted after media timestamp rounding", () => {
  const ranges = [{ start: 13, end: 18, offset: 2 }];
  const words = transcriptWords([
    {
      id: "cue",
      trackId: "mic",
      start: 13.2,
      end: 16.8,
      text: "checking if it works with like the laser",
    },
  ]);
  for (const word of words) {
    const seek = wordSeekTime(wordOccurrences(word, ranges), 0)!;
    // Media elements store microseconds, which can round a seek just below a shared word boundary.
    const mediaTime =
      ranges[0].offset + Math.floor((seek - ranges[0].offset) * 1_000_000) / 1_000_000;
    assert.equal(currentTranscriptWord(words, ranges, mediaTime), word.id, word.text);
  }
  const withWord = words.find((word) => word.text === "with")!;
  const boundary = wordSeekTime(wordOccurrences(withWord, ranges), 0)!;
  assert.equal(
    currentTranscriptWord(words, ranges, boundary - 0.02),
    words[3].id,
    "Playback still highlights the previous word before the boundary",
  );
});

test("word seeking stays on the new word across a rounded pause boundary", () => {
  const ranges = [
    { start: 1, end: 5, offset: 0 },
    { start: 9, end: 13, offset: 4 },
  ];
  const words = transcriptWords([
    { id: "before", trackId: "mic", start: 4, end: 5, text: "works" },
    { id: "after", trackId: "mic", start: 9, end: 10, text: "with" },
  ]);
  assert.equal(currentTranscriptWord(words, ranges, 4 - 0.0000005), words[1].id);
});

test("deleting a transcript selection closes time across pauses and keeps subsequent recordings and layouts aligned", async () => {
  const timeline = (await buildTimeline(
    { directory: "/take", manifest: manifest([screen]), bounds: {}, input: [] },
    async () => 0,
  ))!;
  const layout = { position: "top-left" as const, width: 0.3 };
  const { parts } = sequence([
    { id: "first", recordingId: "r", timeline, cameraLayout: layout },
    { id: "next", recordingId: "other", timeline },
  ]);
  const { parts: cut, cuts } = cutTranscriptRange(parts, "r", 3, 10, () => "right");
  assert.deepEqual(
    cuts,
    [{ start: 2, end: 5 }],
    "Recording pauses don't create extra removed project time",
  );
  assert.deepEqual(
    cut.map(({ pieceId, recordingId, offset, start, end }) => ({
      pieceId,
      recordingId,
      offset,
      start,
      end,
    })),
    [
      { pieceId: "first", recordingId: "r", offset: 0, start: 0, end: 2 },
      { pieceId: "right", recordingId: "r", offset: 2, start: 5, end: 8 },
      { pieceId: "next", recordingId: "other", offset: 5, start: 0, end: 8 },
    ],
  );
  assert.deepEqual(
    cut.slice(0, 2).map((part) => part.cameraLayout),
    [layout, layout],
  );
  assert.equal(timeAfterTranscriptCut(3, cuts), 2);
  assert.equal(timeAfterTranscriptCut(11, cuts), 8);
  assert.deepEqual(
    wordOccurrences({ start: 3, end: 10, text: "selected" }, transcriptRanges(cut, "r")),
    [],
  );
  assert.equal(parts.length, 2, "The original edit can be restored for undo");
});

test("transcript deletion follows moved copies, preserves covering footage, and ignores already excluded words", async () => {
  const timeline = (await buildTimeline(
    { directory: "/take", manifest: manifest([screen]), bounds: {}, input: [] },
    async () => 0,
  ))!;
  const { parts } = sequence([
    { id: "cover", recordingId: "other", timeline, start: 0, end: 1, offset: 2 },
    { id: "source", recordingId: "r", timeline, start: 0, end: 8, offset: 0 },
    { id: "copy", recordingId: "r", timeline, start: 0, end: 2, offset: 8 },
  ]);
  const { parts: cut, cuts } = cutTranscriptRange(parts, "r", 1, 4, () => "split");
  assert.deepEqual(cuts, [
    { start: 0, end: 2 },
    { start: 8, end: 10 },
  ]);
  assert.deepEqual(
    cut.map(({ pieceId, offset, start, end }) => ({ pieceId, offset, start, end })),
    [
      { pieceId: "cover", offset: 0, start: 0, end: 1 },
      { pieceId: "source", offset: 0, start: 2, end: 8 },
    ],
  );
  assert.equal(cutTranscriptRange(cut, "r", 1, 4, () => "unused").cuts.length, 0);
  assert.equal(
    cutTranscriptRange(parts, "r", 6, 8, () => "unused").parts,
    parts,
    "Paused source time isn't cut twice",
  );
  assert.equal(cutTranscriptRange(parts, "missing", 1, 4, () => "unused").cuts.length, 0);
  assert.deepEqual(
    cutTranscriptRange(
      parts.filter((part) => part.recordingId === "r"),
      "r",
      0,
      20,
      () => "unused",
    ).parts,
    [],
  );
});

test("preview and exported captions omit transcript words removed from the middle of a passage", async () => {
  const timeline = (await buildTimeline(
    { directory: "/take", manifest: manifest([screen]), bounds: {}, input: [] },
    async () => 0,
  ))!;
  const { parts } = sequence([{ recordingId: "r", timeline }]);
  const cues = [
    {
      id: "cue",
      trackId: "mic",
      start: 1.2,
      end: 4,
      text: "Keep remove this ending.",
      words: [
        { start: 1.2, end: 1.5, text: "Keep" },
        { start: 1.6, end: 2, text: "remove" },
        { start: 2.1, end: 2.5, text: "this" },
        { start: 2.6, end: 4, text: "ending." },
      ],
    },
  ];
  const cut = cutTranscriptRange(parts, "r", 1.6, 2.5, () => "right");
  const states: Record<string, TranscriptionState> = {
    "/take": { directory: "/take", phase: "done", transcript: { version: 1, model: "test", cues } },
  };
  const captions = projectCaptions(
    cut.parts,
    [{ id: "r", directory: "/take" } as Recording],
    states,
  );
  assert.deepEqual(
    captionCues(captions).map((cue) => cue.text),
    ["Keep ending."],
    "The words either side of a cut read as one caption",
  );
  assert.equal(captionFiles(captionCues(captions)).txt, "Keep ending.\n");
});

test("fractional timeline offsets don't leave a deleted word with a microscopic retained fragment", () => {
  const timeline = {
    duration: 20,
    clips: [{ start: 0.123456789, duration: 20, offset: 0 }],
  } as Parameters<typeof sequence>[0][number]["timeline"];
  const { parts } = sequence([
    { id: "r", recordingId: "r", timeline, offset: 2.3456789, start: 0.2, end: 20 },
  ]);
  const words = transcriptWords([
    {
      id: "cue",
      trackId: "mic",
      start: 9.2,
      end: 12.8,
      text: "checking if it works with like the laser",
    },
  ]);
  for (const word of words) {
    const result = cutTranscriptRange(parts, "r", word.start, word.end, () => "new");
    const ranges = transcriptRanges(result.parts, "r");
    assert.deepEqual(wordOccurrences(word, ranges), [], word.text);
    assert.equal(wordCutState(word, ranges), "cut", word.text);
  }
});

test("timing refresh replaces evenly spaced positions with measured words while preserving corrections and deletions", () => {
  const saved: RecordingTranscript = {
    version: 1,
    model: "old",
    cues: [
      { id: "phrase", trackId: "mic", start: 1, end: 4, text: "Actually, I should be." },
      { id: "deleted", trackId: "mic", start: 4, end: 5, text: " " },
      { id: "corrected", trackId: "mic", start: 5, end: 6, text: "Custom wording." },
      { id: "repeat", trackId: "mic", start: 8, end: 9, text: "works" },
      { id: "other-mic", trackId: "other", start: 1, end: 4, text: "Actually, I should be." },
    ],
  };
  const measured = [
    { start: 1.2, end: 1.7, text: "actually," },
    { start: 1.7, end: 1.8, text: "I" },
    { start: 1.8, end: 2, text: "should" },
    { start: 2, end: 2.2, text: "be" },
    { start: 4, end: 5, text: "Deleted" },
    { start: 5, end: 6, text: "Original" },
    { start: 8.2, end: 8.6, text: "works" },
    { start: 20, end: 21, text: "works" },
  ];
  const recognized: RecordingTranscript = {
    version: 1,
    model: "new",
    cues: [{ id: "fresh", trackId: "mic", start: 1.2, end: 21, text: "", words: measured }],
  };
  const { transcript, updated } = refreshWordTimings(saved, recognized);
  assert.equal(updated, 2);
  assert.equal(transcript.timingModel, "new");
  assert.deepEqual(
    transcript.cues.map(({ id, text }) => ({ id, text })),
    saved.cues.map(({ id, text }) => ({ id, text })),
  );
  assert.deepEqual(
    transcript.cues[0].words!.map(({ start, end }) => [start, end]),
    measured.slice(0, 4).map(({ start, end }) => [start, end]),
  );
  assert.deepEqual(
    transcript.cues[0].words!.map(({ text }) => text),
    ["Actually,", "I", "should", "be."],
  );
  assert.equal(
    transcript.cues[3].words![0].start,
    8.2,
    "Repeated words stay anchored to the same passage",
  );
  for (const index of [1, 2, 4]) assert.deepEqual(transcript.cues[index], saved.cues[index]);
  assert.equal(
    saved.cues[0].words,
    undefined,
    "The previous transcript stays intact until the new result is saved",
  );
  assert.ok(transcriptWords(saved.cues).some((word) => word.estimated));
  assert.ok(transcriptWords([transcript.cues[0]]).every((word) => !word.estimated));
});

test("timing-only jobs persist measured words, keep text, and preserve saved results on failure and cancellation", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "chord-retime-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const saved: RecordingTranscript = {
    version: 1,
    model: "old",
    cues: [{ id: "keep", trackId: "mic", start: 0, end: 3, text: "Actually, I should be." }],
  };
  writeFileSync(join(directory, "transcript.json"), JSON.stringify(saved));
  let fail = false;
  let block = false;
  let entered = false;
  const service = new RecordingTranscriptions({
    load: async () =>
      manifest([track("mic", "microphone", [{ file: "mic.m4a", start: 0, end: 4 }])]),
    model: async () => ({ id: "local", model: "local" }),
    transcribe: async (_file, _model, signal) => {
      entered = true;
      if (fail) throw new Error("Recognition failed");
      if (block)
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
        );
      return {
        words: [
          { start: 0.2, end: 0.7, text: "Actually," },
          { start: 0.7, end: 0.8, text: "I" },
          { start: 0.8, end: 1, text: "should" },
          { start: 1, end: 1.2, text: "be." },
        ],
      };
    },
    duration: async () => 4,
    change: () => {},
  });
  context.after(() => service.dispose());
  await service.start(directory, true);
  await waitFor(async () => (await service.get(directory)).phase === "done");
  const refreshed = JSON.parse(readFileSync(join(directory, "transcript.json"), "utf8"));
  assert.equal(refreshed.cues[0].text, saved.cues[0].text);
  assert.equal(refreshed.cues[0].id, "keep");
  assert.deepEqual(
    refreshed.cues[0].words.map(({ start }) => start),
    [0.2, 0.7, 0.8, 1],
  );
  fail = true;
  await service.start(directory, true);
  await waitFor(async () => (await service.get(directory)).phase === "failed");
  assert.deepEqual((await service.get(directory)).transcript, refreshed);
  fail = false;
  block = true;
  entered = false;
  await service.start(directory, true);
  await waitFor(async () => entered);
  service.cancel(directory);
  await waitFor(async () => (await service.get(directory)).phase === "done");
  assert.deepEqual(JSON.parse(readFileSync(join(directory, "transcript.json"), "utf8")), refreshed);
});

test("session cues follow lead-track start offsets, pauses, cuts, moves, duplicates, and covered pieces", async () => {
  const timeline = (await buildTimeline(
    { directory: "/take", manifest: manifest([screen]), bounds: {}, input: [] },
    async () => 0,
  ))!;
  const cues = [
    { id: "one", trackId: "mic", start: 1.5, end: 3, text: "First" },
    { id: "pause", trackId: "mic", start: 6, end: 8, text: "Paused" },
    { id: "two", trackId: "mic", start: 9.5, end: 12, text: "Corrected explanation" },
  ];
  assert.deepEqual(onRecording(cues, timeline.clips), [
    { start: 0.5, end: 2, text: "First" },
    { start: 4.5, end: 7, text: "Corrected explanation" },
  ]);
  const { parts } = sequence([
    { recordingId: "r", timeline, start: 5, end: 6.5, offset: 1 },
    { recordingId: "r", timeline, start: 0, end: 8, offset: 0 },
    { recordingId: "r", timeline, start: 5, end: 6.5, offset: 10 },
  ]);
  const states: Record<string, TranscriptionState> = {
    "/take": { directory: "/take", phase: "done", transcript: { version: 1, model: "test", cues } },
  };
  assert.deepEqual(
    playedWords(parts, [{ id: "r", directory: "/take" } as Recording], states).map(
      ({ start, end, text }) => ({ start, end, text }),
    ),
    [
      { start: 0.5, end: 1, text: "First" },
      { start: 1, end: 1.75, text: "Corrected" },
      { start: 1.75, end: 2.5, text: "explanation" },
      { start: 4.5, end: 5.75, text: "Corrected" },
      { start: 5.75, end: 7, text: "explanation" },
      { start: 10, end: 10.75, text: "Corrected" },
      { start: 10.75, end: 11.5, text: "explanation" },
    ],
  );
});

test("jobs transcribe every microphone segment, persist corrections without moving timestamps, and reload", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "chord-transcription-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const states: TranscriptionState[] = [];
  const calls: string[] = [];
  const dependencies = {
    load: async () =>
      manifest([
        screen,
        track("mic1", "microphone", [
          { file: "mic1-a.m4a", start: 1.2, end: 5 },
          { file: "mic1-b.m4a", start: 9.2, end: 13 },
        ]),
        track("mic2", "microphone", [{ file: "mic2.m4a", start: 9.5, end: 12 }]),
        track("system", "systemAudio", [{ file: "system.m4a", start: 1, end: 13 }]),
      ]),
    model: async () => ({ id: "local", model: "local" }),
    transcribe: async (file: string) => {
      calls.push(file);
      return { words: [{ start: 0.2, end: 1.2, text: "Recognized" }] };
    },
    duration: async () => 4,
    change: (state: TranscriptionState) => {
      states.push(state);
    },
  };
  const service = new RecordingTranscriptions(dependencies);
  context.after(() => service.dispose());
  await Promise.all([service.start(directory), service.start(directory)]);
  await waitFor(async () => (await service.get(directory)).phase === "done");
  assert.equal(calls.length, 3, "Duplicate requests run once; system audio is excluded");
  assert.ok(states.some((state) => state.phase === "queued"));
  assert.ok(states.some((state) => state.phase === "transcribing" && state.progress! > 0));
  const original = (await service.get(directory)).transcript!;
  assert.deepEqual(original.cues[0].words, [{ start: 1.4, end: 2.4, text: "Recognized" }]);
  assert.deepEqual(
    original.cues.map((cue) => [cue.trackId, Number(cue.start.toFixed(3))]),
    [
      ["mic1", 1.4],
      ["mic1", 9.4],
      ["mic2", 9.7],
    ],
  );
  const [first, second] = original.cues;
  await Promise.all([
    service.correct(directory, first.id, "Corrected API"),
    service.correct(directory, second.id, "Another correction"),
  ]);
  const saved = JSON.parse(readFileSync(join(directory, "transcript.json"), "utf8"));
  assert.deepEqual(
    saved.cues.map((cue: typeof first) => [cue.start, cue.end]),
    original.cues.map((cue) => [cue.start, cue.end]),
  );
  assert.equal(saved.cues[0].text, "Corrected API");
  assert.equal(
    saved.cues[0].words,
    undefined,
    "Corrections discard obsolete word timings while keeping cue anchors",
  );
  assert.equal(saved.cues[1].text, "Another correction", "Concurrent corrections both survive");
  assert.match(
    readFileSync(join(directory, "transcript.srt"), "utf8"),
    /00:00:00,400 --> 00:00:01,400\nCorrected API/,
  );
  const reloaded = new RecordingTranscriptions(dependencies);
  assert.equal((await reloaded.get(directory)).transcript?.cues[0].text, "Corrected API");
});

test("queued jobs, missing models, failures, cancellation, retry and old corrections", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "chord-transcription-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  let fail = true;
  let block = false;
  let entered = false;
  const service = new RecordingTranscriptions({
    load: async () =>
      manifest([track("mic", "microphone", [{ file: "mic.m4a", start: 0, end: 2 }])]),
    model: async () => {
      if (fail) throw new Error("Download a local model");
      return { id: "local", model: "local" };
    },
    transcribe: async (_file, _model, signal) => {
      entered = true;
      if (block)
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
        );
      return { words: [{ start: 0, end: 1, text: "Original" }] };
    },
    duration: async () => 2,
    change: () => {},
  });
  context.after(() => service.dispose());
  await service.start(directory);
  await waitFor(async () => (await service.get(directory)).phase === "failed");
  assert.match((await service.get(directory)).error!, /Download/);
  fail = false;
  await service.start(directory);
  await waitFor(async () => (await service.get(directory)).phase === "done");
  const cue = (await service.get(directory)).transcript!.cues[0];
  await service.correct(directory, cue.id, "Keep correction");
  block = true;
  entered = false;
  await service.start(directory);
  await waitFor(async () => entered);
  await assert.rejects(service.correct(directory, cue.id, "Too soon"), /Wait for transcription/);
  service.cancel(directory);
  await waitFor(async () => (await service.get(directory)).phase === "done");
  assert.equal((await service.get(directory)).transcript?.cues[0].text, "Keep correction");
});

test("waiting takes can be cancelled without running inference, and silence saves an empty transcript", async (context) => {
  const first = mkdtempSync(join(tmpdir(), "chord-transcription-first-"));
  const second = mkdtempSync(join(tmpdir(), "chord-transcription-second-"));
  context.after(() => {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  });
  let entered = false;
  let finish!: () => void;
  let runs = 0;
  const service = new RecordingTranscriptions({
    load: async () =>
      manifest([track("mic", "microphone", [{ file: "mic.m4a", start: 0, end: 2 }])]),
    model: async () => ({ id: "local", model: "local" }),
    transcribe: async () => {
      runs++;
      entered = true;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { words: [] };
    },
    duration: async () => 2,
    change: () => {},
  });
  context.after(() => service.dispose());
  await service.start(first);
  await waitFor(async () => entered);
  assert.equal((await service.start(second)).phase, "queued");
  assert.equal(runs, 1, "Inference is serialized across takes");
  service.cancel(second);
  assert.equal((await service.get(second)).phase, "idle");
  finish();
  await waitFor(async () => (await service.get(first)).phase === "done");
  assert.equal(runs, 1, "The cancelled waiting take never runs the model");
  assert.deepEqual((await service.get(first)).transcript?.cues, []);
  assert.equal(readFileSync(join(first, "transcript.txt"), "utf8"), "");
  assert.equal(readFileSync(join(first, "transcript.vtt"), "utf8"), "WEBVTT\n\n");
});

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Transcription did not settle");
}

test("correcting words keeps their timing, joins passages it crosses, and leaves estimates estimated", () => {
  const transcript: RecordingTranscript = {
    version: 1,
    model: "test",
    cues: [
      {
        id: "a",
        trackId: "mic",
        start: 1,
        end: 2,
        text: "Hello teh",
        words: [
          { start: 1, end: 1.4, text: "Hello" },
          { start: 1.5, end: 2, text: "teh" },
        ],
      },
      {
        id: "b",
        trackId: "mic",
        start: 2.2,
        end: 3,
        text: "wrold today.",
        words: [
          { start: 2.2, end: 2.5, text: "wrold" },
          { start: 2.6, end: 3, text: "today." },
        ],
      },
      { id: "c", trackId: "mic", start: 4, end: 6, text: "Old passage" },
    ],
  };
  const fixed = replaceWords(
    transcript,
    { cue: "a", word: 1 },
    { cue: "b", word: 0 },
    " the  world ",
  );
  assert.deepEqual(
    fixed.cues.map(({ id, text }) => ({ id, text })),
    [
      { id: "a", text: "Hello the world today." },
      { id: "c", text: "Old passage" },
    ],
  );
  assert.deepEqual(fixed.cues[0].words, [
    { start: 1, end: 1.4, text: "Hello" },
    { start: 1.5, end: 2.5, text: "the world" },
    { start: 2.6, end: 3, text: "today." },
  ]);
  assert.deepEqual([fixed.cues[0].start, fixed.cues[0].end], [1, 3]);
  const words = transcriptWords(fixed.cues);
  assert.deepEqual(
    words.map(({ text }) => text),
    ["Hello", "the", "world", "today.", "Old", "passage"],
  );
  assert.deepEqual(
    words.filter((word) => word.estimated).map(({ text }) => text),
    ["the", "world", "Old", "passage"],
  );
  const old = replaceWords(transcript, { cue: "c", word: 1 }, { cue: "c", word: 1 }, "text");
  assert.equal(old.cues[2].text, "Old text");
  assert.equal(old.cues[2].words, undefined);
  assert.throws(() => replaceWords(transcript, { cue: "a", word: 0 }, { cue: "a", word: 0 }, "  "));
  assert.equal(transcript.cues[0].text, "Hello teh", "The original stays intact");
});

test("restoring cut words puts them back where they were spoken and undoes a cut exactly", async () => {
  const timeline = (await buildTimeline(
    { directory: "/take", manifest: manifest([screen]), bounds: {}, input: [] },
    async () => 0,
  ))!;
  const { parts } = sequence([
    { id: "r", recordingId: "r", timeline },
    { id: "s", recordingId: "s", timeline },
  ]);
  const shape = (list: typeof parts) =>
    list.map(({ recordingId, offset, start, end }) => ({
      recordingId,
      offset: +offset.toFixed(6),
      start: +start.toFixed(6),
      end: +end.toFixed(6),
    }));
  const cut = cutTranscriptRange(parts, "r", 2, 3, () => "tail");
  const restored = restoreTranscriptRange(cut.parts, "r", 2, 3, () => "unused");
  assert.deepEqual(
    shape(restored.parts),
    shape(parts),
    "Restoring what was cut gives the original pieces back",
  );
  assert.deepEqual(
    restored.parts.map((part) => part.pieceId),
    ["r", "s"],
  );
  assert.deepEqual(restored.inserts, [{ at: 1, length: 1 }]);
  assert.equal(timeAfterTranscriptRestore(1.5, restored.inserts), 2.5);
  assert.equal(timeAfterTranscriptRestore(0.5, restored.inserts), 0.5);
  assert.equal(
    restoreTranscriptRange(parts, "r", 2, 3, () => "unused").parts,
    parts,
    "Words that play aren't added twice",
  );
  const some = restoreTranscriptRange(cut.parts, "r", 2.2, 2.6, () => "middle");
  assert.deepEqual(
    shape(some.parts).sort((x, y) => x.offset - y.offset),
    [
      { recordingId: "r", offset: 0, start: 0, end: 1 },
      { recordingId: "r", offset: 1, start: 1.2, end: 1.6 },
      { recordingId: "r", offset: 1.4, start: 2, end: 8 },
      { recordingId: "s", offset: 7.4, start: 0, end: 8 },
    ],
    "Only the chosen words come back, after the words before them",
  );
  // Words trimmed from the start come back before the first words that play.
  const trimmed = sequence([{ id: "r", recordingId: "r", timeline, start: 1, end: 8 }]).parts;
  const start = restoreTranscriptRange(trimmed, "r", 1, 2, () => "head");
  assert.deepEqual(shape(start.parts), [
    { recordingId: "r", offset: 1, start: 1, end: 8 },
    { recordingId: "r", offset: 0, start: 0, end: 1 },
  ]);
});

test("captions group the words that play at pauses, sentences and length", () => {
  const word = (text: string, start: number, end = start + 0.3): PlayedWord => ({
    id: text,
    recordingId: "r",
    trackId: "mic",
    source: start,
    start,
    end,
    text,
  });
  const words = [
    word("One", 0),
    word("two.", 0.35),
    word("Three", 0.7),
    word("four", 1.05),
    word("five", 3),
    word("six", 3.35),
  ];
  const texts = (lines: ReturnType<typeof captionLines>) =>
    captionCues(lines).map((cue) => cue.text);
  assert.deepEqual(texts(captionLines(words)), ["One two.", "Three four", "five six"]);
  assert.deepEqual(texts(captionLines(words, { style: "word", length: "medium" })), [
    "One",
    "two.",
    "Three",
    "four",
    "five",
    "six",
  ]);
  const closed = words.map((item) =>
    item.start >= 3 ? { ...item, start: item.start - 1.6, end: item.end - 1.6 } : item,
  );
  assert.deepEqual(
    texts(captionLines(closed)),
    ["One two.", "Three four five six"],
    "Removing the silence between words lets them share a caption",
  );
  const long = words.map((item) => ({ ...item, text: `${item.text}longer` }));
  for (const text of texts(captionLines(long, { style: "lines", length: "short" })))
    assert.ok(text.length <= 20 || !text.includes(" "), text);
  assert.equal(
    texts(captionLines(long, { style: "lines", length: "long" }))[0],
    "Onelonger two.longer Threelonger fourlonger",
  );
  const lines = captionLines(words);
  assert.equal(lines[1].end, 1.35 + 0.6, "A caption stays up briefly after its last word");
  assert.equal(lines[0].end, 0.7, "but not over the next one");
});

test("silences sit before, between and after words, count only recorded time and are removed leaving padding", async () => {
  const timeline = (await buildTimeline(
    { directory: "/take", manifest: manifest([screen]), bounds: {}, input: [] },
    async () => 0,
  ))!;
  const recorded = timeline.clips.map((clip) => ({
    start: clip.start,
    end: clip.start + clip.duration,
  }));
  assert.deepEqual(recorded, [
    { start: 1, end: 5 },
    { start: 9, end: 13 },
  ]);
  const word = (id: string, start: number, end: number) => ({
    id,
    cueId: "c",
    item: 0,
    trackId: "mic",
    text: id,
    estimated: false,
    start,
    end,
  });
  const words = [
    word("a", 2, 2.5),
    word("b", 2.8, 3.2),
    word("c", 4.5, 4.8),
    word("d", 9.2, 10),
    word("e", 10.1, 11),
  ];
  const silences = transcriptSilences(words, recorded);
  assert.deepEqual(
    silences.map(({ id, start, end, after, length }) => ({
      id,
      start,
      end,
      after,
      length: +length.toFixed(6),
    })),
    [
      { id: "silence:start", start: 1, end: 2, after: -1, length: 1 },
      { id: "silence:b", start: 3.2, end: 4.5, after: 1, length: 1.3 },
      { id: "silence:c", start: 4.8, end: 9.2, after: 2, length: 0.4 },
      { id: "silence:e", start: 11, end: 13, after: 4, length: 2 },
    ].filter((silence) => silence.length >= 0.5),
    "Short gaps and recording pauses aren't silence",
  );
  assert.equal(
    transcriptSilences(words, recorded, 0.3)
      .find((silence) => silence.after === 2)
      ?.length.toFixed(6),
    "0.400000",
    "Only recorded time counts",
  );
  assert.deepEqual(
    silenceCut(silences[0], words.length),
    { start: 1, end: 1.85 },
    "Leading silence keeps padding before the first word",
  );
  assert.deepEqual(silenceCut(silences[1], words.length), { start: 3.35, end: 4.35 });
  assert.deepEqual(
    silenceCut(silences[2], words.length),
    { start: 11.15, end: 13 },
    "Trailing silence keeps padding after the last word",
  );
  assert.deepEqual(
    silenceCut(silences[1], words.length, 0),
    { start: 3.2, end: 4.5 },
    "No padding cuts the whole silence",
  );
  assert.deepEqual(
    silenceCut(silences[1], words.length, 0.5),
    { start: 3.7, end: 4 },
    "Padding is kept at each end",
  );
  assert.deepEqual(
    silenceCut(silences[1], words.length, 5),
    { start: 3.85, end: 3.85 },
    "Padding stops at half the silence",
  );
  assert.deepEqual(transcriptSilences([], recorded), []);

  const { parts } = sequence([{ id: "r", recordingId: "r", timeline }]);
  const removed = cutTranscriptRanges(
    parts,
    "r",
    silences.map((silence) => silenceCut(silence, words.length)),
    5,
    () => crypto.randomUUID(),
  );
  assert.equal(removed.changed, true);
  const ranges = transcriptRanges(removed.parts, "r");
  assert.deepEqual(
    silences.map((silence) => +keptLength(silence, ranges).toFixed(6)),
    [0.15, 0.3, 0.15],
    "Each silence is shortened to its padding",
  );
  assert.ok(
    words.every((word) => keptLength(word, ranges) > word.end - word.start - 1e-6),
    "No words are clipped",
  );
  assert.equal(
    +removed.time.toFixed(6),
    3.15,
    "The playhead moves back by what was removed before it",
  );
  assert.equal(
    +transcriptSessionTime(ranges, removed.time)!.toFixed(6),
    10,
    "and stays on the same source moment",
  );
  const again = cutTranscriptRanges(
    removed.parts,
    "r",
    [{ start: 1, end: 1.85 }],
    0,
    () => "unused",
  );
  assert.equal(again.changed, false, "Removing again changes nothing");
});

test("a microphone is transcribed from the file its source chooses, counted among the microphones that recorded anything", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "chord-transcription-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const transcribed: string[] = [];
  const chosen: [string, number][] = [];
  const service = new RecordingTranscriptions({
    load: async () =>
      manifest([
        track("empty", "microphone", []),
        track("mic1", "microphone", [{ file: "a.m4a", start: 0, end: 2 }]),
        track("mic2", "microphone", [
          { file: "b.m4a", start: 0, end: 2 },
          { file: "c.m4a", start: 3, end: 5 },
        ]),
      ]),
    model: async () => ({ id: "local", model: "local" }),
    // The second microphone has a cleaned copy of its first file only.
    source: (_directory, file, microphone) => {
      chosen.push([file, microphone]);
      return file === "b.m4a" ? join(directory, "cleaned-b.wav") : join(directory, file);
    },
    transcribe: async (file) => {
      transcribed.push(file.split("/").at(-1)!);
      return { words: [{ start: 0, end: 1, text: "Hello" }] };
    },
    duration: async () => 2,
    change: () => {},
  });
  context.after(() => service.dispose());
  await service.start(directory);
  await waitFor(async () => (await service.get(directory)).phase === "done");
  assert.deepEqual(
    chosen,
    [
      ["a.m4a", 0],
      ["b.m4a", 1],
      ["c.m4a", 1],
    ],
    "an empty track doesn't count, as it doesn't for the audio settings",
  );
  assert.deepEqual(transcribed, ["a.m4a", "cleaned-b.wav", "c.m4a"]);
});
