import assert from "node:assert/strict";
import { test } from "node:test";
import { initialSetup, type Project, type Recording } from "#project-document/domain/recording";
import type { ProjectDocuments } from "#project-document/domain/document";
import { noAnnotations } from "./annotations.ts";
import { createProjectEdits } from "./commands.ts";
import { addAnnotationTrack, duplicateAnnotationTrack, setCuts } from "./edits.ts";

function recording(id = "take"): Recording {
  return {
    id,
    createdAt: "2026-10-28T12:00:00Z",
    duration: 10,
    mode: "display",
    hasMicrophone: true,
    hasCamera: false,
    hasSystemAudio: false,
    markCount: 0,
    pageChanges: [],
    annotations: noAnnotations(),
    directory: null,
  };
}

function project(): Project {
  return {
    id: "project",
    name: "Example",
    createdAt: "2026-10-28T12:00:00Z",
    updatedAt: "2026-10-28T12:00:00Z",
    notes: [],
    setup: initialSetup(),
    recordings: [recording(), recording("other")],
  };
}

test("recording cuts ripple later placed clips, preserve layouts, and can be restored", () => {
  const edit = project();
  edit.pieces = [
    {
      id: "first",
      recordingId: "take",
      start: 0,
      end: null,
      offset: 0,
      cameraLayout: { position: "top-left", width: 0.3 },
    },
    { id: "later", recordingId: "other", start: 0, end: null, offset: 12 },
  ];
  setCuts(edit, "take", [{ start: 2, end: 4 }], () => 10);
  assert.equal(edit.pieces[1]!.offset, 10);
  assert.deepEqual(edit.pieces[0]!.cameraLayout, { position: "top-left", width: 0.3 });
  assert.equal(edit.recordings[1]!.cuts, undefined);
  setCuts(edit, "take", [], () => 10);
  assert.equal(edit.pieces[1]!.offset, 12);
  assert.equal(edit.recordings[0]!.cuts, undefined);
});

test("duplicated annotation tracks have independent identities, names and editable spans", () => {
  const take = recording();
  const first = addAnnotationTrack(take, "laser");
  first.spans.push({ start: 1, end: 4 });
  const second = duplicateAnnotationTrack(take, first, "Laser pointer");
  const third = duplicateAnnotationTrack(take, first, "Laser pointer");
  assert.notEqual(first.id, second.id);
  assert.equal(second.name, "Laser pointer 2");
  assert.equal(third.name, "Laser pointer 3");
  second.spans[0]!.start = 2;
  assert.equal(first.spans[0]!.start, 1);
  assert.equal(third.spans[0]!.start, 1);
});

test("feature commands modify the supplied document draft, including when the recording reference is stale", () => {
  const original = project();
  let saved: Project | undefined;
  let changes = 0;
  const documents: ProjectDocuments = {
    change<T>(current: Project, edit: (draft: Project) => T): T {
      const draft = structuredClone(current);
      const result = edit(draft);
      saved = draft;
      changes++;
      return result;
    },
  };
  const commands = createProjectEdits(documents);
  commands.setAudio(original, original.recordings[0]!, "microphone", 0, {
    volume: 0.4,
    muted: true,
  });
  assert.equal(changes, 1);
  assert.equal(original.recordings[0]!.audio, undefined);
  assert.equal(saved!.recordings[0]!.audio!["microphone:0"]!.volume, 0.4);
  const layer = commands.addAnnotationTrack(original, original.recordings[0]!, "keys");
  assert.equal(changes, 2);
  assert.ok(saved!.recordings[0]!.visualLayers!.some((item) => item.id === layer.id));
  assert.equal(original.recordings[0]!.visualLayers, undefined);
  commands.setCuts(original, "missing", [], () => 10);
  assert.equal(changes, 2, "A missing recording does not create a document change");
});
