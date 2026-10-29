# @teamblocks.dev/chord-recorder-protocol

The contract between the Chord app and its recorder helpers: JSON-RPC 2.0 over stdio. The macOS helper in `native/macos` implements it; any other platform's helper must match it exactly.

| File              | Defines                                      |
| ----------------- | -------------------------------------------- |
| `src/rpc.ts`      | Framing, `PROTOCOL_VERSION`, error codes     |
| `src/methods.ts`  | Methods and notifications                    |
| `src/types.ts`    | Session config, sources, permissions, tracks |
| `src/manifest.ts` | The `session.json` written per session       |
| `src/frames.ts`   | Reader for display preview frames            |

## Tests

The contract test runs a built helper against the protocol.

```sh
native/macos/scripts/build.sh
pnpm --filter @teamblocks.dev/chord-recorder-protocol test
```

Set `RECORDER_HELPER` to test another helper, or `RECORDER_CONTRACT_CAPTURE=1` to also record a microphone session.

When changing the contract, update `src/`, every helper and the test together, and bump `PROTOCOL_VERSION` for breaking changes.
