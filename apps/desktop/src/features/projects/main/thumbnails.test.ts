import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { noAnnotations } from "#features/editing/domain/annotations";
import { ProjectThumbnails, type ThumbnailDependencies } from "./thumbnails.ts";
import { initialSetup, type Project, type Recording } from "#project-document/domain/recording";
import {
  THUMBNAIL_FRACTIONS,
  THUMBNAILS_FOLDER,
  THUMBNAILS_LOCK,
  THUMBNAILS_MANIFEST,
  isThumbnailManifest,
  seenProject,
} from "../contracts/thumbnails.ts";

const THRESHOLD = 60_000;

function recording(directory: string | null, extra: Partial<Recording> = {}): Recording {
  return {
    id: "take",
    createdAt: "2026-01-01T00:00:00.000Z",
    duration: 10,
    mode: "display",
    hasMicrophone: true,
    hasCamera: false,
    hasSystemAudio: false,
    markCount: 0,
    pageChanges: [],
    annotations: noAnnotations(),
    directory,
    ...extra,
  };
}

function project(recordings: Recording[], extra: Partial<Project> = {}): Project {
  return {
    id: "project",
    name: "Demo",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    notes: [],
    setup: initialSetup(),
    recordings,
    ...extra,
  };
}

const rendered = () => ({
  duration: 20,
  aspect: 16 / 9,
  captionStyle: "lines" as const,
  captions: [{ start: 1, end: 2, words: [{ text: "Hello", start: 1 }] }],
  frames: THUMBNAIL_FRACTIONS.map((fraction) => ({
    time: fraction * 20,
    image: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  })),
});

/** A recordings folder with one project folder and session, and thumbnails watching `projects`. */
function setUp(
  run: (context: {
    root: string;
    session: string;
    thumbnailsFolder: string;
    projects: Project[];
    renders: Project[];
    changes: string[];
    clock: { now: number };
    thumbnails: ProjectThumbnails;
    dependencies: ThumbnailDependencies;
  }) => Promise<void>,
) {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), "chord-thumbnails-"));
    const session = join(root, "Demo", "session-1");
    mkdirSync(session, { recursive: true });
    writeFileSync(join(session, "session.json"), "{}");
    const projects = [project([recording(session)])];
    const renders: Project[] = [];
    const changes: string[] = [];
    const clock = { now: Date.parse("2026-05-01T00:00:00.000Z") };
    const dependencies: ThumbnailDependencies = {
      projects: () => projects,
      root,
      busy: () => false,
      now: () => clock.now,
      render: async (project) => {
        renders.push(project);
        return rendered();
      },
      changed: (projectId) => changes.push(projectId),
    };
    const thumbnails = new ProjectThumbnails(dependencies, {
      threshold: THRESHOLD,
      retry: THRESHOLD * 5,
    });
    try {
      await run({
        root,
        session,
        thumbnailsFolder: join(root, "Demo", THUMBNAILS_FOLDER),
        projects,
        renders,
        changes,
        clock,
        thumbnails,
        dependencies,
      });
    } finally {
      thumbnails.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  };
}

test(
  "a project with a recording and no thumbnails renders them at once, into its Thumbnails folder",
  setUp(async ({ thumbnailsFolder, renders, changes, thumbnails }) => {
    await thumbnails.sweep();
    assert.equal(renders.length, 1);
    assert.deepEqual(changes, ["project"]);
    assert.deepEqual(
      readdirSync(thumbnailsFolder).sort(),
      [...THUMBNAIL_FRACTIONS.map((f) => `${Math.round(f * 100)}.jpg`), THUMBNAILS_MANIFEST].sort(),
      "Nothing half written or locked is left behind",
    );
    const manifest: unknown = JSON.parse(
      readFileSync(join(thumbnailsFolder, THUMBNAILS_MANIFEST), "utf8"),
    );
    assert.ok(isThumbnailManifest(manifest));
    assert.equal(manifest.frames[0]!.file, "10.jpg");
    assert.deepEqual(manifest.captions[0]!.words, [{ text: "Hello", start: 1 }]);

    const set = await thumbnails.get("project");
    assert.equal(set?.frames.length, 9);
    assert.match(set!.frames[0]!.url, /^chord-media:\/\/thumbnail\/project\/10\.jpg\?v=/);
    assert.equal(thumbnails.path("project", "10.jpg"), join(thumbnailsFolder, "10.jpg"));
    assert.equal(
      thumbnails.path("project", "../session-1/session.json"),
      undefined,
      "Only thumbnail images are served",
    );
    assert.equal(thumbnails.path("project", THUMBNAILS_MANIFEST), undefined);
  }),
);

test(
  "an unchanged project isn't rendered again",
  setUp(async ({ renders, clock, thumbnails }) => {
    await thumbnails.sweep();
    clock.now += THRESHOLD * 10;
    await thumbnails.sweep();
    assert.equal(renders.length, 1);
  }),
);

test(
  "a change renders again only once the last render is old enough",
  setUp(async ({ projects, renders, clock, thumbnails }) => {
    await thumbnails.sweep();
    projects[0] = { ...projects[0]!, captions: { style: "word", length: "short" } };
    clock.now += THRESHOLD / 2;
    await thumbnails.sweep();
    assert.equal(renders.length, 1, "Too soon after the last render");
    clock.now += THRESHOLD;
    await thumbnails.sweep();
    assert.equal(renders.length, 2);
    assert.equal(renders[1]!.captions?.style, "word");
  }),
);

test(
  "files written to a session folder count as changes, wherever they come from",
  setUp(async ({ session, projects, thumbnails }) => {
    const before = await thumbnails.fingerprint(projects[0]!);
    writeFileSync(
      join(session, "transcript.json"),
      JSON.stringify({ version: 1, model: "test", cues: [] }),
    );
    const transcribed = await thumbnails.fingerprint(projects[0]!);
    assert.notEqual(transcribed, before);
    writeFileSync(join(session, "background.json"), "{}");
    assert.notEqual(await thumbnails.fingerprint(projects[0]!), transcribed);
  }),
);

test(
  "edits that don't show in the video don't count as changes",
  setUp(async ({ projects, thumbnails }) => {
    const original = projects[0]!;
    const before = await thumbnails.fingerprint(original);
    const renamed = {
      ...original,
      name: "Renamed",
      updatedAt: "2026-06-01T00:00:00.000Z",
      notes: [{ id: "n", title: "Intro", body: "Hi" }],
    };
    assert.equal(await thumbnails.fingerprint(renamed), before);
    const marked = { ...original, recordings: [{ ...original.recordings[0]!, markCount: 4 }] };
    assert.equal(await thumbnails.fingerprint(marked), before);
    const backdrop = {
      ...original,
      recordings: [{ ...original.recordings[0]!, backdrop: "gradient" as const }],
    };
    assert.notEqual(await thumbnails.fingerprint(backdrop), before);
    assert.ok(!("name" in seenProject(original)));
  }),
);

test(
  "another process's lock is respected, and an abandoned one taken over",
  setUp(async ({ thumbnailsFolder, renders, clock, thumbnails }) => {
    mkdirSync(thumbnailsFolder, { recursive: true });
    const lock = join(thumbnailsFolder, THUMBNAILS_LOCK);
    // The parent process is alive and isn't this one.
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, at: clock.now }));
    await thumbnails.sweep();
    assert.equal(renders.length, 0);
    assert.ok(existsSync(lock), "Another process's lock is left alone");

    clock.now += 10 * 60_000;
    await thumbnails.sweep();
    assert.equal(renders.length, 1, "A lock held too long is abandoned");
    assert.ok(!existsSync(lock));
  }),
);

test(
  "a lock left by a process that's gone is taken over at once",
  setUp(async ({ thumbnailsFolder, renders, clock, thumbnails }) => {
    mkdirSync(thumbnailsFolder, { recursive: true });
    writeFileSync(
      join(thumbnailsFolder, THUMBNAILS_LOCK),
      JSON.stringify({ pid: 2 ** 22 + 1234, at: clock.now }),
    );
    await thumbnails.sweep();
    assert.equal(renders.length, 1);
  }),
);

test(
  "nothing renders while something more important is happening",
  setUp(async ({ renders, thumbnails, dependencies }) => {
    dependencies.busy = () => true;
    await thumbnails.sweep();
    assert.equal(renders.length, 0);
  }),
);

test(
  "a failed render waits before trying again, unless the project changes",
  setUp(async ({ projects, renders, clock, thumbnails, dependencies }) => {
    dependencies.render = async (project) => {
      renders.push(project);
      throw new Error("Broken");
    };
    await thumbnails.sweep();
    await thumbnails.sweep();
    assert.equal(renders.length, 1);
    projects[0] = {
      ...projects[0]!,
      recordings: [{ ...projects[0]!.recordings[0]!, backdrop: "black" }],
    };
    await thumbnails.sweep();
    assert.equal(renders.length, 2);
    clock.now += THRESHOLD * 5;
    await thumbnails.sweep();
    assert.equal(renders.length, 3);
  }),
);

test(
  "a render that isn't a full set of JPEGs isn't kept",
  setUp(async ({ thumbnailsFolder, changes, thumbnails, dependencies }) => {
    dependencies.render = async () => ({ ...rendered(), frames: rendered().frames.slice(1) });
    await thumbnails.sweep();
    assert.deepEqual(changes, []);
    assert.ok(!existsSync(join(thumbnailsFolder, THUMBNAILS_MANIFEST)));
    assert.equal(await thumbnails.get("project"), null);
  }),
);

test(
  "projects with nothing recorded, or recorded elsewhere, have no thumbnails",
  setUp(async ({ projects, renders, thumbnails }) => {
    projects[0] = project([]);
    projects.push(project([recording(join(tmpdir(), "elsewhere", "session"))], { id: "outside" }));
    projects.push(project([recording(null)], { id: "placeholder" }));
    await thumbnails.sweep();
    assert.equal(renders.length, 0);
    assert.equal(await thumbnails.get("project"), null);
  }),
);

test(
  "a recording taken off the edit's tracks isn't rendered",
  setUp(async ({ projects, renders, thumbnails }) => {
    projects[0] = { ...projects[0]!, pieces: [] };
    await thumbnails.sweep();
    assert.equal(renders.length, 0);
  }),
);
