import { type ChildProcessByStdio, spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type {
  MethodName,
  MethodParams,
  MethodResult,
  NotificationName,
  NotificationParams,
  RequestId,
  RpcFailure,
  RpcNotification,
  RpcSuccess,
} from "../src/index.ts";

type Response<M extends MethodName> = RpcSuccess<MethodResult<M>> | RpcFailure;
type Incoming = RpcSuccess | RpcFailure | RpcNotification;

/** Minimal client for exercising a helper binary in tests. */
export class HelperClient {
  readonly notifications: RpcNotification[] = [];
  /** Every message in arrival order. */
  readonly received: Incoming[] = [];
  private readonly process: ChildProcessByStdio<Writable, Readable, Readable>;
  private readonly pending = new Map<
    RequestId | null,
    (message: RpcSuccess | RpcFailure) => void
  >();
  private readonly waiters: Array<() => void> = [];
  private nextId = 1;

  constructor(binary: string) {
    // The fourth pipe is the helper's frame pipe, for display previews.
    this.process = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe", "pipe"] });
    this.process.stderr.resume();
    (this.process.stdio[3] as Readable).resume();
    createInterface({ input: this.process.stdout }).on("line", (line) => {
      const message = JSON.parse(line) as Incoming;
      this.received.push(message);
      if ("method" in message) {
        this.notifications.push(message);
      } else {
        this.pending.get(message.id)?.(message);
        this.pending.delete(message.id);
      }
      this.waiters.splice(0).forEach((wake) => wake());
    });
  }

  request<M extends MethodName>(method: M, params?: MethodParams<M>): Promise<Response<M>> {
    const id = this.nextId++;
    const reply = new Promise<Response<M>>((resolve) => {
      this.pending.set(id, resolve as (message: RpcSuccess | RpcFailure) => void);
    });
    this.write({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
    return reply;
  }

  notify<M extends MethodName>(method: M, params?: MethodParams<M>): void {
    this.write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  /** Sends a raw line and waits for the reply with `id` (or `null` for unreadable requests). */
  raw(line: string, id: RequestId | null): Promise<RpcSuccess | RpcFailure> {
    const reply = new Promise<RpcSuccess | RpcFailure>((resolve) => this.pending.set(id, resolve));
    this.process.stdin.write(`${line}\n`);
    return reply;
  }

  async notification<N extends NotificationName>(
    name: N,
    matches: (params: NotificationParams<N>) => boolean = () => true,
  ): Promise<NotificationParams<N>> {
    for (;;) {
      const found = this.notifications.find(
        (n) => n.method === name && matches(n.params as NotificationParams<N>),
      );
      if (found) return found.params as NotificationParams<N>;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  /** Closes stdin and resolves with the exit code. */
  async close(): Promise<number | null> {
    if (this.process.exitCode !== null) return this.process.exitCode;
    const exited = once(this.process, "exit");
    this.process.stdin.end();
    const [code] = await exited;
    return code as number | null;
  }

  async exited(): Promise<number | null> {
    if (this.process.exitCode !== null) return this.process.exitCode;
    const [code] = await once(this.process, "exit");
    return code as number | null;
  }

  private write(message: object): void {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }
}
