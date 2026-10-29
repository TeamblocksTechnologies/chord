import type { SettingsTab } from "#platform/contracts/desktop";
import { router } from "#platform/renderer/router.svelte";

export type { SettingsTab };

/** The settings dialog, opened over whatever screen is showing so closing it returns there. */
class Settings {
  /** The tab showing, or null while the dialog is closed. */
  tab = $state<SettingsTab | null>(null);

  /** Windows without the dialog, like the menu bar panel, open it in the main window instead. */
  open(tab: SettingsTab = "general"): void {
    if (router.elsewhere) router.elsewhere({ name: "settings", tab });
    else this.tab = tab;
  }

  close(): void {
    this.tab = null;
  }
}

export const settings = new Settings();
