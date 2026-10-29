import {
  bindingLabel,
  matchesBinding,
  resolveShortcuts,
  type ShortcutId,
} from "../domain/shortcuts.ts";
import { desktop } from "#platform/renderer/desktop.svelte";

export const mac = window.chord.platform === "darwin";

/** Every shortcut's binding, as the user has them. */
export function bindings(): Record<ShortcutId, string | null> {
  return resolveShortcuts(desktop.preferences.shortcuts);
}

/** Whether a key press is the shortcut. */
export function pressed(event: KeyboardEvent, id: ShortcutId): boolean {
  return matchesBinding(event, bindings()[id], mac);
}

/** The shortcut's keys as text, empty when it's turned off. */
export function shortcutLabel(id: ShortcutId): string {
  return bindingLabel(bindings()[id], mac);
}

/** A tooltip with the shortcut's keys in brackets, when it has any. */
export function withShortcut(title: string, id: ShortcutId): string {
  const label = shortcutLabel(id);
  return label ? `${title} (${label})` : title;
}
