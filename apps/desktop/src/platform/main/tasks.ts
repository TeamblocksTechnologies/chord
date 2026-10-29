import { randomUUID } from "node:crypto";
import type { AppTask } from "../contracts/tasks.ts";

/** All task lanes share this observable registry without changing their concurrency. */
export class TaskRegistry {
  #entries = new Map<string, { task: AppTask; cancel: () => void }>();
  #listeners = new Set<(tasks: AppTask[]) => void>();
  list(): AppTask[] {
    return [...this.#entries.values()].map(({ task }) => ({ ...task }));
  }
  subscribe(listener: (tasks: AppTask[]) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  cancel(id: string): void {
    const entry = this.#entries.get(id);
    if (entry?.task.cancellable) entry.cancel();
  }
  add(task: AppTask, cancel: () => void): void {
    this.#entries.set(task.id, { task, cancel });
    this.#publish();
  }
  update(id: string, patch: Partial<AppTask>): void {
    const entry = this.#entries.get(id);
    if (entry) {
      Object.assign(entry.task, patch);
      this.#publish();
    }
  }
  remove(id: string): void {
    if (this.#entries.delete(id)) this.#publish();
  }
  #publish(): void {
    for (const listener of this.#listeners) listener(this.list());
  }
}

export const tasks = new TaskRegistry();

export interface TaskContext {
  signal: AbortSignal;
  /** Throttles progress notifications consistently; ignores updates after cancellation. */
  progress(value: number | null, notify?: () => void): void;
}

interface Options<Job> {
  kind: string;
  describe(job: Job): { key: string; label: string; resource?: string; cancellable?: boolean };
  run(job: Job, context: TaskContext): Promise<void>;
  cancelled?(job: Job): void;
  failed(job: Job, error: unknown): void;
  concurrency?: number;
  registry?: TaskRegistry;
}
interface Entry<Job> {
  id: string;
  key: string;
  job: Job;
  controller: AbortController;
}

/** FIFO lanes serialize inference by feature; downloads use the same lifecycle with parallel execution. */
export class TaskQueue<Job> {
  #options: Options<Job>;
  #registry: TaskRegistry;
  #waiting: Entry<Job>[] = [];
  #active = new Set<Entry<Job>>();
  closed = false;

  constructor(options: Options<Job>) {
    this.#options = options;
    this.#registry = options.registry ?? tasks;
  }
  has(key: string): boolean {
    return [...this.#waiting, ...this.#active].some(
      (entry) => entry.key === key && !entry.controller.signal.aborted,
    );
  }
  enqueue(job: Job): void {
    if (this.closed) throw new Error("The task queue has closed");
    const { key, label, resource, cancellable = true } = this.#options.describe(job);
    const entry = { id: randomUUID(), key, job, controller: new AbortController() };
    this.#waiting.push(entry);
    this.#registry.add(
      {
        id: entry.id,
        kind: this.#options.kind,
        key,
        label,
        resource,
        cancellable,
        phase: "queued",
        progress: null,
      },
      () => this.#cancelEntries([entry], true),
    );
    this.#drain();
  }
  cancel(matches: (job: Job) => boolean, notify = true): boolean {
    const entries = [...this.#waiting, ...this.#active].filter(
      (entry) => matches(entry.job) && !entry.controller.signal.aborted,
    );
    return this.#cancelEntries(entries, notify);
  }
  #cancelEntries(entries: Entry<Job>[], notify: boolean): boolean {
    this.#waiting = this.#waiting.filter((entry) => !entries.includes(entry));
    for (const entry of entries) {
      entry.controller.abort();
      this.#registry.remove(entry.id);
      if (notify) this.#options.cancelled?.(entry.job);
    }
    return entries.length > 0;
  }
  dispose(): void {
    this.closed = true;
    this.cancel(() => true, false);
  }

  #drain(): void {
    while (
      !this.closed &&
      this.#waiting.length &&
      this.#active.size < (this.#options.concurrency ?? 1)
    ) {
      const entry = this.#waiting.shift()!;
      this.#active.add(entry);
      this.#registry.update(entry.id, { phase: "running" });
      void this.#run(entry);
    }
  }
  async #run(entry: Entry<Job>): Promise<void> {
    const { signal } = entry.controller;
    let last = 0;
    try {
      signal.throwIfAborted();
      await this.#options.run(entry.job, {
        signal,
        progress: (value, notify) => {
          if (signal.aborted || Date.now() - last < 100) return;
          last = Date.now();
          const progress =
            value === null || !Number.isFinite(value) ? null : Math.min(1, Math.max(0, value));
          this.#registry.update(entry.id, { progress });
          if (!signal.aborted) notify?.();
        },
      });
    } catch (error) {
      this.#active.delete(entry);
      if (!signal.aborted) this.#options.failed(entry.job, error);
    } finally {
      this.#active.delete(entry);
      this.#registry.remove(entry.id);
      this.#drain();
    }
  }
}
