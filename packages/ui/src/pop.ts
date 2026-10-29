import { quintOut } from "svelte/easing";

/** Grows out of its trigger with a fast start that settles softly, like the island. */
export function pop(node: HTMLElement, { origin }: { origin: string }) {
  return {
    duration: 160,
    easing: quintOut,
    css: (t: number) =>
      `opacity: ${t}; transform: scale(${0.96 + 0.04 * t}); transform-origin: ${origin};`,
  };
}
