import { onMount } from "svelte";
import { idleRecording, type DesktopState } from "../contracts/desktop.ts";
import { defaultPreferences, type Preferences } from "#features/settings/domain/preferences";
import type { RecordingSetup } from "#project-document/domain/recording";

export const desktop = $state<DesktopState & { live: RecordingSetup | null }>({
  version: -1,
  defaultsRevision: -1,
  defaults: null,
  preferences: defaultPreferences(),
  recording: idleRecording(),
  liveRevision: -1,
  finished: 0,
  toolbar: { visible: false, registered: false, side: "above" },
  island: {
    visible: false,
    mode: "compact",
    camera: false,
    preview: true,
    tools: true,
    corner: { horizontal: "right", vertical: "bottom" },
  },
  menubar: { visible: false, side: "left" },
  live: null,
});

/**
 * A setup the main process owns, edited through a local reactive view. Edits go out as patches of the changed
 * fields; they show in the view until the main process accepts them, and revert if it rejects them.
 */
function syncedSetup(
  field: "defaults" | "live",
  save: (patch: Partial<RecordingSetup>) => Promise<DesktopState>,
  accept: (state: DesktopState) => void,
  connected: () => boolean,
) {
  let canonical: RecordingSetup | null = null;
  let lastView: RecordingSetup | null = null;
  let revision = -1;
  const pending = new Map<keyof RecordingSetup, { value: unknown; sequence: number }>();
  let sequence = 0;

  function render() {
    if (!canonical) {
      pending.clear();
      lastView = null;
      desktop[field] = null;
      return;
    }
    const view = structuredClone(canonical);
    for (const [key, entry] of pending) Object.assign(view, { [key]: entry.value });
    lastView = structuredClone(view);
    if (JSON.stringify(desktop[field]) !== JSON.stringify(view)) desktop[field] = view;
  }

  return {
    receive(setup: RecordingSetup | null, nextRevision: number) {
      if (nextRevision <= revision) return;
      revision = nextRevision;
      canonical = setup;
      render();
    },
    /** Sends the view's edits. Call from an effect. */
    flush() {
      const view = desktop[field] && $state.snapshot(desktop[field]);
      if (!view || !lastView) return;
      const patch: Partial<RecordingSetup> = {};
      const sent = new Map<keyof RecordingSetup, number>();
      for (const key of Object.keys(view) as (keyof RecordingSetup)[]) {
        if (JSON.stringify(view[key]) === JSON.stringify(lastView[key])) continue;
        const id = ++sequence;
        Object.assign(patch, { [key]: view[key] });
        pending.set(key, { value: view[key], sequence: id });
        sent.set(key, id);
      }
      if (sent.size === 0) return;
      lastView = structuredClone(view);
      const settle = () => {
        for (const [key, id] of sent) if (pending.get(key)?.sequence === id) pending.delete(key);
      };
      void save(patch)
        .then((state) => {
          settle();
          if (connected()) {
            accept(state);
            render();
          }
        })
        .catch((error: unknown) => {
          settle();
          if (connected()) render();
          console.error(
            `Could not change the ${field === "live" ? "recording" : "recording setup"}`,
            error,
          );
        });
    },
  };
}

/** Edits sent to the main process and not answered yet; until they are, its preferences would undo them. */
let pendingPreferences = 0;
/** The preferences in the latest answer, shown once every edit is answered. */
let answeredPreferences: Preferences | null = null;

/** Changes preferences, showing the change at once. */
export function updatePreferences(patch: Partial<Preferences>): void {
  Object.assign(desktop.preferences, patch);
  pendingPreferences++;
  window.chord.desktop
    .updatePreferences($state.snapshot(patch) as Partial<Preferences>)
    .then((state) => {
      answeredPreferences = state.preferences;
    })
    .catch((error: unknown) => console.error("Could not change the preferences", error))
    .finally(async () => {
      if (--pendingPreferences > 0) return;
      const preferences =
        answeredPreferences ?? (await window.chord.desktop.getState()).preferences;
      answeredPreferences = null;
      if (pendingPreferences === 0) desktop.preferences = preferences;
    });
}

/** A renderer edits local reactive views; the main process owns the canonical setups and session. */
export function connectDesktop(legacyDefaults?: () => RecordingSetup): void {
  let connected = false;
  const isConnected = () => connected;
  const defaults = syncedSetup(
    "defaults",
    (patch) => window.chord.desktop.updateDefaults(patch),
    accept,
    isConnected,
  );
  const live = syncedSetup(
    "live",
    (patch) => window.chord.desktop.recording.update(patch),
    accept,
    isConnected,
  );

  function accept(state: DesktopState) {
    if (state.version >= desktop.version) {
      desktop.version = state.version;
      desktop.recording = state.recording;
      desktop.finished = state.finished;
      desktop.toolbar = state.toolbar;
      desktop.island = state.island;
      desktop.menubar = state.menubar;
      if (pendingPreferences === 0) desktop.preferences = state.preferences;
    }
    if (state.defaultsRevision > desktop.defaultsRevision && state.defaults) {
      desktop.defaultsRevision = state.defaultsRevision;
      defaults.receive(state.defaults, state.defaultsRevision);
    }
    if (state.liveRevision > desktop.liveRevision) {
      desktop.liveRevision = state.liveRevision;
      live.receive(state.recording.target?.setup ?? null, state.liveRevision);
    }
  }

  onMount(() => {
    connected = true;
    const off = window.chord.desktop.onState(accept);
    const initial = legacyDefaults
      ? window.chord.desktop.initializeDefaults($state.snapshot(legacyDefaults()))
      : window.chord.desktop.getState();
    void initial.then(accept);
    return () => {
      connected = false;
      off();
    };
  });

  $effect(() => defaults.flush());
  $effect(() => live.flush());
}
