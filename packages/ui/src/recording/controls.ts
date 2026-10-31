/** State helpers for the recording controls. */
import type { IconName } from "#ui/Icon.svelte";
import {
  cameraPreset,
  frameRates,
  presetLabel,
  resolveCamera,
  resolveScreen,
  screenPreset,
  type CameraQuality,
  type QualityPreset,
  type ScreenQuality,
} from "#ui/model/quality.ts";
import {
  activeAreas,
  activeCameraIds,
  type CaptureMode,
  type RecordingSetup,
} from "#ui/model/setup.ts";
import {
  defaultDevice,
  findDevices,
  findDisplays,
  type CameraSource,
  type DeviceSource,
  type ScreenArea,
  type WindowSource,
} from "#ui/model/sources.ts";
import { recordingEnvironment } from "./environment.ts";

const sources = () => recordingEnvironment().sources;

export const modes: { mode: CaptureMode; icon: IconName; label: string; short: string }[] = [
  { mode: "window", icon: "window", label: "Focused window", short: "Windows" },
  { mode: "display", icon: "monitor", label: "Full display", short: "Display" },
  { mode: "area", icon: "area", label: "Area", short: "Area" },
];

export function toggled<T>(ids: T[], id: T): T[] {
  return ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id];
}

/**
 * `display` mode records any number of displays. Deselecting the last one records no screen. While the screen is off
 * its displays are kept, and picking one of them just switches it back on.
 */
export function toggleDisplay(setup: RecordingSetup, id: number) {
  const current = findDisplays(sources().displays, setup.displayIds).map((d) => d.id);
  if (!setup.recordsScreen && current.includes(id)) {
    setup.recordsScreen = true;
    return;
  }
  const next = toggled(current, id);
  setup.recordsScreen = next.length > 0;
  setup.displayIds =
    next.length === 1 && sources().displays.find((d) => d.id === next[0])?.isMain ? [] : next;
}

/** The open windows a setup pins, front to back. Ones that have closed are left out. */
export function pinnedWindowSources(setup: RecordingSetup): WindowSource[] {
  return sources().windows.filter((w) => setup.pinnedWindowIds.includes(w.id));
}

/** Pins or unpins a window, forgetting pinned windows that have closed. Pinning switches the screen on. */
export function togglePinnedWindow(setup: RecordingSetup, id: number) {
  setup.pinnedWindowIds = toggled(
    pinnedWindowSources(setup).map((w) => w.id),
    id,
  );
  if (setup.pinnedWindowIds.includes(id)) setup.recordsScreen = true;
}

/** "None", the one pinned window's app, or how many are pinned. */
export function pinnedSummary(setup: RecordingSetup): string {
  const pinned = pinnedWindowSources(setup);
  if (pinned.length === 0) return "None";
  return pinned.length === 1 ? pinned[0].appName : `${pinned.length} windows`;
}

/** Switching to `area` mode with no active areas picks them first, and stays put if none are. */
export async function setMode(setup: RecordingSetup, mode: CaptureMode) {
  if (mode === "area" && activeAreas(setup).length === 0) {
    if (!(await chooseAreas(setup))) return;
  }
  setup.mode = mode;
  setup.recordsScreen = true;
}

/**
 * Opens the area picker over every display; keeps what was there if it's cancelled. Displays whose areas were edited
 * switch back on, and those left with none are forgotten. Returns whether any area is on afterwards.
 */
export async function chooseAreas(setup: RecordingSetup): Promise<boolean> {
  const picked = await pickAreas(setup);
  if (!picked) return activeAreas(setup).length > 0;
  const key = (displayId: number, list: ScreenArea[]) =>
    JSON.stringify(list.filter((a) => a.displayId === displayId));
  const edited = (id: number) => key(id, setup.areas) !== key(id, picked);
  setup.inactiveAreaDisplayIds = setup.inactiveAreaDisplayIds.filter(
    (id) => !edited(id) && picked.some((a) => a.displayId === id),
  );
  setup.areas = picked;
  if (activeAreas(setup).length > 0) setup.recordsScreen = true;
  return activeAreas(setup).length > 0;
}

/**
 * Checks or unchecks a display in `area` mode. Unchecking keeps its areas but switches them off (and turns the screen
 * off with the last one); checking switches them back on, or opens the picker if it has none.
 */
export async function toggleAreaDisplay(setup: RecordingSetup, displayId: number) {
  const has = setup.areas.some((a) => a.displayId === displayId);
  const on = has && !setup.inactiveAreaDisplayIds.includes(displayId);
  if (on && setup.recordsScreen) {
    setup.inactiveAreaDisplayIds = [...setup.inactiveAreaDisplayIds, displayId];
    if (activeAreas(setup).length === 0) setup.recordsScreen = false;
  } else if (has) {
    setup.inactiveAreaDisplayIds = setup.inactiveAreaDisplayIds.filter((id) => id !== displayId);
    setup.recordsScreen = true;
  } else {
    await chooseAreas(setup);
  }
}

async function pickAreas(setup: RecordingSetup): Promise<ScreenArea[] | null> {
  const pick = recordingEnvironment().pickAreas;
  // Plain copies: reactive proxies can't cross IPC.
  return pick ? pick(setup.areas.map((area) => ({ ...area }))) : null;
}

/** Whether areas can be drawn here; without a picker, only the areas a setup already has can be switched. */
export function canPickAreas(): boolean {
  return !!recordingEnvironment().pickAreas;
}

/** The connected displays with an area switched on, in display order. */
export function areaDisplays(setup: RecordingSetup) {
  const areas = activeAreas(setup);
  return sources().displays.filter((d) => areas.some((a) => a.displayId === d.id));
}

/** What the screen is set to record, kept while it's off. */
export function screenNames(setup: RecordingSetup): string[] {
  if (setup.mode === "window") return ["Focused window"];
  const displays = findDisplays(sources().displays, setup.displayIds);
  if (setup.mode === "area") return areaDisplays(setup).map((d) => d.name);
  return displays.length > 0 ? displays.map((d) => d.name) : ["Main display"];
}

export function cameraNames(setup: RecordingSetup): string[] {
  return findDevices(sources().cameras, setup.cameraIds).map((c) => c.name);
}

export function microphoneNames(setup: RecordingSetup): string[] {
  return findDevices(sources().microphones, setup.microphoneIds).map((m) => m.name);
}

/** Summarizes which apps are blocked, leaving out the apps `alwaysHidden` keeps out of every recording. */
export function appSummary(
  setup: RecordingSetup,
  alwaysHidden: string[],
): { label: string; blocked: number; allowed: number } {
  const lists = recordingEnvironment().apps.list(setup.hiddenApps);
  const shown = (a: { bundleId: string }) => !alwaysHidden.includes(a.bundleId);
  const open = lists.open.filter(shown);
  const every = [...open, ...lists.closed.filter(shown)];
  const allowed = every.filter((a) => !setup.hiddenApps.includes(a.bundleId));
  const blocked = every.length - allowed.length;
  const openOnly = allowed.length === open.length && allowed.every((a) => a.open);
  const label =
    blocked === 0
      ? "All apps"
      : allowed.length === 0
        ? "No apps"
        : openOnly
          ? "Open only"
          : blocked <= allowed.length
            ? `${blocked} blocked`
            : allowed.length === 1
              ? allowed[0].name
              : `${allowed.length} apps`;
  return { label, blocked, allowed: allowed.length };
}

/** "Name" or "Name +2". */
export function summarize(names: string[], none: string): string {
  if (names.length === 0) return none;
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
}

/** The chosen devices, or the system default when none were ever chosen. */
export function devicesToEnable(ids: string[], list: DeviceSource[]): string[] {
  const device = defaultDevice(list);
  return ids.length > 0 ? ids : device ? [device.id] : [];
}

export function screenLabel(setup: RecordingSetup): string {
  if (setup.mode === "window") return "Windows";
  const names = screenNames(setup);
  if (setup.mode === "area")
    return activeAreas(setup).length > 1 ? `${activeAreas(setup).length} areas` : "Area";
  return names.length > 1
    ? `${names.length} displays`
    : sources().displays.length > 1
      ? names[0]
      : "Full display";
}

export function screenIcon(setup: RecordingSetup): IconName {
  return modes.find((m) => m.mode === setup.mode)!.icon;
}

const same = (a: object, b: object | undefined) => !!b && JSON.stringify(a) === JSON.stringify(b);

/** Changes the screen's settings. Matching its preset again makes it follow the preset. */
export function setScreenQuality(setup: RecordingSetup, patch: Partial<ScreenQuality>) {
  const next = { ...resolveScreen(setup.quality, setup.screenQuality), ...patch };
  setup.screenQuality = same(next, screenPreset(setup.quality)) ? null : next;
}

/** Changes a camera's settings, keeping its frame rate within what the new size allows. */
export function setCameraQuality(
  setup: RecordingSetup,
  camera: CameraSource,
  patch: Partial<CameraQuality>,
) {
  const current = resolveCamera(camera, setup.quality, setup.cameraQuality[camera.id]);
  if (!current) return;
  const next = { ...current, ...patch };
  const format = camera.formats.find((f) => f.width === next.width && f.height === next.height);
  if (!format) return;
  const rates = frameRates(format);
  if (!rates.includes(next.fps))
    next.fps = rates.filter((r) => r <= current.fps).at(-1) ?? rates[0];
  const { [camera.id]: _, ...others } = setup.cameraQuality;
  setup.cameraQuality = same(next, cameraPreset(camera, setup.quality))
    ? others
    : { ...others, [camera.id]: next };
}

/** Sets the preset every source follows, and makes these sources follow it again. */
export function choosePreset(
  setup: RecordingSetup,
  preset: QualityPreset,
  sources: { screen?: boolean; cameraIds?: string[] },
) {
  setup.quality = preset;
  if (sources.screen) setup.screenQuality = null;
  if (sources.cameraIds) {
    setup.cameraQuality = Object.fromEntries(
      Object.entries(setup.cameraQuality).filter(([id]) => !sources.cameraIds!.includes(id)),
    );
  }
}

/** The connected cameras a setup records. */
export function selectedCameras(setup: RecordingSetup): CameraSource[] {
  return sources().cameras.filter((c) => setup.cameraIds.includes(c.id));
}

/**
 * The camera the island previews: the chosen primary while it's still recorded and connected, otherwise the system
 * default among the recorded cameras, otherwise the first of them. Undefined when none is connected.
 */
export function primaryCamera(setup: RecordingSetup): CameraSource | undefined {
  const recorded = sources().cameras.filter((c) => activeCameraIds(setup).includes(c.id));
  return (
    recorded.find((c) => c.id === setup.primaryCameraId) ??
    recorded.find((c) => c.isDefault) ??
    recorded[0]
  );
}

/** The preset's name, or Custom when any of these sources has its own settings. */
export function qualityLabel(setup: RecordingSetup, custom: boolean): string {
  return custom ? "Custom" : presetLabel(setup.quality);
}

/** Case-insensitive name matching, shared by the grouped and flat app pickers. */
export function filterApps<T extends { name: string }>(apps: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  return apps.filter((app) => app.name.toLowerCase().includes(needle));
}
