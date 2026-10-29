# Chord macOS helpers

Swift executables that do the native work for the Chord app. They run on macOS 14 or later and build with Swift 6.3 (Xcode 26), whose SDK includes the macOS 26 speech APIs. Some features need a newer macOS at runtime:

- macOS 14.2: showing or hiding the menu bar in screen recordings
- macOS 15: HDR screen capture
- macOS 26: transcription with Apple's speech model (Parakeet works on every supported version)

| Helper               | Does                                                            |
| -------------------- | --------------------------------------------------------------- |
| `recorder-helper`    | All capture: screen, camera, microphone, system audio and input |
| `transcriber-helper` | Speech to text with Apple Speech or Parakeet                    |
| `background-helper`  | Decodes camera video and encodes background masks               |
| `audio-helper`       | Noise isolation with Apple's Sound Isolation                    |

```sh
scripts/build.sh    # build and sign all helpers (ad-hoc unless SIGN_IDENTITY is set)
swift test
```

Use the Xcode version in the repository's `.xcode-version` for the same Swift compiler and formatter
as CI. From the repository root, run `pnpm format:swift` to format sources or
`pnpm format:swift:check` to check them. Both use the checked-in `.swift-format` configuration.

`recorder-helper` speaks the [recorder protocol](../../packages/recorder-protocol) over stdin and stdout. When run from a terminal, macOS attributes permission prompts to the terminal app.

Command and protocol details are in [native helpers](../../docs/native-helpers.md).
