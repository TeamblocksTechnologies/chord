// Gives the shared recording controls this window's recorder: its sources, the user's preferences, and live
// previews. Imported by each window root that shows the controls.
import { provideRecordingEnvironment } from "@teamblocks.dev/chord-ui/recording/environment";
import { desktop, updatePreferences } from "#platform/renderer/desktop.svelte";
import { appIcons, iconsSettled, listApps, loadIcons, observeAppCatalogue } from "./apps.svelte.ts";
import CameraPreview from "./CameraPreview.svelte";
import DisplayPreview from "./DisplayPreview.svelte";
import FocusedWindowPreview from "./FocusedWindowPreview.svelte";
import LevelMeter from "./LevelMeter.svelte";
import { permissions } from "./permissions.svelte.ts";
import { refreshSources, sourceStatus, sources } from "./sources.svelte.ts";
import WindowPreview from "./WindowPreview.svelte";

provideRecordingEnvironment({
  sources,
  // Without the helper there's nothing more to wait for.
  get ready() {
    return sourceStatus.loaded && (permissions.status !== null || sourceStatus.error !== null);
  },
  get preferences() {
    return desktop.preferences;
  },
  updatePreferences,
  blockedReason: (need) => permissions.blockedReason(need),
  allow: (need) => void permissions.allow(need),
  refreshSources: () => void refreshSources(),
  pickAreas: (areas) => window.chord.desktop.pickAreas(areas),
  apps: {
    list: listApps,
    icons: appIcons,
    settled: iconsSettled,
    load: loadIcons,
    observe: observeAppCatalogue,
  },
  previews: {
    display: DisplayPreview,
    window: WindowPreview,
    focusedWindow: FocusedWindowPreview,
    camera: CameraPreview,
    level: LevelMeter,
  },
});
