import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { discoverChecks, runCheck } from "./test-integration.mjs";

test("integration discovery includes new features and keeps model-dependent checks opt-in", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chord-discovery-"));
  try {
    const files = [
      "tests/integration/settings.ts",
      "src/features/new-feature/tests/integration/new-check.ts",
      "src/features/audio-processing/tests/integration/noise-reduction.ts",
      "src/features/new-feature/domain/unit.test.ts",
    ];
    for (const file of files) {
      await mkdir(dirname(join(directory, file)), { recursive: true });
      await writeFile(join(directory, file), "");
    }
    assert.deepEqual(await discoverChecks(directory), [files[1], files[0]]);
    assert.deepEqual(await discoverChecks(directory, true), [files[2]]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("integration execution preserves exit failures and both diagnostic streams", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chord-runner-"));
  try {
    const logFile = join(directory, "output.log");
    const result = await runCheck(
      process.execPath,
      ["-e", "console.log('fixture output'); console.error('fixture error'); process.exitCode = 7"],
      { cwd: directory, env: process.env, timeout: 5_000, logFile },
    );
    assert.equal(result.code, 7);
    assert.equal(result.timedOut, false);
    const log = await readFile(logFile, "utf8");
    assert.match(log, /fixture output/);
    assert.match(log, /fixture error/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("hung integration checks are killed and reported as failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chord-timeout-"));
  try {
    const result = await runCheck(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: directory,
      env: process.env,
      timeout: 250,
      logFile: join(directory, "output.log"),
    });
    assert.equal(result.timedOut, true);
    assert.equal(result.signal, "SIGKILL");
    assert.notEqual(result.code, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an exited test's descendants cannot keep its output pipes open", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chord-descendant-"));
  try {
    const result = await runCheck(
      process.execPath,
      [
        "-e",
        `const {spawn}=require('node:child_process');
         const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});
         child.unref(); process.exit(0);`,
      ],
      { cwd: directory, env: process.env, timeout: 5_000, logFile: join(directory, "output.log") },
    );
    assert.equal(result.code, 0);
    assert.equal(result.timedOut, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
