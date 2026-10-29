import type {
  ApplicationSource,
  DeviceSource,
  DisplaySource,
  SourceList,
} from "@teamblocks.dev/chord-recorder-protocol";
import { helper, onHelper } from "#platform/renderer/helper";

/**
 * Displays, apps, and devices as the recorder helper lists them; their ids are what it records. Refreshed when the
 * helper reports a device change or restarts.
 */
export const sources = $state<SourceList>({
  displays: [],
  applications: [],
  windows: [],
  microphones: [],
  cameras: [],
});

/** `error` is set when the helper can't be reached, e.g. it hasn't been built. */
export const sourceStatus = $state<{ loaded: boolean; error: string | null }>({
  loaded: false,
  error: null,
});

export async function refreshSources(): Promise<void> {
  try {
    Object.assign(sources, await helper.request("listSources"));
    sourceStatus.error = null;
  } catch (error) {
    sourceStatus.error = error instanceof Error ? error.message : String(error);
  } finally {
    sourceStatus.loaded = true;
  }
}

void refreshSources();
onHelper("devicesChanged", () => void refreshSources());
onHelper("ready", () => void refreshSources());

/** The displays a setup records: those in `ids`, or the main display when none are chosen. */
export function findDisplays(ids: number[]): DisplaySource[] {
  return sources.displays.filter((d) => (ids.length === 0 ? d.isMain : ids.includes(d.id)));
}

/** The connected devices among `ids`, in `list` order. Disconnected ids are skipped. */
export function findDevices(list: DeviceSource[], ids: string[]): DeviceSource[] {
  return list.filter((d) => ids.includes(d.id));
}

/** Listed apps, one per bundle id: the helper lists each running process, so an app can appear more than once. */
export function uniqueApplications(): ApplicationSource[] {
  const seen = new Set<string>();
  return sources.applications.filter((a) => !seen.has(a.bundleId) && seen.add(a.bundleId));
}

export function findApplication(bundleId: string): ApplicationSource | undefined {
  return sources.applications.find((a) => a.bundleId === bundleId);
}

/** Falls back to the bundle id for apps that aren't running. */
export function applicationName(bundleId: string): string {
  return findApplication(bundleId)?.name ?? bundleId;
}

export function defaultDevice(list: DeviceSource[]): DeviceSource | undefined {
  return list.find((d) => d.isDefault) ?? list[0];
}
