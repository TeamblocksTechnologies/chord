/**
 * Contract between the Chord desktop app and its platform recorder helpers (macOS today; Windows and Linux
 * later). Each helper is a child process speaking JSON-RPC 2.0 over stdio and writing session folders described
 * by `Manifest`. Every helper must implement this contract exactly; `test/contract.test.ts` checks a built
 * helper against it.
 */
export * from "./rpc.ts";
export * from "./types.ts";
export * from "./manifest.ts";
export * from "./methods.ts";
export * from "./frames.ts";
