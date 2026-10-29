# Desktop app behavior

How the Electron app is put together and the rules its features follow. For where code lives, see
[source organization](architecture.md).

## Processes and surfaces

The main process owns recording, storage, background jobs and the native helpers. Renderers are sandboxed and reach
the main process only through the typed `window.chord` bridge from the preload script.

Besides the main window, Chord has small surfaces for recording: the menu bar panel, the floating toolbar and the
recording island. Each is a transparent, fixed-size window with room for its dropdowns, so menus open in the same
page instead of resizing the window. Clicks pass through wherever nothing is drawn.

One recording controller in the main process serves every surface. Starting a recording from any of them hides the
main window, and finishing brings it back with the take saved to its project. Closing the main window keeps Chord
running in the menu bar, including any active recording.

## Storage

- **Recordings** are saved in `~/Movies/Chord` by default: a folder per project, with a session folder per take.
  The session folder holds what the helper recorded, plus `session.json` describing it (see
  [native helpers](native-helpers.md)).
- **Projects** are JSON files in Chord's user-data folder, one per project, written atomically by the main process.
  Each window edits its own copy and sends changed projects whole; other windows receive them.
- **Preferences** and the quick-start recording setup are JSON files in the same folder.
- **Models** are downloaded into the user-data folder.

Deleting a take, recording or project moves its session folders to the Trash rather than erasing them.

## Recorded media is never changed

Processing writes new files and leaves the original alone. Transcripts, noise-reduced audio and background masks go
in the take's session folder; exports and thumbnails go in the project's folder. Derived files keep the original's timing, so cuts,
trims, pauses and moves apply to them exactly as to the original. Turning a treatment off returns to the original.

A failed or cancelled job keeps the previous result. Jobs started from a recording finish even if the editor is
closed.

## One renderer for every output

Preview, export and thumbnails all draw frames with the same `Stage` from the media engine, so what you see while
editing is what gets exported. Exports are encoded in the renderer with WebCodecs.

## Projects and recordings

A project's video is a sequence of clips, each playing part of a recording. A recording carries everything done to
it, such as its cuts, transcript corrections, pointer effects and camera background, and that carries into every
clip that plays it. Clip-level choices, such as layout, belong to the clip.

Cuts are stored on the recording's own timeline and close up wherever it plays. Transcript corrections keep each
caption's original timing, and captions follow the edit through cuts, trims and moves.

## Background jobs

Transcription, noise reduction, background removal and model downloads go through the shared task registry in
`src/platform/main/tasks.ts`. Each kind of inference runs in its own first-in, first-out lane; downloads run in
parallel. Tasks report progress, can be cancelled and can be retried. Feature services own their results and error
states.

Model inference runs locally, outside the main process: ONNX models in an Electron utility process, Apple frameworks
in the native helpers.

## Models

Models are downloaded only when the user asks for them in Settings. Each is pinned to a source revision and verified
against its size and checksum before use. Models that macOS provides, such as Apple Speech, are installed and
managed by macOS. Third-party models and their licenses are listed in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Integration checks

Integration checks drive the built app with a temporary profile and a fixture in place of the recorder helper, so
they need no capture permissions and don't touch real data. Media they need is generated with ffmpeg. Checks
assert on what the user would see, down to pixels in exported files where it matters. The
[desktop README](../apps/desktop/README.md) explains how to run them.

Real screen, camera and microphone capture depends on macOS permissions and is checked by hand.
