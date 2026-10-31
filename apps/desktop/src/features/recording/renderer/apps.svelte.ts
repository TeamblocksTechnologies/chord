import { onMount } from "svelte";
import type { AppEntry } from "@teamblocks.dev/chord-ui/recording/environment";
import { uniqueApplications } from "./sources.svelte.ts";

export type { AppEntry } from "@teamblocks.dev/chord-ui/recording/environment";
export { filterApps } from "@teamblocks.dev/chord-ui/recording/controls";

/** Apps in the usual app folders, open or not. Refreshed by `refreshInstalledApps`. */
export const installedApps = $state<{ list: { bundleId: string; name: string }[] }>({ list: [] });

/** Apps open now, as in the Dock. Refreshed by `refreshRunningApps`; the helper's list adds to it. */
export const runningApps = $state<{ list: { bundleId: string; name: string }[] }>({ list: [] });

/** Icons as data URLs, by bundle id. Missing until loaded, or for apps without one. */
export const appIcons = $state<Record<string, string>>({});

/** Bundle ids whose icon request has come back, with or without an icon. */
export const iconsSettled = $state<Record<string, boolean>>({});

const requested = new Set<string>();

export async function refreshInstalledApps(): Promise<void> {
  try {
    installedApps.list = (await window.chord.installedApps()).map(({ bundleId, name }) => ({
      bundleId,
      name,
    }));
  } catch (error) {
    console.error(error);
  }
}

export async function refreshRunningApps(): Promise<void> {
  try {
    runningApps.list = (await window.chord.runningApps()).map(({ bundleId, name }) => ({
      bundleId,
      name,
    }));
  } catch (error) {
    console.error(error);
  }
}

/**
 * Every app that could be recorded: open ones first, then the rest of the installed apps, then `extra` ids that
 * are neither (e.g. blocked apps since uninstalled). Each part is sorted by name.
 */
export function listApps(extra: string[] = []): { open: AppEntry[]; closed: AppEntry[] } {
  const byName = (a: AppEntry, b: AppEntry) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const open: AppEntry[] = [];
  const seen = new Set<string>();
  // The helper also lists system UI (Dock, Control Center, ...); of its apps, only installed ones are worth showing.
  const installed = new Set(installedApps.list.map((a) => a.bundleId));
  const listed = uniqueApplications().filter((a) => installed.has(a.bundleId));
  for (const app of [...runningApps.list, ...listed]) {
    if (!seen.has(app.bundleId)) open.push({ bundleId: app.bundleId, name: app.name, open: true });
    seen.add(app.bundleId);
  }
  const closed: AppEntry[] = [];
  for (const app of installedApps.list) {
    if (!seen.has(app.bundleId)) closed.push({ ...app, open: false });
    seen.add(app.bundleId);
  }
  for (const bundleId of extra) {
    if (!seen.has(bundleId))
      closed.push({ bundleId, name: nameFromBundleId(bundleId), open: false });
    seen.add(bundleId);
  }
  return { open: open.toSorted(byName), closed: closed.toSorted(byName) };
}

/** Every app from `listApps` in one list, sorted by name. */
export function allApps(extra: string[] = []): AppEntry[] {
  const { open, closed } = listApps(extra);
  return [...open, ...closed].toSorted((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** An app's name, open or not, from its bundle id. */
export function appName(bundleId: string): string {
  return (
    [...runningApps.list, ...uniqueApplications(), ...installedApps.list].find(
      (a) => a.bundleId === bundleId,
    )?.name ?? nameFromBundleId(bundleId)
  );
}

/** "com.apple.iWork.Keynote" → "Keynote", for apps there's no name for. */
function nameFromBundleId(bundleId: string): string {
  const last = bundleId.split(".").at(-1) ?? bundleId;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/** Loads icons for `apps` not asked for yet. Pids help find open apps that live outside the app folders. */
export function loadIcons(apps: { bundleId: string; pid?: number }[]): void {
  const missing = apps.filter((a) => !requested.has(a.bundleId));
  if (missing.length === 0) return;
  for (const app of missing) requested.add(app.bundleId);
  // Plain objects: state proxies can't cross IPC.
  window.chord
    .appIcons(missing.map(({ bundleId, pid }) => ({ bundleId, pid })))
    .then((icons) => {
      for (const app of missing) {
        iconsSettled[app.bundleId] = true;
        if (icons[app.bundleId]) appIcons[app.bundleId] = icons[app.bundleId];
        // Not drawable now; try again next time, e.g. once the app is open.
        else requested.delete(app.bundleId);
      }
    })
    .catch((error: unknown) => {
      for (const app of missing) requested.delete(app.bundleId);
      console.error(error);
    });
}

void refreshInstalledApps();
void refreshRunningApps();

let catalogueUsers = 0;
let stopCatalogue: (() => void) | undefined;

/** Keep the catalogue fresh while at least one picker is mounted. Call during component setup. */
export function observeAppCatalogue(): void {
  onMount(() => {
    if (catalogueUsers++ === 0) {
      void refreshInstalledApps();
      void refreshRunningApps();
      const timer = setInterval(() => void refreshRunningApps(), 2000);
      const stopIcons = $effect.root(() => {
        $effect(() =>
          loadIcons([
            ...uniqueApplications().map(({ bundleId, pid }) => ({ bundleId, pid })),
            ...runningApps.list,
            ...installedApps.list,
          ]),
        );
      });
      stopCatalogue = () => {
        clearInterval(timer);
        stopIcons();
      };
    }
    return () => {
      if (--catalogueUsers === 0) {
        stopCatalogue?.();
        stopCatalogue = undefined;
      }
    };
  });
}
