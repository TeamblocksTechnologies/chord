import { on } from "svelte/events";
import type { Attachment } from "svelte/attachments";

/**
 * Calls `close` when the user clicks outside the element, presses Escape, or
 * the window loses focus (e.g. switching to another app).
 */
export function dismiss(close: () => void): Attachment<HTMLElement> {
  return (element) => {
    const offs = [
      on(document, "pointerdown", (event) => {
        if (!element.contains(event.target as Node)) close();
      }),
      // Capture so Escape closes the popover and goes no further: not "back", nor deselecting what's under it.
      on(
        document,
        "keydown",
        (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          close();
        },
        { capture: true },
      ),
      on(window, "blur", close),
    ];
    return () => offs.forEach((off) => off());
  };
}
