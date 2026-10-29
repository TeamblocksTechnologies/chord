import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
  type Placement,
  type ReferenceElement,
} from "@floating-ui/dom";
import type { Attachment } from "svelte/attachments";

/** Gap between the floating panel and the viewport edge. */
const EDGE = 8;

/**
 * Where the title bar ends. The OS takes clicks on it to move the window, so a panel drawn over it couldn't be
 * clicked there. 0 in windows without one.
 */
function titleBarBottom(): number {
  const bar = document.querySelector(".app-drag");
  return bar && getComputedStyle(bar).getPropertyValue("app-region") === "drag"
    ? bar.getBoundingClientRect().bottom
    : 0;
}

/**
 * Attaches a floating panel to `reference`, keeping it inside the viewport, below the title bar:
 * it flips above when there's more room there, slides sideways to stay on
 * screen, and caps its height to the space left so it scrolls instead of clipping.
 */
export function floating(
  reference: () => ReferenceElement | undefined,
  {
    placement = "bottom",
    gap = 6,
    matchWidth = false,
  }: { placement?: Placement; gap?: number; matchWidth?: boolean } = {},
): Attachment<HTMLElement> {
  return (panel) => {
    const anchor = reference();
    if (!anchor) return;

    Object.assign(panel.style, { position: "fixed", top: "0", left: "0" });

    let active = true;
    let frame = 0;

    const update = () => {
      const padding = { top: EDGE + titleBarBottom(), right: EDGE, bottom: EDGE, left: EDGE };
      return computePosition(anchor, panel, {
        placement,
        strategy: "fixed",
        middleware: [
          offset(gap),
          flip({ padding }),
          shift({ padding }),
          size({
            padding,
            apply({ availableWidth, availableHeight, rects }) {
              if (!active) return;
              if (matchWidth) panel.style.width = `${rects.reference.width}px`;
              panel.style.maxWidth = `${Math.max(0, availableWidth)}px`;
              panel.style.maxHeight = `${Math.max(0, availableHeight)}px`;
            },
          }),
        ],
      }).then(({ x, y }) => {
        if (active) panel.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
      });
    };

    // size() writes dimensions. Doing that inside ResizeObserver delivery can
    // resize the observed listbox again in the same cycle. Coalesce updates in
    // the next frame, before paint, and cancel them when the panel unmounts.
    const stop = autoUpdate(anchor, panel, () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        void update();
      });
    });
    return () => {
      active = false;
      stop();
      cancelAnimationFrame(frame);
    };
  };
}
