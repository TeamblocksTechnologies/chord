import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectLibrary } from "./projects.ts";
import { initialSetup, type Project } from "#project-document/domain/recording";

const project = (id: string, createdAt = "2026-01-01T00:00:00.000Z"): Project => ({
  id,
  name: id,
  createdAt,
  updatedAt: createdAt,
  notes: [],
  setup: initialSetup(),
  recordings: [],
});

function withLibrary(run: (directory: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "chord-projects-"));
  try {
    run(join(root, "projects"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("legacy projects are imported once, keeping projects created meanwhile", () =>
  withLibrary((directory) => {
    const library = new ProjectLibrary(directory);
    library.put([project("new", "2026-03-01T00:00:00.000Z")]);
    const imported = library.import([project("old"), project("new"), { id: "../bad" }]);
    assert.deepEqual(
      imported.map((p) => p.id),
      ["old"],
    );
    assert.deepEqual(library.import([project("again")]), []);
    library.flush();
    assert.deepEqual(
      new ProjectLibrary(directory).projects.map((p) => p.id),
      ["old", "new"],
    );
    assert.deepEqual(
      new ProjectLibrary(directory).import([project("later")]),
      [],
      "An existing library is never imported into",
    );
  }));

test("each project is its own file, and a damaged one loses only itself", () =>
  withLibrary((directory) => {
    const library = new ProjectLibrary(directory);
    library.import([]);
    library.put([project("a"), project("b")]);
    library.flush();
    assert.deepEqual(readdirSync(directory).sort(), ["a.json", "b.json"]);
    writeFileSync(join(directory, "b.json"), "{");
    assert.deepEqual(
      new ProjectLibrary(directory).projects.map((p) => p.id),
      ["a"],
    );
  }));

test("changes are written after a pause, and removals at once", () =>
  withLibrary((directory) => {
    const library = new ProjectLibrary(directory);
    library.import([project("a")]);
    library.put([{ ...project("a"), name: "Renamed" }]);
    assert.equal(
      JSON.parse(readFileSync(join(directory, "a.json"), "utf8")).name,
      "a",
      "Not yet written",
    );
    library.flush();
    assert.equal(JSON.parse(readFileSync(join(directory, "a.json"), "utf8")).name, "Renamed");
    assert.deepEqual(library.remove(["a", "missing"]).removed, ["a"]);
    assert.equal(existsSync(join(directory, "a.json")), false);
    assert.deepEqual(library.put([{ id: "x" }]).put, [], "Invalid projects are ignored");
  }));
