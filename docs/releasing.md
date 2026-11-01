# Releasing

Pushing a `v*` tag runs [`release.yml`](../.github/workflows/release.yml), which builds the app from that commit,
signs and notarizes it, attests the downloads and drafts a GitHub release. Nothing is public until the draft is
published, and only published releases reach the in-app updater.

## Cutting a release

1. Set the version in `apps/desktop/package.json` and both helper plists in `native/macos/Resources`. The workflow
   fails if any of them differ from the tag.
2. Merge to `main` and wait for CI to pass.
3. Tag that commit and push the tag:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. When the workflow finishes, open the draft release, download the DMG and check it (see below).
5. Edit the generated notes and publish.

To rebuild a tag, delete the draft release first; the workflow won't overwrite one.

## Checking a download

```sh
gh attestation verify Chord-0.1.0-arm64.dmg --repo TeamblocksTechnologies/chord
```

This confirms the file was built by `release.yml` in this repository and names the commit and tag it came from.
Then open the DMG, drag Chord to Applications and launch it. It should open without a Gatekeeper warning, and
`spctl --assess --verbose=2 /Applications/Chord.app` should report `Notarized Developer ID`.

## Dry runs

Run the Release workflow by hand from the Actions tab, or with `gh workflow run release.yml`, to check signing and
notarization without a tag. It builds, signs, notarizes and checks the app exactly as a release does, then uploads
the DMG as a run artifact instead of drafting a release. Dry runs start from `main`'s cached Swift build, so they take
a few minutes rather than the half hour of a release.

Use one after changing the workflow, the certificate or the Apple API key, or before a release that upgrades Electron,
electron-builder or Xcode. The `release` environment only accepts `main`, so to try an unmerged branch, add it to the
environment's deployment branches for the duration and remove it afterwards.

## Packaging locally

```sh
SIGN_IDENTITY="Developer ID Application: …" native/macos/scripts/build.sh
pnpm --filter @teamblocks.dev/chord-desktop package
```

The app lands in `apps/desktop/dist`. It's signed with the first Developer ID identity in your keychain, but not
notarized unless the `APPLE_API_*` variables below are set.

## The app icon

`apps/desktop/build/icon.icon` is an Icon Composer bundle wrapping one SVG, `Assets/mark.svg`. electron-builder
compiles it with Xcode 26's `actool` into the macOS 26 asset catalog and an `.icns` for older versions. Edit the SVG
directly or open the bundle in Icon Composer.

## Setup

The workflow runs in the `release` environment. Restrict its deployments to `main` and `v*` tags so only release
tags and dry runs on `main` can read these secrets:

| Secret                       | Value                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `MACOS_CERTIFICATE`          | The Developer ID Application certificate and key, exported as `.p12`, base64 encoded |
| `MACOS_CERTIFICATE_PASSWORD` | The password chosen when exporting the `.p12`                                        |
| `APPLE_API_KEY`              | Contents of an App Store Connect API key (`AuthKey_….p8`)                            |
| `APPLE_API_KEY_ID`           | That key's ID                                                                        |
| `APPLE_API_ISSUER`           | The issuer ID shown above the keys list in App Store Connect                         |

The certificate must be the **Developer ID Application** one, not Apple Development; the workflow lists the identities
it found when it can't find one. It expires on 1 February 2027. Apps already released stay valid, since their
signatures are timestamped, but before then create a new certificate, replace `MACOS_CERTIFICATE` and
`MACOS_CERTIFICATE_PASSWORD`, and check them with a dry run.
