import type { IconName } from "#ui/Icon.svelte";

/** A command in a menu. */
export interface MenuCommand {
  label: string;
  icon?: IconName;
  /** Text at the end of the row, e.g. the command's shortcut. */
  detail?: string;
  /** Drawn in red, for commands that delete or remove. */
  destructive?: boolean;
  disabled?: boolean;
  /** A tooltip, e.g. why it's disabled. */
  title?: string;
  onselect: () => void;
}
/** Text in place of commands, e.g. when there are none to offer. */
export interface MenuNote {
  note: string;
}
export type MenuEntry = MenuCommand | MenuNote | "separator";

/** The one context menu in the window, drawn by `ContextMenu` at the pointer. */
export const contextMenu = $state<{
  id: number;
  open: boolean;
  point: { x: number; y: number };
  entries: MenuEntry[];
}>({
  id: 0,
  open: false,
  point: { x: 0, y: 0 },
  entries: [],
});

/** Opens `entries` as the context menu at the pointer, in place of the browser's. */
export function openContextMenu(event: MouseEvent, entries: MenuEntry[]): void {
  event.preventDefault();
  contextMenu.id++;
  contextMenu.point = { x: event.clientX, y: event.clientY };
  contextMenu.entries = entries;
  contextMenu.open = true;
}
