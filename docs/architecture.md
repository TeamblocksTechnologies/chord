# Source organization

Chord is a feature-oriented modular monolith. Product capabilities own their behavior and UI, and Electron's
process boundaries stay explicit.

## Features

Features live in `apps/desktop/src/features`, one folder per broad capability, such as recording, editing,
transcription or exporting. Nest subfeatures when it helps navigation.

Inside a feature:

- `main`: privileged Electron and Node behavior.
- `renderer`: Svelte state and components.
- `domain`: framework-independent rules.
- `contracts`: runtime-independent types shared across a boundary, such as IPC interfaces.

Create only the folders a feature needs. Code used by one feature belongs inside it, even when several screens use
it. A capability's settings panel stays with that capability.

## Shared owners

- `src/app`: Electron entry points, the preload bridge and application composition. Nothing else imports it.
- `src/platform`: desktop capabilities, windows, navigation, the task registry and the composed IPC interface.
  Features define their own IPC interfaces; the platform composes them.
- `src/project-document`: the project model, document access, loading, upgrades and the edit boundary.
- `src/media-engine`: playback, time mapping, media access and the renderer that preview, export and thumbnails
  share.
- `src/shared`: generic utilities with no knowledge of features. Domain concepts stay with their owner, even when
  another feature uses them.
- `packages/ui`: generic Svelte controls and theme. It never imports desktop code or uses `window.chord`; consumers
  pass behavior in through callbacks.
- `packages/recorder-protocol` and `native/macos`: the contract with the native helpers and its implementation.

## Imports

The desktop package's `package.json` `imports` map is its public module surface. Imports inside an owner are
relative; imports between owners use declared subpaths:

```ts
import { projectEdits } from "#features/editing/renderer/edits";
import type { TranscriptionAPI } from "#features/transcription/contracts/api";
import Slider from "@teamblocks.dev/chord-ui/Slider.svelte";
```

Subpaths point straight at source files. There are no whole-feature barrels, so renderer code never pulls in
main-process modules.

`check:boundaries`, part of `pnpm typecheck`, enforces these rules for every kind of import: no private paths across
owners, no renderer access to Node, Electron or main code, no UI dependencies in `domain` or `contracts`, no desktop
code in `packages/ui`, no features in `src/shared`, and no imports of `src/app`. It enforces ownership and runtime
isolation, not an acyclic graph.

## Edits

Editing rules live in the editing feature's `domain` and apply to a project through the document's change
boundary. The renderer binds them to the open project. The document owner handles persistence and timestamps; it
doesn't implement editing rules.

Keep media files, local paths and transient processing state apart from editing metadata, so the model can later
support merging and collaborative editing.

## Tests

- Unit tests sit beside the file they test, as `*.test.ts`.
- Tests spanning several modules of one feature go in that feature's `tests` folder.
- Electron integration checks go in `tests/integration`, in the feature or, for app-wide checks, in
  `apps/desktop/tests/integration`.

A test never justifies importing another owner's private implementation.
