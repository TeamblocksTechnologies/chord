# Chord desktop

The Chord app, built with [electron-vite](https://electron-vite.org), [Svelte](https://svelte.dev) and [Tailwind CSS](https://tailwindcss.com).

Build the native helpers first (`native/macos/scripts/build.sh`), then from the repository root:

```sh
pnpm dev          # run with hot reload
pnpm typecheck    # boundary checks, TypeScript and Svelte
pnpm test         # unit tests
```

```sh
pnpm --filter @teamblocks.dev/chord-desktop build
```

## Integration checks

From the repository root, `pnpm test:integration` runs all deterministic Electron and native
integration checks sequentially, after building the app and native helpers. It requires macOS and
`ffmpeg`. The model-dependent noise-reduction check is opt-in with `pnpm test:integration:noise`.
Logs and available screenshots are saved under `artifacts/integration/` at the repository root.

Electron checks drive the built app with fixtures and a temporary profile, without capture permissions. Some need `ffmpeg`. After building, run one from this directory:

```sh
env -u ELECTRON_RUN_AS_NODE pnpm exec electron tests/integration/settings.ts
```

Feature checks live in `src/features/<feature>/tests/integration`. Node and Electron run the TypeScript tests directly.
`pnpm typecheck` includes strict typechecking for these checks.

## Screenshots

The README's screenshots are generated, not taken by hand. From the repository root:

```sh
pnpm screenshots               # every screenshot
pnpm screenshots home editor   # only these
```

It builds the app, then:

1. Renders generic desktop scenes and a presenter for the camera (`scripts/screenshots/scenes.mjs`).
2. Turns them into demo recordings with narration from `say` and a timed transcript
   (`scripts/screenshots/build-media.mjs`).
3. Opens the app on a fresh profile with those projects and a fixture recorder helper, then captures each window
   with `screencapture`, keeping real traffic lights, shadows and transparent edges
   (`scripts/screenshots/capture.mjs`).

`scripts/screenshots/shots.mjs` lists each screenshot, its output path and what it shows, such as the editor's
playhead time. `scripts/screenshots/demo.mjs` holds the demo projects, narration and device names. To add a
screenshot, add an entry to `shots.mjs` and a capture step with the same id in `capture.mjs`.

It needs macOS, `ffmpeg` and screen recording permission for your terminal. Windows open and take focus while it
runs, so leave the Mac alone for the minute or two it takes. Working files go to `artifacts/screenshots`.

## Configuration

`CHORD_RECORDINGS_FOLDER` overrides where recordings are saved (default `~/Movies/Chord`).

Packaged builds log only the recorder helper's errors. Set `CHORD_HELPER_LOGS=1` to include its informational lines too; source runs always include them.

## More

- [Source organization](../../docs/architecture.md)
- [Desktop app behavior](../../docs/desktop-behavior.md)
