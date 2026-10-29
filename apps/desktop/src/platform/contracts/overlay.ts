import type { Rect } from "./desktop.ts";

/**
 * The toolbar and the recording island are drawn in transparent windows with room beside them for a dropdown, so
 * dropdowns open in the same page instead of their own window. The room is part of the window from the start: growing
 * a window upward to fit a dropdown would blank it for a frame on macOS. Clicks pass through wherever nothing is drawn.
 */
export const DROPDOWN = {
  /** The widest dropdown, the screen options. */
  width: 416,
  /** The most room kept for a dropdown; taller ones scroll. */
  room: 520,
  /** Between the dropdown and the edge of the work area. */
  edge: 8,
} as const;

/** Which side of the surface its dropdowns open on. */
export type DropdownSide = "above" | "below";

/** Dropdowns open toward the larger part of the work area. */
export function dropdownSide(surface: Rect, workArea: Rect): DropdownSide {
  return surface.y + surface.height / 2 > workArea.y + workArea.height / 2 ? "above" : "below";
}

/**
 * The window for `surface`: the surface plus room for a dropdown on `side`, as much as the work area allows, and wide
 * enough for the widest dropdown, growing away from the surface's `horizontal` edge.
 */
export function overlayFrame(
  surface: Rect,
  side: DropdownSide,
  horizontal: "left" | "right",
  workArea: Rect,
): Rect {
  const room = Math.max(
    0,
    Math.min(
      DROPDOWN.room,
      side === "above"
        ? surface.y - workArea.y - DROPDOWN.edge
        : workArea.y + workArea.height - (surface.y + surface.height) - DROPDOWN.edge,
    ),
  );
  const width = Math.max(surface.width, DROPDOWN.width);
  return {
    x: horizontal === "left" ? surface.x : surface.x + surface.width - width,
    y: side === "above" ? surface.y - room : surface.y,
    width,
    height: surface.height + room,
  };
}

export function contains(rect: Rect, point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  );
}

/** The panel under the menu bar icon. */
export const MENUBAR = {
  width: 280,
  /** The most it takes; less on a short screen. */
  height: 520,
  /** Between the menu bar and the panel. */
  gap: 6,
  /** Between a dropdown and the panel it opens beside. */
  dropdownGap: 6,
} as const;

/**
 * The menu bar panel under `icon`, kept within the work area, and its window: the panel plus room beside it for the
 * widest dropdown, on the side with more space.
 */
export function menubarFrame(
  icon: Rect,
  workArea: Rect,
): { panel: Rect; frame: Rect; side: "left" | "right" } {
  const width = Math.min(MENUBAR.width, workArea.width - 2 * DROPDOWN.edge);
  const height = Math.min(MENUBAR.height, workArea.height - MENUBAR.gap - DROPDOWN.edge);
  const x = Math.round(
    Math.max(
      workArea.x + DROPDOWN.edge,
      Math.min(
        icon.x + icon.width / 2 - width / 2,
        workArea.x + workArea.width - DROPDOWN.edge - width,
      ),
    ),
  );
  const panel = { x, y: workArea.y + MENUBAR.gap, width, height };
  const left = panel.x - workArea.x;
  const right = workArea.x + workArea.width - (panel.x + panel.width);
  const side = left >= right ? "left" : "right";
  const room = Math.max(
    0,
    Math.min(DROPDOWN.width + MENUBAR.dropdownGap + DROPDOWN.edge, side === "left" ? left : right),
  );
  const frame = {
    x: side === "left" ? panel.x - room : panel.x,
    y: panel.y,
    width: width + room,
    height,
  };
  return { panel, frame, side };
}
