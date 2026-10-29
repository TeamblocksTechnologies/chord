import {
  noAnnotations,
  normalizeSpans,
  type AnnotationKind,
  type Annotations,
} from "#features/editing/domain/annotations";
import { addPageChange, isNotePages, type NotePage, type PageChange } from "../domain/notes.ts";
import {
  idleRecording,
  type FinishedRecording,
  type RecordingState,
  type UsedSources,
} from "#platform/contracts/desktop";
import {
  activeCameraIds,
  activeMicrophoneIds,
  capturesScreen,
  isRecordingSetup,
  liveChangeError,
  recordsAnything,
  type RecordingSetup,
} from "#project-document/domain/recording";
import { quickProjectName } from "../domain/session.ts";

const noSources = (): UsedSources => ({
  screen: false,
  camera: false,
  microphone: false,
  systemAudio: false,
});

/** What records a session: the recorder helper, or nothing in tests. Calls are made one at a time, in order. */
export interface CaptureBackend {
  /** Gets the devices `setup` records ready ahead of `start`, so they don't delay it. Best effort. */
  prepare(setup: RecordingSetup): Promise<void>;
  /** Lets go of what `prepare` readied, when the session won't start. */
  release(): Promise<void>;
  /** Starts recording `setup` in a session folder inside `folder`, and returns the session folder. */
  start(setup: RecordingSetup, folder: string): Promise<string | null>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  addMark(): Promise<void>;
  /** Makes the session record `setup` instead. Rejects changes it can't make, leaving the session as it was. */
  update(setup: RecordingSetup): Promise<void>;
  /** Finalizes the session's files. */
  stop(): Promise<void>;
  /** Removes a discarded session's folder. */
  discard(directory: string): Promise<void>;
}

const simulated: CaptureBackend = {
  prepare: async () => {},
  release: async () => {},
  start: async () => null,
  pause: async () => {},
  resume: async () => {},
  addMark: async () => {},
  update: async () => {},
  stop: async () => {},
  discard: async () => {},
};

/** Options for a new recording. */
export interface StartOptions {
  projectId?: string;
  notes?: NotePage[];
  /** The project's folder, inside the recordings folder. Defaults to a quick recording's project name. */
  folder?: string;
  /** Seconds counted down before capture starts; 0 starts immediately. */
  countdown?: number;
}

/**
 * One session clock for every window, driving the capture backend. The state changes as soon as the user acts, so
 * every window responds at once; the backend catches up in order. A session that ends by itself (a full disk, or
 * the helper quitting) is reported through `interrupted`.
 */
export class RecordingController {
  state: RecordingState = idleRecording();
  /** Bumped whenever the target's setup changes, including the session ending. */
  revision = 0;
  #used = noSources();
  #pageChanges: PageChange[] = [];
  #annotations = noAnnotations();
  #timer: ReturnType<typeof setInterval> | undefined;
  #tickedAt = 0;
  /** Whether the session clock runs: from when the backend started capturing. */
  #capturing = false;
  /** The backend's calls, in order. */
  #queue: Promise<unknown> = Promise.resolve();
  /** Bumped as each session starts and ends, so a finished session's late replies are ignored. */
  #session = 0;
  /** The backend starting this session; resolves to its folder. */
  #started: Promise<string | null> | null = null;
  #directory: string | null = null;
  #folder = "";
  /** The setup the backend last accepted, to fall back to when it rejects a change. */
  #applied: RecordingSetup | null = null;
  private changed: () => void;
  private backend: CaptureBackend;
  private failed: (message: string, take: FinishedRecording | null) => void;
  constructor(
    changed: () => void,
    backend: CaptureBackend = simulated,
    failed: (message: string, take: FinishedRecording | null) => void = () => {},
  ) {
    this.changed = changed;
    this.backend = backend;
    this.failed = failed;
  }

  start(
    setup: RecordingSetup,
    { projectId, notes = [], folder = "", countdown = 0 }: StartOptions = {},
  ): boolean {
    if (
      this.state.phase !== "idle" ||
      !isRecordingSetup(setup) ||
      !recordsAnything(setup) ||
      !isNotePages(notes)
    )
      return false;
    this.state = {
      ...idleRecording(),
      target: {
        projectId: projectId ?? null,
        setup: structuredClone(setup),
        startedAt: new Date().toISOString(),
        notes: structuredClone(notes),
      },
    };
    this.#session++;
    this.#started = null;
    this.#directory = null;
    this.#folder = folder || quickProjectName(new Date(this.state.target!.startedAt));
    this.#applied = null;
    this.#capturing = false;
    this.revision++;
    this.#used = noSources();
    this.#pageChanges = notes.length > 0 ? [{ at: 0, page: 0 }] : [];
    this.#annotations = noAnnotations();
    this.#use(setup);
    if (countdown > 0) {
      this.state.phase = "countdown";
      this.state.countdown = countdown;
      this.#prepare(setup);
      this.#timer = setInterval(() => {
        this.state.countdown--;
        if (this.state.countdown <= 0) this.#beginCapture();
        else this.changed();
      }, 1000);
    } else this.#beginCapture();
    this.changed();
    return true;
  }

  /**
   * Switches sources or quality while recording: the affected tracks end their segments and start new ones; the
   * session, its clock, and the other tracks carry on. Shows the change at once, and rejects (going back to the
   * last accepted setup) for changes the backend can't make.
   */
  async update(setup: RecordingSetup): Promise<void> {
    const target = this.state.target;
    if (!target || this.state.phase === "idle") throw new Error("Not recording");
    if (!isRecordingSetup(setup)) throw new Error("Invalid recording setup");
    const error = liveChangeError(target.setup, setup);
    if (error) throw new Error(error);
    target.setup = structuredClone(setup);
    this.revision++;
    this.#use(setup);
    this.changed();
    // During the countdown, starting records the latest setup.
    if (this.state.phase === "countdown") {
      this.#prepare(setup);
      return;
    }
    const session = this.#session;
    try {
      await this.#call(() => this.backend.update(setup));
      if (session === this.#session) this.#applied = structuredClone(setup);
    } catch (error) {
      if (session === this.#session && this.state.target === target && this.#applied) {
        target.setup = structuredClone(this.#applied);
        this.revision++;
        this.changed();
      }
      throw error;
    }
  }

  pause(): void {
    if (this.state.phase !== "recording") return;
    this.#tick();
    this.state.phase = "paused";
    void this.#call(() => this.backend.pause()).catch(
      this.#report("Could not pause the recording"),
    );
    this.changed();
  }

  resume(): void {
    if (this.state.phase !== "paused") return;
    this.#tickedAt = performance.now();
    this.state.phase = "recording";
    void this.#call(() => this.backend.resume()).catch(
      this.#report("Could not resume the recording"),
    );
    this.changed();
  }

  addMark(): void {
    if (this.state.phase !== "recording" && this.state.phase !== "paused") return;
    this.state.markCount++;
    void this.#call(() => this.backend.addMark()).catch(this.#report("Could not add the mark"));
    this.changed();
  }

  /** Shows notes page `page`. Changes during the countdown count from the start. */
  setPage(page: number): void {
    const { phase, target } = this.state;
    if (
      phase === "idle" ||
      !target ||
      !Number.isInteger(page) ||
      page < 0 ||
      page >= target.notes.length
    )
      return;
    if (page === this.state.page) return;
    this.#tick();
    this.#pageChanges = addPageChange(this.#pageChanges, this.state.elapsed, page);
    this.state.page = page;
    this.changed();
  }

  #canAnnotate(): boolean {
    const { phase, target } = this.state;
    return (
      (phase === "recording" || phase === "paused") && !!target && capturesScreen(target.setup)
    );
  }

  setLaser(on: boolean): void {
    this.#annotate("laser", on);
  }

  setClicks(on: boolean): void {
    this.#annotate("clicks", on);
  }

  setKeys(on: boolean): void {
    this.#annotate("keys", on);
  }

  /** Switches an effect on or off, noting when for the recording: a span opens and runs until it's switched off. */
  #annotate(kind: AnnotationKind, on: boolean): void {
    if (!this.#canAnnotate() || this.state[kind] === on) return;
    this.#tick();
    const spans = this.#annotations[kind];
    if (on) spans.push({ start: this.state.elapsed, end: Infinity });
    else if (spans.at(-1)?.end === Infinity) spans.at(-1)!.end = this.state.elapsed;
    this.state[kind] = on;
    this.changed();
  }

  /** Ends the session at once, and returns the take once its files are finalized. Null during the countdown. */
  async stop(): Promise<FinishedRecording | null> {
    const take = this.#take();
    if (!take) return null;
    const started = this.#started;
    if (!started) {
      this.cancel();
      return null;
    }
    this.#end();
    let directory: string | null;
    try {
      directory = await started;
    } catch (error) {
      // It never started, so there's nothing to keep.
      this.failed(error instanceof Error ? error.message : String(error), null);
      return null;
    }
    await this.#call(() => this.backend.stop()).catch(
      this.#report("Could not finish the recording"),
    );
    return { ...take, directory };
  }

  /** Ends the session and discards what it recorded. */
  cancel(): void {
    const started = this.#started;
    const counting = this.state.phase === "countdown";
    this.#end();
    if (!started) {
      if (counting)
        void this.#call(() => this.backend.release()).catch(
          this.#report("Could not release the devices"),
        );
      return;
    }
    void this.#call(async () => {
      const directory = await started.catch(() => undefined);
      if (directory === undefined) return;
      await this.backend.stop();
      if (directory) await this.backend.discard(directory);
    }).catch(this.#report("Could not discard the recording"));
  }

  /**
   * The session ended without being asked, e.g. the disk filled up or the helper quit: keeps what was recorded and
   * reports `message` with the take.
   */
  interrupted(message: string): void {
    const take = this.#take();
    if (!take || !this.#capturing) return;
    this.#end();
    this.failed(message, { ...take, directory: this.#directory });
  }

  /** Stops the clock for good, e.g. when the app quits. */
  dispose(): void {
    clearInterval(this.#timer);
    this.#session++;
  }

  #take(): Omit<FinishedRecording, "directory"> | null {
    const { target, phase } = this.state;
    if (!target || phase === "idle") return null;
    this.#tick();
    const { elapsed } = this.state;
    // Effects still on run to the end.
    const annotations = Object.fromEntries(
      Object.entries(this.#annotations).map(([kind, spans]) => [
        kind,
        normalizeSpans(spans, elapsed),
      ]),
    ) as Annotations;
    return {
      target,
      elapsed,
      markCount: this.state.markCount,
      pageChanges: this.#pageChanges,
      annotations,
      used: this.#used,
    };
  }

  #end(): void {
    clearInterval(this.#timer);
    if (this.state.target) this.revision++;
    this.state = idleRecording();
    this.#session++;
    this.#started = null;
    this.#capturing = false;
    this.changed();
  }

  /** Runs `call` after the backend calls before it. */
  #call<T>(call: () => Promise<T>): Promise<T> {
    const result = this.#queue.catch(() => {}).then(call);
    this.#queue = result;
    return result;
  }

  #report(what: string): (error: unknown) => void {
    return (error) => console.error(`${what}:`, error);
  }

  #use(setup: RecordingSetup): void {
    this.#used = {
      screen: this.#used.screen || capturesScreen(setup),
      camera: this.#used.camera || activeCameraIds(setup).length > 0,
      microphone: this.#used.microphone || activeMicrophoneIds(setup).length > 0,
      systemAudio: this.#used.systemAudio || setup.systemAudio,
    };
  }

  /** Readies the devices `setup` records while the countdown runs. */
  #prepare(setup: RecordingSetup): void {
    const prepared = structuredClone(setup);
    void this.#call(() => this.backend.prepare(prepared)).catch(
      this.#report("Could not prepare the devices"),
    );
  }

  #beginCapture(): void {
    clearInterval(this.#timer);
    this.state.phase = "recording";
    this.state.countdown = 0;
    const session = this.#session;
    const setup = structuredClone(this.state.target!.setup);
    this.#started = this.#call(() => this.backend.start(setup, this.#folder));
    this.#started.then(
      (directory) => {
        if (session !== this.#session) return;
        this.#directory = directory;
        this.#applied = setup;
        // The clock starts with capture, so recorded times line up with the files.
        this.#capturing = true;
        this.#tickedAt = performance.now();
        this.#timer = setInterval(() => {
          this.#tick();
          this.changed();
        }, 250);
      },
      (error: unknown) => {
        if (session !== this.#session) return;
        const message = error instanceof Error ? error.message : String(error);
        this.#end();
        this.failed(message, null);
      },
    );
    this.changed();
  }

  #tick(): void {
    if (this.state.phase !== "recording" || !this.#capturing) return;
    const now = performance.now();
    this.state.elapsed += (now - this.#tickedAt) / 1000;
    this.#tickedAt = now;
  }
}
