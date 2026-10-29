import assert from "node:assert/strict";
import { test } from "node:test";
import type { RecordingTranscript } from "../domain/captions.ts";
import type { Project } from "#project-document/domain/recording";
import {
  highlightTranscriptMatch,
  searchTerms,
  searchTranscript,
} from "../contracts/transcriptSearch.ts";
import { TranscriptSearch } from "./transcriptSearch.ts";

// Session time 0 to 10 and 20 to 30 were recorded; 10 to 20 was a pause. Recording time is 0 to 20.
const clips = [
  { start: 0, duration: 10, offset: 0 },
  { start: 20, duration: 10, offset: 10 },
];
const word = (text: string, start: number) => ({ text, start, end: start + 0.5 });
const transcript: RecordingTranscript = {
  version: 1,
  model: "test",
  cues: [
    {
      id: "a",
      trackId: "mic",
      text: "Hello Chord world",
      start: 1,
      end: 3,
      words: [word("Hello", 1), word("Chord", 2), word("world", 2.5)],
    },
    {
      id: "b",
      trackId: "mic",
      text: "Café déjà vu",
      start: 21,
      end: 23,
      words: [word("Café", 21), word("déjà", 22), word("vu", 22.5)],
    },
    {
      id: "c",
      trackId: "other",
      text: "Chord again",
      start: 5,
      end: 6,
      words: [word("Chord", 5), word("again", 5.5)],
    },
  ],
};

test("search terms ignore case, accents, and punctuation", () => {
  assert.deepEqual(searchTerms("  Café, DÉJÀ!  --  "), ["cafe", "deja"]);
  assert.deepEqual(searchTerms("?!"), []);
});

test("a word is found inside other words, with its time on the recording clock and the words around it", () => {
  const [hit] = searchTranscript(transcript, clips, [], "hor");
  assert.deepEqual(hit, { time: 2, before: "Hello", match: "Chord", after: "world Café déjà vu" });
  assert.deepEqual(highlightTranscriptMatch(hit, "hor"), {
    before: "Hello C",
    match: "hor",
    after: "d world Café déjà vu",
  });
  // Words after the pause are placed on the pause-free clock.
  assert.equal(searchTranscript(transcript, clips, [], "cafe")[0].time, 11);
  assert.equal(searchTranscript(transcript, clips, [], "CAFÉ")[0].match, "Café");
});

test("a phrase matches whole words with partial words at its edges, and never crosses microphones", () => {
  assert.equal(searchTranscript(transcript, clips, [], "hello chord")[0].match, "Hello Chord");
  assert.deepEqual(
    highlightTranscriptMatch(searchTranscript(transcript, clips, [], "ello cho")[0], "ello cho"),
    {
      before: "H",
      match: "ello Cho",
      after: "rd world Café déjà vu",
    },
  );
  assert.deepEqual(searchTranscript(transcript, clips, [], "hel chord"), []);
  assert.deepEqual(searchTranscript(transcript, clips, [], "world chord"), []);
  assert.deepEqual(searchTranscript(transcript, clips, [], "chord"), [
    { time: 2, before: "Hello", match: "Chord", after: "world Café déjà vu" },
    { time: 5, before: "", match: "Chord", after: "again" },
  ]);
});

test("partial phrase highlighting stops at the exact query characters", () => {
  const spoken: RecordingTranscript = {
    version: 1,
    model: "test",
    cues: [{ id: "a", trackId: "mic", text: "see how well it works.", start: 1, end: 4 }],
  };
  const hit = highlightTranscriptMatch(searchTranscript(spoken, clips, [], "well i")[0], "well i");
  assert.equal(hit.before, "see how ");
  assert.equal(hit.match, "well i");
  assert.equal(hit.after, "t works.");
  assert.equal(hit.before + hit.match + hit.after, spoken.cues[0].text);
});

test("whole-word highlights keep spaces on both sides of the highlighted text", () => {
  // The search process returns word-based context, including while the view is hot-reloaded.
  const snippet = highlightTranscriptMatch(
    { time: 1, before: "see how", match: "well it", after: "works." },
    "well it",
  );
  assert.deepEqual(snippet, { before: "see how ", match: "well it", after: " works." });
  assert.equal(snippet.before + snippet.match + snippet.after, "see how well it works.");
  assert.deepEqual(
    highlightTranscriptMatch({ time: 1, before: "", match: "well", after: "" }, "well"),
    {
      before: "",
      match: "well",
      after: "",
    },
  );
});

test("highlight boundaries preserve original accents, punctuation, and Unicode characters", () => {
  const cases = [
    { text: "(Café!)", query: "afe", before: "(C", match: "afé", after: "!)" },
    { text: "Cafe\u0301!", query: "fe", before: "Ca", match: "fe\u0301", after: "!" },
    { text: "don't!", query: "ont", before: "d", match: "on't", after: "!" },
    { text: "oﬃce!", query: "ffi", before: "o", match: "ﬃ", after: "ce!" },
    { text: "𐐀bc!", query: "bc", before: "𐐀", match: "bc", after: "!" },
    { text: "(Café déjà!)", query: "afe de", before: "(C", match: "afé dé", after: "jà!)" },
  ];
  for (const { text, query, before, match, after } of cases) {
    const spoken: RecordingTranscript = {
      version: 1,
      model: "test",
      cues: [{ id: "a", trackId: "mic", text, start: 1, end: 3 }],
    };
    assert.deepEqual(
      highlightTranscriptMatch(searchTranscript(spoken, clips, [], query)[0], query),
      { before, match, after },
    );
  }
});

test("cut words are not found and a phrase can span a cut", () => {
  assert.deepEqual(
    searchTranscript(transcript, clips, [{ start: 2, end: 3 }], "chord", 1)[0].time,
    5,
  );
  // "Chord" at 2 to 2.5 is cut, so "Hello" and "world" are neighbours.
  const [hit] = searchTranscript(transcript, clips, [{ start: 1.9, end: 2.4 }], "hello world");
  assert.equal(hit.match, "Hello world");
  assert.equal(hit.time, 1);
  assert.deepEqual(searchTranscript(transcript, clips, [{ start: 0, end: 20 }], "chord"), []);
});

test("words spoken in a pause have no place on the recording and cues without word timings are spread across their span", () => {
  const paused = {
    ...transcript,
    cues: [
      { id: "p", trackId: "mic", text: "lost words", start: 12, end: 14 },
      { id: "q", trackId: "mic", text: "one two three", start: 3, end: 6 },
    ],
  };
  assert.deepEqual(searchTranscript(paused, clips, [], "lost"), []);
  assert.equal(searchTranscript(paused, clips, [], "two")[0].time, 4);
});

test("a result limit keeps the earliest", () => {
  assert.deepEqual(
    searchTranscript(transcript, clips, [], "chord", 1).map((hit) => hit.time),
    [2],
  );
});

const recording = (
  id: string,
  directory: string | null,
  cuts: Project["recordings"][number]["cuts"] = undefined,
) => ({ id, directory, cuts }) as Project["recordings"][number];
const project = (id: string, updatedAt: string, recordings: Project["recordings"]) =>
  ({ id, name: id, updatedAt, recordings }) as Project;

test("library search reads each transcript once until it changes, orders by recent projects, and isolates failures", async () => {
  const reads: string[] = [];
  const projects = [
    project("old", "2026-01-01", [recording("r1", "/a")]),
    project("new", "2026-02-01", [
      recording("r2", "/b", [{ start: 0, end: 4 }]),
      recording("r3", "/missing"),
      recording("r4", null),
    ]),
  ];
  let current = transcript;
  const search = new TranscriptSearch({
    projects: () => projects,
    async transcript(directory) {
      reads.push(directory);
      if (directory === "/missing") throw new Error("gone");
      return current;
    },
    async clips() {
      return clips;
    },
  });
  const first = await search.search("chord");
  // /b has the first Chord cut away, leaving only the other microphone's.
  assert.deepEqual(
    first.map((hit) => [hit.projectId, hit.recordingId, hit.time]),
    [
      ["new", "r2", 5],
      ["old", "r1", 2],
      ["old", "r1", 5],
    ],
  );
  await search.search("world");
  assert.equal(reads.filter((directory) => directory === "/a").length, 1);
  // A failed recording is tried again, not remembered as empty.
  assert.equal(reads.filter((directory) => directory === "/missing").length, 2);

  current = {
    ...transcript,
    cues: [{ id: "n", trackId: "mic", text: "fresh text", start: 1, end: 2 }],
  };
  assert.equal((await search.search("fresh")).length, 0);
  search.invalidate("/a");
  assert.deepEqual(
    (await search.search("fresh")).map((hit) => hit.recordingId),
    ["r1"],
  );
  assert.deepEqual(await search.search("x"), []);
  assert.deepEqual(await search.search("?!"), []);
});
