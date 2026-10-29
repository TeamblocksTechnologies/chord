import assert from "node:assert/strict";
import test from "node:test";
import { TaskQueue, TaskRegistry } from "./tasks.ts";

const settled = () => new Promise<void>((resolve) => setImmediate(resolve));
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("task lanes retain FIFO order and run independently, with one observable registry", async () => {
  const registry = new TaskRegistry();
  const gates = [gate(), gate(), gate()];
  const started: string[] = [];
  const make = (kind: string) =>
    new TaskQueue<number>({
      kind,
      registry,
      describe: (job) => ({ key: String(job), label: `${kind} ${job}`, resource: "recording" }),
      run: async (job) => {
        started.push(`${kind}:${job}`);
        await gates[job]!.promise;
      },
      failed: () => assert.fail("The task must complete"),
    });
  const first = make("transcription"),
    second = make("background");
  first.enqueue(0);
  first.enqueue(1);
  second.enqueue(2);
  assert.deepEqual(started, ["transcription:0", "background:2"]);
  assert.deepEqual(
    registry.list().map((task) => task.phase),
    ["running", "queued", "running"],
  );
  const snapshot = registry.list();
  snapshot[0]!.label = "changed";
  assert.equal(registry.list()[0]!.label, "transcription 0");
  gates[0]!.resolve();
  await settled();
  assert.deepEqual(started, ["transcription:0", "background:2", "transcription:1"]);
  gates[1]!.resolve();
  gates[2]!.resolve();
  await settled();
  assert.deepEqual(registry.list(), []);
});

test("registry cancellation removes queued work and waits for active cleanup before a replacement runs", async () => {
  const registry = new TaskRegistry();
  const cleanup = gate();
  const started: number[] = [],
    cancelled: number[] = [];
  const queue = new TaskQueue<number>({
    kind: "noise",
    registry,
    describe: (job) => ({ key: String(job), label: String(job) }),
    run: async (job, { signal }) => {
      started.push(job);
      if (job !== 1) return;
      try {
        await new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
      } finally {
        await cleanup.promise;
      }
    },
    cancelled: (job) => {
      cancelled.push(job);
    },
    failed: () => assert.fail("Cancellation isn't a failure"),
  });
  queue.enqueue(1);
  queue.enqueue(2);
  registry.cancel(registry.list()[1]!.id);
  registry.cancel(registry.list()[0]!.id);
  queue.enqueue(1);
  assert.deepEqual(started, [1]);
  assert.deepEqual(cancelled, [2, 1]);
  assert.equal(registry.list()[0]!.phase, "queued");
  cleanup.resolve();
  await settled();
  assert.deepEqual(started, [1, 1]);
  queue.dispose();
  await settled();
  assert.deepEqual(registry.list(), []);
});

test("parallel downloads report bounded progress and uncancellable system work stays running", async () => {
  const registry = new TaskRegistry();
  const finish = gate();
  let updates = 0;
  const off = registry.subscribe(() => {
    updates++;
  });
  const queue = new TaskQueue<number>({
    kind: "model-download",
    registry,
    concurrency: Infinity,
    describe: (job) => ({ key: String(job), label: String(job), cancellable: job !== 1 }),
    run: async (job, { progress }) => {
      progress(job * 2);
      await finish.promise;
    },
    failed: () => assert.fail("The download must complete"),
  });
  queue.enqueue(1);
  queue.enqueue(2);
  assert.deepEqual(
    registry.list().map((task) => [task.phase, task.progress]),
    [
      ["running", 1],
      ["running", 1],
    ],
  );
  registry.cancel(registry.list()[0]!.id);
  assert.equal(registry.list().length, 2);
  const count = updates;
  off();
  finish.resolve();
  await settled();
  assert.equal(updates, count);
  assert.deepEqual(registry.list(), []);
});

test("failures release the lane and disposal prevents queued jobs from starting", async () => {
  const registry = new TaskRegistry();
  const finish = gate();
  const errors: string[] = [],
    started: number[] = [];
  const queue = new TaskQueue<number>({
    kind: "background",
    registry,
    describe: (job) => ({ key: String(job), label: String(job) }),
    run: async (job) => {
      started.push(job);
      if (job === 1) throw new Error("failed");
      await finish.promise;
    },
    failed: (_, error) => {
      errors.push((error as Error).message);
    },
  });
  queue.enqueue(1);
  queue.enqueue(2);
  queue.enqueue(3);
  await settled();
  assert.deepEqual(errors, ["failed"]);
  assert.deepEqual(started, [1, 2]);
  queue.dispose();
  finish.resolve();
  await settled();
  assert.deepEqual(started, [1, 2]);
  assert.deepEqual(registry.list(), []);
  assert.throws(() => queue.enqueue(4), /closed/);
});
