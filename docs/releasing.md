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

The workflow runs in the `release` environment. Restrict its deployments to `v*` tags so only release tags can read
these secrets:

| Secret                       | Value                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `MACOS_CERTIFICATE`          | The Developer ID Application certificate and key, exported as `.p12`, base64 encoded |
| `MACOS_CERTIFICATE_PASSWORD` | The password chosen when exporting the `.p12`                                        |
| `APPLE_API_KEY`              | Contents of an App Store Connect API key (`AuthKey_….p8`)                            |
| `APPLE_API_KEY_ID`           | That key's ID                                                                        |
| `APPLE_API_ISSUER`           | The issuer ID shown above the keys list in App Store Connect                         |
