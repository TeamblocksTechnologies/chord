// What a recorder lists and records, in the shapes the recording controls read. They match the recorder protocol's
// types structurally, so the desktop app passes its helper's lists straight through.

export interface DisplaySource {
  id: number;
  /** What the OS calls it, e.g. "Built-in Retina Display" or "LG UltraFine". */
  name: string;
  /** Native pixels. */
  width: number;
  height: number;
  /** Pixels per point. `ScreenArea`s are in points. */
  scale: number;
  isMain: boolean;
}

export interface ApplicationSource {
  bundleId: string;
  name: string;
  pid: number;
}

/** A window that can be pinned. */
export interface WindowSource {
  id: number;
  bundleId: string;
  appName: string;
  title?: string;
}

export interface DeviceSource {
  id: string;
  name: string;
  isDefault: boolean;
}

/** A size a camera can capture at. */
export interface CameraFormat {
  /** Native pixels. */
  width: number;
  height: number;
  /** Highest frame rate the camera supports at this size. */
  maxFps: number;
}

export interface CameraSource extends DeviceSource {
  /** One per distinct size, largest first. */
  formats: CameraFormat[];
}

export interface SourceList {
  displays: DisplaySource[];
  applications: ApplicationSource[];
  /** Front to back. */
  windows: WindowSource[];
  microphones: DeviceSource[];
  cameras: CameraSource[];
}

/** What `display` and `area` modes show besides app windows: the wallpaper, or nothing. */
export type ScreenBackground = "desktop" | "transparent";

/** Part of a display, in points from its top left. */
export interface ScreenArea {
  /** A `DisplaySource.id`. */
  displayId: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AudioSource = { kind: "microphone"; deviceId: string } | { kind: "systemAudio" };

/** The displays a setup records: those in `ids`, or the main display when none are chosen. */
export function findDisplays(displays: DisplaySource[], ids: number[]): DisplaySource[] {
  return displays.filter((d) => (ids.length === 0 ? d.isMain : ids.includes(d.id)));
}

/** The connected devices among `ids`, in `list` order. Disconnected ids are skipped. */
export function findDevices<T extends DeviceSource>(list: T[], ids: string[]): T[] {
  return list.filter((d) => ids.includes(d.id));
}

export function defaultDevice<T extends DeviceSource>(list: T[]): T | undefined {
  return list.find((d) => d.isDefault) ?? list[0];
}
