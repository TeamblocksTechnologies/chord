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
import { refreshSources, sources } from "./sources.svelte.ts";
import WindowPreview from "./WindowPreview.svelte";

provideRecordingEnvironment({
  sources,
  get preferences() {
    return desktop.preferences;
  },
  updatePreferences,
  blockedReason: (need) => permissions.blockedReason(need),
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
