import { LiveList } from "#shared/renderer/liveList.svelte";
import {
  resolveNoiseEngine,
  type NoiseEngineId,
  type NoiseEngineState,
} from "../contracts/noiseReduction.ts";
import { desktop } from "#platform/renderer/desktop.svelte";

/** The noise reduction engines on this computer, as the main process reports them. Call during component setup. */
export class NoiseEngines extends LiveList<NoiseEngineState> {
  /** The engine new noise reduction would use, if any can run. */
  readonly usable = $derived<NoiseEngineId | null>(
    resolveNoiseEngine(desktop.preferences.noiseEngine, this.list),
  );

  constructor() {
    super(
      () => window.chord.desktop.noiseEngines.list(),
      (receive) => window.chord.desktop.noiseEngines.onChange(receive),
    );
  }
}
