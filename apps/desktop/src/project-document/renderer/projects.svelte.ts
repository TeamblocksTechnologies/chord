import { tick, untrack } from "svelte";
import { noAnnotations } from "#features/editing/domain/annotations";
import { initialSetup } from "../domain/recording.ts";
import { desktop } from "#platform/renderer/desktop.svelte";
import { upgradeProject, upgradeSetup, type StoredSetup } from "./projectUpgrade.ts";
import { defaultDevice, sources } from "#features/recording/renderer/sources.svelte";
import type { Project, Recording, RecordingSetup } from "../domain/recording.ts";

const PROJECTS_KEY = "chord.projects.v1";
const DEFAULTS_KEY = "chord.defaults.v1";

function load<T>(key: string, fallback: () => T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback();
  } catch {
    return fallback();
  }
}

const storedDefaults = load<StoredSetup | null>(DEFAULTS_KEY, () => null);
const isMain = window.chord.surface === "main";

/**
 * The main process keeps the project library (see `main/projects.ts`); each window that shows projects edits a
 * reactive copy, and changed projects are sent back whole. Quick-start defaults are a reactive view of the main
 * process's shared setup; legacy localStorage defaults seed the initial migration and remain mirrored for
 * compatibility.
 */
class ProjectStore {
  projects = $state<Project[]>([]);
  /** Whether the library has arrived from the main process. */
  loaded = $state(false);
  /** Each project as the main process last had it, to tell which ones this window changed. */
  #synced = new Map<string, string>();
  #saving: Promise<unknown> = Promise.resolve();
  /** What a quick-start recording on the home screen uses, and what new projects start from. */
  #legacyDefaults = $state<RecordingSetup>({
    ...initialSetup(),
    ...upgradeSetup(storedDefaults ?? {}),
  });
  get defaults(): RecordingSetup {
    return desktop.defaults ?? this.#legacyDefaults;
  }
  set defaults(setup: RecordingSetup) {
    desktop.defaults = setup;
  }

  /** Most recently touched first. */
  recent = $derived([...this.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));

  constructor() {
    // Fresh defaults, and defaults that only had placeholder microphones, get the system default microphone.
    const hadMicrophone = !!storedDefaults?.microphoneId || !!storedDefaults?.microphoneIds?.length;
    let pickMicrophone =
      isMain &&
      this.defaults.microphoneIds.length === 0 &&
      (storedDefaults === null || hadMicrophone);

    window.chord.desktop.projects.onChange(({ put, removed }) => {
      for (const stored of put) {
        this.#synced.set(stored.id, JSON.stringify(stored));
        const project = upgradeProject(stored);
        const index = this.projects.findIndex((p) => p.id === project.id);
        if (index === -1) this.projects.push(project);
        else this.projects[index] = project;
      }
      for (const id of removed) this.#synced.delete(id);
      if (removed.length > 0) this.projects = this.projects.filter((p) => !removed.includes(p.id));
    });
    // Projects were kept in localStorage before the main process kept them; the main window hands them over once.
    const legacy = isMain
      ? load<Project[] | null>(PROJECTS_KEY, () => (import.meta.env.DEV ? sampleProjects() : null))
      : null;
    // Upgraded first: older notes weren't a list of pages yet.
    void window.chord.desktop.projects.load(legacy?.map(upgradeProject)).then((stored) => {
      if (isMain) localStorage.removeItem(PROJECTS_KEY);
      for (const project of stored) this.#synced.set(project.id, JSON.stringify(project));
      // Kept: anything created before the library arrived.
      this.projects = [
        ...stored.map(upgradeProject),
        ...this.projects.filter((p) => !this.#synced.has(p.id)),
      ];
      this.loaded = true;
    });

    $effect.root(() => {
      $effect(() => {
        const microphone = defaultDevice(sources.microphones);
        if (!pickMicrophone || !microphone) return;
        pickMicrophone = false;
        untrack(() => (this.defaults.microphoneIds = [microphone.id]));
      });
      $effect(() => this.#save());
      if (isMain) $effect(() => localStorage.setItem(DEFAULTS_KEY, JSON.stringify(this.defaults)));
    });
  }

  /** Sends the projects added, changed, or removed here since they were last sent. Reads every project, so call from an effect. */
  #save(): void {
    const changed: Project[] = [];
    const present = new Set<string>();
    for (const project of this.projects) {
      const json = JSON.stringify(project);
      present.add(project.id);
      if (this.loaded && this.#synced.get(project.id) !== json) {
        this.#synced.set(project.id, json);
        changed.push(JSON.parse(json) as Project);
      }
    }
    if (!this.loaded) return;
    const removed = [...this.#synced.keys()].filter((id) => !present.has(id));
    for (const id of removed) this.#synced.delete(id);
    const library = window.chord.desktop.projects;
    if (changed.length > 0) this.#saving = this.#saving.then(() => library.put(changed));
    if (removed.length > 0) this.#saving = this.#saving.then(() => library.remove(removed));
  }

  /** Waits until this window's changes so far have reached the main process, e.g. before another window shows them. */
  async saved(): Promise<void> {
    await tick();
    await this.#saving;
  }

  get(id: string): Project | undefined {
    return this.projects.find((p) => p.id === id);
  }

  create(fields: Partial<Pick<Project, "name" | "notes" | "setup">> = {}): Project {
    const now = new Date().toISOString();
    const project: Project = {
      id: crypto.randomUUID(),
      name: fields.name ?? "Untitled project",
      createdAt: now,
      updatedAt: now,
      notes: fields.notes ?? [],
      setup: structuredClone($state.snapshot(fields.setup ?? this.defaults)),
      recordings: [],
    };
    this.projects.push(project);
    // Return the reactive proxy so callers' edits are tracked.
    return this.get(project.id)!;
  }

  touch(project: Project): void {
    project.updatedAt = new Date().toISOString();
  }

  /** Applies one feature-owned edit, then lets the existing save pipeline persist it. */
  change<T>(project: Project, edit: (draft: Project) => T): T {
    const result = edit(project);
    this.touch(project);
    return result;
  }

  /** Deletes a project, moving its recordings to the Trash. */
  remove(id: string): void {
    const project = this.get(id);
    this.projects = this.projects.filter((p) => p.id !== id);
    if (project) trash(project.recordings);
  }

  addRecording(project: Project, recording: Recording): void {
    project.recordings.push(recording);
    // An edited project plays a new recording at its end.
    project.pieces?.push({
      id: crypto.randomUUID(),
      recordingId: recording.id,
      start: 0,
      end: null,
    });
    this.touch(project);
  }

  /** Deletes a recording, moving its files to the Trash. */
  removeRecording(project: Project, recordingId: string): void {
    trash(project.recordings.filter((r) => r.id === recordingId));
    project.recordings = project.recordings.filter((r) => r.id !== recordingId);
    if (project.pieces)
      project.pieces = project.pieces.filter((piece) => piece.recordingId !== recordingId);
    this.touch(project);
  }
}

function trash(recordings: Recording[]): void {
  const directories = recordings.flatMap((r) => (r.directory ? [r.directory] : []));
  if (directories.length > 0) void window.chord.desktop.recording.trash(directories);
}

export const projectStore = new ProjectStore();

export { projectFolder, quickProjectName } from "#features/recording/domain/session";

export function totalDuration(project: Project): number {
  return project.recordings.reduce((sum, r) => sum + r.duration, 0);
}

function sampleProjects(): Project[] {
  const daysAgo = (days: number, hours = 0) =>
    new Date(Date.now() - (days * 24 + hours) * 3_600_000).toISOString();
  const take = (
    createdAt: string,
    duration: number,
    extra: Partial<Recording> = {},
  ): Recording => ({
    id: crypto.randomUUID(),
    createdAt,
    duration,
    mode: "display",
    hasMicrophone: true,
    hasCamera: false,
    hasSystemAudio: false,
    markCount: 0,
    pageChanges: [],
    annotations: noAnnotations(),
    directory: null,
    ...extra,
  });
  const setup = initialSetup();
  const page = (title: string, body: string) => ({ id: crypto.randomUUID(), title, body });
  return [
    {
      id: crypto.randomUUID(),
      name: "Onboarding walkthrough",
      createdAt: daysAgo(6),
      updatedAt: daysAgo(0, 2),
      notes: [
        page("Sign up flow", "Start from the marketing site.\nShow the email sign-up, not Google."),
        page(
          "Create first workspace",
          'Name it something real, like "Acme Design".\nPoint out the template picker.',
        ),
        page(
          "Invite a teammate",
          "Use the share link.\nMention the keyboard shortcuts at the end.",
        ),
      ],
      setup: { ...setup, mode: "window", allowedApps: ["com.google.Chrome"] },
      recordings: [
        take(daysAgo(6), 312, { mode: "window", hasCamera: true, markCount: 3 }),
        take(daysAgo(0, 2), 148, { mode: "window", hasCamera: true, markCount: 1 }),
      ],
    },
    {
      id: crypto.randomUUID(),
      name: "Bug repro: export stalls at 99%",
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
      notes: [],
      setup,
      recordings: [take(daysAgo(1), 74, { hasSystemAudio: true })],
    },
    {
      id: crypto.randomUUID(),
      name: "Q4 roadmap talk",
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
      notes: [
        page("Intro", "Why we're focusing on reliability this quarter."),
        page("Three themes", "Speed, polish, integrations."),
        page("Close", "Finish on the timeline slide."),
      ],
      setup: { ...setup, mode: "window", allowedApps: ["com.apple.iWork.Keynote"], quality: "max" },
      recordings: [],
    },
    {
      id: crypto.randomUUID(),
      name: "Design review — settings panel",
      createdAt: daysAgo(4),
      updatedAt: daysAgo(4),
      notes: [],
      setup: { ...setup, mode: "area" },
      recordings: [take(daysAgo(4), 421, { mode: "area", markCount: 5 })],
    },
    {
      id: crypto.randomUUID(),
      name: "PR #482 walkthrough",
      createdAt: daysAgo(9),
      updatedAt: daysAgo(9),
      notes: [],
      setup,
      recordings: [take(daysAgo(9), 203)],
    },
  ];
}
