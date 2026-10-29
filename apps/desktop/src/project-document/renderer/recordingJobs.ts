import type { BackgroundState } from "#features/background-removal/contracts/backgroundRemoval";
import type { TranscriptionState } from "#features/transcription/domain/captions";
import type { Recording } from "../domain/recording.ts";

/** Wait for saved results to load before offering batch work; existing edits must never be overwritten. */
export function untranscribedRecordings(
  recordings: Recording[],
  states: Record<string, TranscriptionState>,
): Recording[] {
  return recordings.filter(({ directory, hasMicrophone }) => {
    const state = directory ? states[directory] : undefined;
    return (
      hasMicrophone &&
      state &&
      !state.transcript &&
      (state.phase === "idle" || state.phase === "failed")
    );
  });
}

export function unprocessedRecordings(
  recordings: Recording[],
  states: Record<string, BackgroundState>,
): Recording[] {
  return recordings.filter(({ directory, hasCamera }) => {
    const state = directory ? states[directory] : undefined;
    return (
      hasCamera && state && !state.result && (state.phase === "idle" || state.phase === "failed")
    );
  });
}
