import { untrack } from "svelte";

/** The open in-page menus, so an overlay window knows while a dropdown is up and can close them all. */
export const menus = $state({ open: 0 });
const closers = new Set<() => void>();

/**
 * Counts a menu as open until the returned function is called. Meant for an effect, which mustn't depend on the count
 * it changes, or it would re-run itself.
 */
export function trackMenu(close: () => void): () => void {
  untrack(() => menus.open++);
  closers.add(close);
  return () => {
    untrack(() => menus.open--);
    closers.delete(close);
  };
}

export function closeMenus(): void {
  for (const close of [...closers]) close();
}
