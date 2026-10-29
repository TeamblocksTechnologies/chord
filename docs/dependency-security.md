# Dependency security

## Monitoring

Dependabot watches GitHub Actions, the npm workspace and the Swift package in `native/macos`. Lockfiles and Swift's
`Package.resolved` are committed so updates and alerts see exact versions.

Audits cover the whole npm workspace, including development dependencies. Electron is a development dependency but
supplies the app's runtime, so a production-only audit would miss it.

## Audit gate

The `Dependency security` workflow audits on pull requests, on pushes to `main`, on a weekly schedule and on demand.
It fails on moderate, high or critical findings, and on registry errors. Low findings stay visible in its output.
Run `pnpm audit:dependencies` to check locally, or `pnpm audit --json` for full details.

## Advisories

Fix an advisory by updating the dependency. When no fix exists:

1. Open an issue recording the advisory, its severity, the dependency path, the reason for accepting it and what
   would close it.
2. Don't add audit ignores or dependency overrides. A finding that becomes moderate or higher fails the gate again.
3. Close the issue once the audit no longer reports the advisory and the app's checks pass.

## Lockfile format

GitHub's dependency graph can't read pnpm's multi-document lockfile, so `pnpm-workspace.yaml` uses pnpm's
documented `pmOnFail: ignore` setting to keep a single-document lockfile. That setting turns off pnpm's own
version check, so the root `preinstall` script enforces the pnpm version pinned in `package.json` instead. Don't
skip lifecycle scripts during normal installs. Remove both once GitHub supports the native format.

References: [pnpm lockfile format](https://github.com/pnpm/pnpm/blob/main/pnpm/docs/lockfile.md),
[GitHub's supported ecosystems](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories).
