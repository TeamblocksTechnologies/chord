#!/bin/sh
# Writes which parts of the repository a pull request changes to $GITHUB_OUTPUT, so workflows can
# skip jobs it can't affect. Any other event, and any change under .github, sets full=true.
# Pull request checkouts need the merge commit and its first parent, the base branch tip.
set -eu

if [ "$EVENT_NAME" != pull_request ]; then
  echo "full=true" >>"$GITHUB_OUTPUT"
  exit 0
fi

changed="$(git diff --name-only --no-renames HEAD^1 HEAD)"
printf '%s\n' "$changed"
has() { printf '%s\n' "$changed" | grep -Eq "$1"; }

native='^(native/|\.swift-format$|\.xcode-version$)'
if has '^\.github/'; then echo "full=true"; fi >>"$GITHUB_OUTPUT"
if has "$native"; then echo "native=true"; fi >>"$GITHUB_OUTPUT"
if printf '%s\n' "$changed" | grep -Ev "$native" | grep -q .; then
  echo "quality=true"
fi >>"$GITHUB_OUTPUT"
# Docs and screenshot tooling don't reach the built app or its integration checks.
if printf '%s\n' "$changed" |
  grep -Ev '\.md$|^apps/desktop/scripts/screenshots/' |
  grep -Eq '^(apps|packages|scripts)/|^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|\.node-version)$'; then
  echo "app=true"
fi >>"$GITHUB_OUTPUT"
# On pull requests CodeQL extracts only the changed files, and its JavaScript analysis fails when
# none of them hold code or YAML it scans. Leave out the paths .github/codeql/codeql-config.yml ignores.
if printf '%s\n' "$changed" |
  grep -Ev '(^|/)tests?/|\.test\.ts$|^apps/desktop/scripts/' |
  grep -Eq '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|html|ya?ml)$'; then
  echo "javascript=true"
fi >>"$GITHUB_OUTPUT"
