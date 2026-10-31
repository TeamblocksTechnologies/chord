// Where the recording controls get what they show: the sources to pick from, the user's preferences, and live
// previews. The desktop app provides its recorder's; a page showing the controls can provide stand-ins.
import type { Component, Snippet } from "svelte";
import type { CameraQuality } from "#ui/model/quality.ts";
import type { RecordingSetup } from "#ui/model/setup.ts";
import type {
  AudioSource,
  CameraSource,
  DisplaySource,
  ScreenArea,
  SourceList,
} from "#ui/model/sources.ts";

/** What each source needs from the system before it can be used. */
export type SourceNeed = "screen" | "camera" | "microphone" | "systemAudio";

export interface AppEntry {
  bundleId: string;
  name: string;
  /** Has a window open now. */
  open: boolean;
}

export interface AppCatalogue {
  /**
   * Every app that could be recorded: open ones first, then the rest, then `extra` ids that are neither. Each part
   * is sorted by name.
   */
  list(extra?: string[]): { open: AppEntry[]; closed: AppEntry[] };
  /** Icons as image URLs, by bundle id. Missing until loaded, or for apps without one. */
  readonly icons: Record<string, string>;
  /** Bundle ids whose icon request has come back, with or without an icon. */
  readonly settled: Record<string, boolean>;
  /** Loads icons for `apps` not asked for yet. */
  load(apps: { bundleId: string; pid?: number }[]): void;
  /** Keeps the list fresh while the calling component is mounted. Call during component setup. */
  observe(): void;
}

export interface RecordingPreferences {
  /** Bundle ids kept out of every recording. */
  hiddenApps: string[];
  showsCursor: boolean;
  cameraMirrored: boolean;
}

export interface RecordingPreviews {
  display: Component<{
    display: DisplaySource;
    setup: Pick<RecordingSetup, "background" | "hiddenApps" | "showsSystemUI">;
    /** Drawn over the live frame, sized to it. */
    overlay?: Snippet;
  }>;
  /** A pinnable window. */
  window: Component<{ windowId: number }>;
  /** The window `window` mode would record now. */
  focusedWindow: Component<{
    allowedApps: string[];
    hiddenApps: string[];
    pinnedWindowIds?: number[];
  }>;
  camera: Component<{ camera: CameraSource; size?: CameraQuality; mirrored: boolean }>;
  level: Component<{ source: AudioSource }>;
}

export interface RecordingEnvironment {
  /** Displays, apps, windows and devices to choose from. */
  readonly sources: SourceList;
  readonly preferences: RecordingPreferences;
  updatePreferences(patch: Partial<RecordingPreferences>): void;
  /** Why a source can't be used yet, or null when it can. */
  blockedReason(need: SourceNeed): string | null;
  /** Lists the sources again, e.g. while windows open and close. */
  refreshSources(): void;
  /** Lets the user draw areas over every display. Resolves null when cancelled; absent where it can't be shown. */
  pickAreas?(areas: ScreenArea[]): Promise<ScreenArea[] | null>;
  apps: AppCatalogue;
  previews: RecordingPreviews;
}

let current: RecordingEnvironment | undefined;

/** Sets what the recording controls show. Call once, before they render. */
export function provideRecordingEnvironment(environment: RecordingEnvironment): void {
  current = environment;
}

export function recordingEnvironment(): RecordingEnvironment {
  if (!current)
    throw new Error("Call provideRecordingEnvironment before rendering recording controls");
  return current;
}
