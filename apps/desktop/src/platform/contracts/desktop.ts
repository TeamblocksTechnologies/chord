import type { NoiseAPI, NoiseEnginesAPI } from "#features/audio-processing/contracts/api";
import type {
  BackgroundAPI,
  BackgroundModelsAPI,
} from "#features/background-removal/contracts/api";
import type {
  TranscriptionAPI,
  TranscriptionModelsAPI,
} from "#features/transcription/contracts/api";
import type { ProjectsAPI, ThumbnailsAPI } from "#features/projects/contracts/api";
import type { ExportAPI } from "#features/exporting/contracts/api";
import type { ShortcutsAPI } from "#features/settings/contracts/api";
import type { RecordingAPI, ToolbarAPI } from "#features/recording/contracts/api";
import type { Annotations } from "#features/editing/domain/annotations";
import type { ScreenArea } from "@teamblocks.dev/chord-recorder-protocol";
import type { IslandState } from "#features/recording/contracts/island";
import type { NotePage, PageChange, ResizeEdge } from "#features/recording/domain/notes";
import type { Preferences } from "#features/settings/domain/preferences";
import type { DropdownSide } from "./overlay.ts";
import { isProjectId } from "#features/projects/contracts/projects";
import type { RecordingSetup } from "#project-document/domain/recording";
import type { AppTask } from "./tasks.ts";

export type Surface =
  "main" | "toolbar" | "island" | "pointer" | "areas" | "notes" | "menubar" | "thumbnails";
/** The main window's screens. */
export const SETTINGS_TABS = [
  "general",
  "shortcuts",
  "recording",
  "transcription",
  "audio",
  "background",
  "privacy",
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** Settings isn't a screen of its own: asking for it opens the settings dialog over whatever is showing. */
export type Route =
  | { name: "home" }
  | { name: "settings"; tab?: SettingsTab }
  | { name: "project"; id: string; time?: number; recording?: { id: string; time: number } };
/** The source cells with a dropdown of options. */
export type PopupKind = "screen" | "camera" | "microphone";
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RecordingTarget {
  projectId: string | null;
  setup: RecordingSetup;
  startedAt: string;
  /** The project's recording notes as they were when the recording started. */
  notes: NotePage[];
}
export interface RecordingState {
  phase: "idle" | "countdown" | "recording" | "paused";
  countdown: number;
  elapsed: number;
  markCount: number;
  /** The notes page being shown. */
  page: number;
  /**
   * Whether the laser pointer is on. The presenter sees it on screen, outside the recording; when it's on is kept
   * with the recording, which draws it from the recorded mouse in playback.
   */
  laser: boolean;
  /** Whether clicks are highlighted. Shown and kept like `laser`. */
  clicks: boolean;
  /** Whether keyboard shortcuts are shown. Shown and kept like `laser`. */
  keys: boolean;
  target: RecordingTarget | null;
}
/** Which sources were on at any point during a recording, since they can be switched while it runs. */
export interface UsedSources {
  screen: boolean;
  camera: boolean;
  microphone: boolean;
  systemAudio: boolean;
}
export interface FinishedRecording {
  target: RecordingTarget;
  elapsed: number;
  markCount: number;
  pageChanges: PageChange[];
  /** When the laser pointer, click highlights and keyboard shortcuts were on. */
  annotations: Annotations;
  used: UsedSources;
  /** The session folder, or null when nothing was written (no helper). */
  directory: string | null;
}
/** What the pointer overlay on one display is sent every frame. */
export interface PointerUpdate {
  /** The cursor within that display, or null when it is elsewhere. */
  cursor: { x: number; y: number } | null;
  /** Whether a mouse button is held. */
  down: boolean;
  laser: boolean;
  clicks: boolean;
}
/** A shortcut for the pointer overlay to show, as the keys to draw in order. */
export interface ShortcutPress {
  id: number;
  parts: string[];
}
/** What an area picker window starts with: its display's areas, in points from the display's top left. */
export interface AreaPickerInit {
  areas: ScreenArea[];
  /** Whether this window shows Done and Cancel. */
  controls: boolean;
}
export interface DesktopState {
  version: number;
  defaultsRevision: number;
  defaults: RecordingSetup | null;
  preferences: Preferences;
  recording: RecordingState;
  /** Bumped whenever the live recording's setup changes or the recording ends. */
  liveRevision: number;
  /** Finished recordings waiting for the main window to save them. */
  finished: number;
  toolbar: { visible: boolean; registered: boolean; side: DropdownSide };
  island: IslandState;
  /** The panel opened from the menu bar icon; its dropdowns open on `side`. */
  menubar: { visible: boolean; side: "left" | "right" };
}

export const TOOLBAR_HEIGHT = 56;
export const TOOLBAR_WIDTH = 832;

export function isRoute(value: unknown): value is Route {
  if (!value || typeof value !== "object") return false;
  const route = value as { name?: unknown; id?: unknown; time?: unknown };
  if (route.name === "project" && isProjectId(route.id)) {
    if (route.time !== undefined && (!Number.isFinite(route.time) || (route.time as number) < 0))
      return false;
    const recording = (value as { recording?: { id?: unknown; time?: unknown } }).recording;
    return (
      recording === undefined ||
      (!!recording &&
        typeof recording.id === "string" &&
        recording.id.length <= 64 &&
        Number.isFinite(recording.time) &&
        (recording.time as number) >= 0)
    );
  }
  if (route.name === "settings") {
    const tab = (value as { tab?: unknown }).tab;
    return tab === undefined || (SETTINGS_TABS as readonly unknown[]).includes(tab);
  }
  return route.name === "home";
}

export function idleRecording(): RecordingState {
  return {
    phase: "idle",
    countdown: 0,
    elapsed: 0,
    markCount: 0,
    page: 0,
    laser: false,
    clicks: false,
    keys: false,
    target: null,
  };
}

/** A video, or a saved frame, in a project's Exports folder. */
export interface ExportedVideo {
  path: string;
  name: string;
  /** Bytes. */
  size: number;
  /** ISO 8601. */
  createdAt: string;
}

export interface DesktopAPI {
  tasks: {
    list(): Promise<AppTask[]>;
    cancel(id: string): Promise<void>;
    onChange(listener: (tasks: AppTask[]) => void): () => void;
  };
  getState(): Promise<DesktopState>;
  initializeDefaults(setup: RecordingSetup): Promise<DesktopState>;
  updateDefaults(patch: Partial<RecordingSetup>): Promise<DesktopState>;
  updatePreferences(patch: Partial<Preferences>): Promise<DesktopState>;
  onState(listener: (state: DesktopState) => void): () => void;
  /** Lets areas be dragged out over every display, starting from `areas`. Null when cancelled. */
  pickAreas(areas: ScreenArea[]): Promise<ScreenArea[] | null>;
  recording: RecordingAPI;
  /** Exported videos, encoded in the renderer and written to their project's Exports folder. */
  export: ExportAPI;
  toolbar: ToolbarAPI;
  shortcuts: ShortcutsAPI;
  /** The project library, kept by the main process and shared by the main window and the menu bar panel. */
  projects: ProjectsAPI;
  transcription: TranscriptionAPI;
  /** The transcription models on this computer, kept by the main process. */
  models: TranscriptionModelsAPI;
  background: BackgroundAPI;
  /** Noise reduction of recorded audio, track by track. Jobs run in the main process and outlive the editor. */
  noise: NoiseAPI;
  /** Projects' thumbnails, kept up to date by the main process in each project's Thumbnails folder. */
  thumbnails: ThumbnailsAPI;
  /** The background removal models on this computer, kept by the main process. */
  backgroundModels: BackgroundModelsAPI;
  /** The noise reduction engines on this computer, kept by the main process. */
  noiseEngines: NoiseEnginesAPI;
  /** Shows the main window at `route`, hiding the menu bar panel. */
  openMain(route: Route): Promise<void>;
  /** The main window only: a screen asked for from elsewhere is waiting; `takeRoute` returns it. */
  onNavigate(listener: () => void): () => void;
  /** The main window only: the screen asked for from elsewhere, once. */
  takeRoute(): Promise<Route | null>;
  /** The menu bar panel only: hides it. */
  hideMenubar(): Promise<void>;
  /** The toolbar, island, and menu bar windows. Those windows only. */
  overlay: {
    /** Whether a dropdown is open, which makes the whole window take clicks. */
    setDropdownOpen(open: boolean): void;
    /** Closes dropdowns, e.g. when the app is deactivated. */
    onDismiss(listener: () => void): () => void;
    /** Starts moving the window, or resizing it from `edge` (the recording notes window only). */
    dragStart(edge?: ResizeEdge): Promise<void>;
    /** How far the pointer has moved since the drag started, in screen points. */
    dragMove(dx: number, dy: number): void;
    dragEnd(): Promise<void>;
  };
}
