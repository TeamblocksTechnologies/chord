import { readFileSync } from "node:fs";

const { packageManager } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const expected = packageManager.replace("@", "/").split("+")[0];
const actual = process.env.npm_config_user_agent?.split(" ")[0];
if (actual !== expected) {
  console.error(
    `Install dependencies with ${packageManager}; received ${actual ?? "no package manager"}.`,
  );
  process.exitCode = 1;
}

// Fail before GitHub silently ingests only pnpm's environment document.
const lockfile = readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
if (/^---\s*$/m.test(lockfile)) {
  console.error(
    "GitHub requires a single-document pnpm lockfile; see docs/dependency-security.md.",
  );
  process.exitCode = 1;
}
