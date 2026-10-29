# Native helpers

Chord's native work runs in separate Swift executables in `native/macos`, each started by the app as a child
process. Keeping them apart means model work never shares a process with capture, and a crash in one doesn't take
down the others or the app.

| Helper               | Does                                                            |
| -------------------- | --------------------------------------------------------------- |
| `recorder-helper`    | All capture: screen, camera, microphone, system audio and input |
| `transcriber-helper` | Speech to text with Apple Speech or Parakeet                    |
| `background-helper`  | Decodes camera video and encodes background masks               |
| `audio-helper`       | Noise isolation with Apple's Sound Isolation                    |

```sh
native/macos/scripts/build.sh   # build and sign every helper; prints the recorder's path
swift test --package-path native/macos
pnpm --filter @teamblocks.dev/chord-recorder-protocol test   # contract test against the built recorder
```

When a helper runs from a terminal, macOS attributes its permission prompts to the terminal app.

## recorder-helper

A long-running process that does all capture. It speaks JSON-RPC 2.0 over stdin and stdout, one message per line,
and logs only to stderr. It sends a `ready` notification with its `protocolVersion` first, and exits when stdin
closes, on `shutdown`, or on SIGTERM or SIGINT, finishing any active session first.

The contract is defined in TypeScript in [`packages/recorder-protocol`](../packages/recorder-protocol): every method,
notification, error code and the `session.json` format. It's the source of truth for the helper; keep the two in
sync and run the contract test against the built binary.

### Sessions

A session is a folder of segment files plus `session.json`. Every time in the manifest is in seconds since the session
started, on the host clock, so tracks, pauses and marks line up.

- Each source records to its own track. A track's recording is split into segments, and each segment records why it
  ended, such as `paused`, `deviceDisconnected`, `systemSleep`, `configChanged` or `stopped`.
- Pausing ends every segment; resuming starts new ones.
- Tracks stay armed through interruptions such as sleep, a locked screen or an unplugged device, and continue in a
  new segment once the cause clears. Other capture or write errors are reported as `trackError` and retried.
- A full disk is fatal: every track stops and the session ends.
- Files are fragmented MP4, so they stay playable if the helper is killed.
- Microphones and system audio are always recorded losslessly.

### Changing a live session

`updateSession` takes the whole setup and makes the session record exactly that, so the app can send its full state
after any change. Sources switched off end their segment; switched back on, they continue on the same track. New
sources get new tracks, added to `session.json`. Changed settings end the affected segments and continue with the new
settings. An invalid update changes nothing.

### Screen capture

A session has a screen track per display connected at start. The screen mode decides what they capture:

- `display`: whole displays.
- `area`: rectangles of displays, each on its own track and cropped to its size.
- `focusedWindow`: only the followed window and its menus and popups, transparent elsewhere, following focus
  between allowed windows without cutting.

Specific windows can also be pinned to tracks of their own, in any mode. Modes and pinned windows can change
mid-session. Chosen apps, and Chord's own windows, are hidden from every mode.

Screen tracks that follow windows write a `bounds` file next to their video, recording where the window was in each
frame.

### Input

Every session writes `input.jsonl` so pointer and keyboard effects can be added after recording. It holds pointer
movement, mouse buttons and only the keys that matter: shortcuts with modifiers, keys that type nothing, and
modifiers pressed alone. Plain typing is never recorded, and nothing is recorded while paused. Input is polled, so
it needs no Input Monitoring permission.

### Previews

`setAudioPreview` meters microphones and system audio outside a session so the app can show levels while sources
are chosen. Display previews come from the helper on a separate pipe, since frames are too heavy for the message
channel. Camera and window previews are shown by the app itself.

## transcriber-helper

Runs one command, prints JSON lines on stdout and exits.

- `speech-assets`, `install-speech-assets`: check for and install Apple's speech model for a language, which macOS
  downloads and manages.
- `transcribe-speech <audio> [locale]`: transcribe with Apple Speech.
- `transcribe-parakeet <audio> <model folder>`: transcribe with Parakeet, from a model folder the app downloaded.
- `media-duration <file>`: a file's duration, used to recover unfinished segments.

Both transcription commands return the text with real word timings from the model, in seconds from the start of the
file.

## background-helper

Decodes recorded camera video and encodes the masks that background removal produces. Inference runs in the app,
not here.

- `info <video>`: the video's oriented size and duration.
- `mask <video> <output> <width> <height>`: streams model-sized frames to stdout and reads one alpha mask per frame
  back from stdin, then writes a grayscale video with the original's frame timing.

Closing the input cancels processing. On failure the output is deleted. Source video is never rewritten.

## audio-helper

Cleans recorded audio with Apple's Sound Isolation, offline.

- `available`: whether Sound Isolation can run, and which modes.
- `isolate <input> <output.wav> [mode]`: writes a cleaned copy with the same length, channels and sample rate,
  reporting progress as it goes.

The audio unit delays its output without reporting it, so the helper measures the delay on each file and removes
it, keeping the copy aligned with the original. On failure the output is deleted.
