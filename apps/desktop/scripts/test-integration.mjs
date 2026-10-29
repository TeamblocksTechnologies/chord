import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, glob, mkdir, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(import.meta.dirname, "..");
const root = resolve(desktop, "../..");
const noiseCheck = "src/features/audio-processing/tests/integration/noise-reduction.ts";
const nativeCheck = "src/features/background-removal/tests/integration/background-native.ts";

export async function discoverChecks(directory, noiseOnly = false) {
  const checks = [];
  for await (const file of glob(
    ["tests/integration/*.ts", "src/features/*/tests/integration/*.ts"],
    { cwd: directory },
  )) {
    if ((file === noiseCheck) === noiseOnly) checks.push(file);
  }
  return checks.sort();
}

/**
 * Isolate each check in a process group so timeouts and cancellation also stop helper processes.
 * @returns {Promise<{code: number | null, signal: NodeJS.Signals | null, timedOut: boolean, cancelled: boolean}>}
 */
export function runCheck(command, args, { cwd, env, timeout, logFile }) {
  return new Promise((resolveRun, reject) => {
    const log = createWriteStream(logFile);
    const child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let timedOut = false;
    let cancelled = false;
    const stop = () => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const cancel = () => {
      cancelled = true;
      stop();
    };
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeout);
    const cleanup = () => {
      clearTimeout(timer);
      process.off("SIGINT", cancel);
      process.off("SIGTERM", cancel);
    };
    child.stdout.on("data", (data) => {
      process.stdout.write(data);
      log.write(data);
    });
    child.stderr.on("data", (data) => {
      process.stderr.write(data);
      log.write(data);
    });
    log.on("error", (error) => {
      stop();
      reject(error);
    });
    child.once("error", (error) => {
      cleanup();
      log.end();
      reject(error);
    });
    // close waits for inherited pipes too. Stop descendants as soon as the test
    // process exits, otherwise an orphan helper can hold those pipes open.
    child.once("exit", stop);
    child.once("close", (code, signal) => {
      cleanup();
      stop();
      log.end(() => resolveRun({ code, signal, timedOut, cancelled }));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (
    args.some(
      (arg) => !["--noise-reduction", "--list"].includes(arg) && !arg.startsWith("--filter="),
    )
  ) {
    throw new Error(
      "Usage: node scripts/test-integration.mjs [--noise-reduction] [--list] [--filter=path]",
    );
  }
  const noiseOnly = args.includes("--noise-reduction");
  const filters = args
    .filter((arg) => arg.startsWith("--filter="))
    .map((arg) => arg.slice("--filter=".length));
  const checks = (await discoverChecks(desktop, noiseOnly)).filter(
    (file) => !filters.length || filters.some((filter) => file.includes(filter)),
  );
  if (!checks.length) throw new Error("No integration checks found");
  if (args.includes("--list")) {
    console.log(checks.join("\n"));
    return;
  }
  if (process.platform !== "darwin") throw new Error("Integration checks require macOS");
  await access(join(desktop, "out/main/index.js"));
  for (const name of [
    "recorder-helper",
    "transcriber-helper",
    "background-helper",
    "audio-helper",
  ]) {
    await access(join(root, "native/macos/.build/release", name), constants.X_OK);
  }
  const electron = createRequire(import.meta.url)("electron");
  const artifacts = resolve(
    process.env.CHORD_TEST_ARTIFACTS || join(root, "artifacts/integration"),
  );
  const failures = [];
  for (const [index, file] of checks.entries()) {
    const name = file.replace(/\.ts$/, "").replaceAll("/", "-");
    const output = join(artifacts, name);
    await mkdir(output, { recursive: true });
    const temporary = await mkdtemp(join(tmpdir(), "chord-integration-"));
    const env = { ...process.env, TMPDIR: temporary, CHORD_TEST_SCREENSHOTS: output };
    delete env.ELECTRON_RUN_AS_NODE;
    console.log(`\n[${index + 1}/${checks.length}] ${file}`);
    try {
      const result = await runCheck(file === nativeCheck ? process.execPath : electron, [file], {
        cwd: desktop,
        env,
        timeout: noiseOnly ? 10 * 60_000 : 3 * 60_000,
        logFile: join(output, "output.log"),
      });
      if (result.cancelled) throw new Error("Integration checks cancelled");
      if (result.code !== 0) {
        failures.push(file);
        console.error(
          `Failed: ${file} (${result.timedOut ? "timeout" : result.signal || result.code})`,
        );
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  console.log(`\n${checks.length - failures.length}/${checks.length} integration checks passed`);
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
