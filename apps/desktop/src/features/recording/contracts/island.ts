import type { Rect } from "#platform/contracts/desktop";

/**
 * The recording island: compact while the cursor is elsewhere, showing a small camera preview (when one is on) above
 * the status dot and timer; hovering it opens it into the controls and source cells. Both are pinned to the same
 * corner, so it grows and shrinks in place, wherever it was last dragged.
 */
export type IslandMode = "compact" | "open";
export interface IslandState {
  visible: boolean;
  mode: IslandMode;
  /** A camera is being recorded, so the open island shows it. */
  camera: boolean;
  /** The compact island shows the camera too. */
  preview: boolean;
  /** The open island has its annotation tools, which only make sense while a screen is recorded. */
  tools: boolean;
  /** The corner it's pinned to, which the surface grows from inside its window. */
  corner: Pick<IslandAnchor, "horizontal" | "vertical">;
}

/** Where the island sits: a corner of the work area, and its distance from that corner's two edges. */
export interface IslandAnchor {
  horizontal: "left" | "right";
  vertical: "top" | "bottom";
  x: number;
  y: number;
}

export const ISLAND = {
  /** Distance from the work area's edges by default. */
  margin: 16,
  /** The compact island's dot and timer. */
  compactBar: 36,
  compactWidth: 112,
  /** The compact island's camera, above its timer. */
  compactCamera: { width: 140, height: 105 },
  /** The open island's timer and controls. */
  bar: 44,
  openWidth: 392,
  openCameraHeight: 220,
  /** Two rows of compact cells. */
  cells: 92,
  /** The row of annotation tools under the cells. */
  tools: 44,
  /** How far the cursor can stray past the open island before it closes. */
  slop: 8,
} as const;

export const DEFAULT_ANCHOR: IslandAnchor = {
  horizontal: "right",
  vertical: "bottom",
  x: ISLAND.margin,
  y: ISLAND.margin,
};

/** Whether the island in `mode` shows the camera: opening it always does, compact only when previewing. */
export function showsCamera(
  mode: IslandMode,
  { camera, preview }: Pick<IslandState, "camera" | "preview">,
): boolean {
  return camera && (mode === "open" || preview);
}

export function islandSize(
  mode: IslandMode,
  camera: boolean,
  tools = true,
): { width: number; height: number } {
  if (mode === "compact") {
    return camera
      ? {
          width: ISLAND.compactCamera.width,
          height: ISLAND.compactCamera.height + ISLAND.compactBar,
        }
      : { width: ISLAND.compactWidth, height: ISLAND.compactBar };
  }
  return {
    width: ISLAND.openWidth,
    height:
      (camera ? ISLAND.openCameraHeight : 0) +
      ISLAND.bar +
      ISLAND.cells +
      (tools ? ISLAND.tools : 0),
  };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

/** The island in `mode`, pinned to its anchor's corner and kept within the work area. */
export function islandBounds(
  mode: IslandMode,
  anchor: IslandAnchor,
  camera: boolean,
  workArea: Rect,
  tools = true,
): Rect {
  const { width, height } = islandSize(mode, camera, tools);
  const dx = Math.round(clamp(anchor.x, 0, Math.max(0, workArea.width - width)));
  const dy = Math.round(clamp(anchor.y, 0, Math.max(0, workArea.height - height)));
  return {
    x: anchor.horizontal === "left" ? workArea.x + dx : workArea.x + workArea.width - width - dx,
    y: anchor.vertical === "top" ? workArea.y + dy : workArea.y + workArea.height - height - dy,
    width,
    height,
  };
}

/** Where the surface in `mode` is drawn inside the island's window, which is the open island's size. */
export function surfaceIn(
  frame: Rect,
  corner: IslandState["corner"],
  mode: IslandMode,
  camera: boolean,
  tools = true,
): Rect {
  const { width, height } = islandSize(mode, camera, tools);
  return {
    x: corner.horizontal === "left" ? frame.x : frame.x + frame.width - width,
    y: corner.vertical === "top" ? frame.y : frame.y + frame.height - height,
    width,
    height,
  };
}

/** The anchor for an island dragged to `bounds`: pinned to the work area corner its center is nearest. */
export function anchorFor(bounds: Rect, workArea: Rect): IslandAnchor {
  const horizontal =
    bounds.x + bounds.width / 2 < workArea.x + workArea.width / 2 ? "left" : "right";
  const vertical =
    bounds.y + bounds.height / 2 < workArea.y + workArea.height / 2 ? "top" : "bottom";
  return {
    horizontal,
    vertical,
    x: Math.max(
      0,
      horizontal === "left"
        ? bounds.x - workArea.x
        : workArea.x + workArea.width - bounds.x - bounds.width,
    ),
    y: Math.max(
      0,
      vertical === "top"
        ? bounds.y - workArea.y
        : workArea.y + workArea.height - bounds.y - bounds.height,
    ),
  };
}

export function isIslandAnchor(value: unknown): value is IslandAnchor {
  const a = value as IslandAnchor;
  return (
    !!a &&
    typeof a === "object" &&
    ["left", "right"].includes(a.horizontal) &&
    ["top", "bottom"].includes(a.vertical) &&
    Number.isFinite(a.x) &&
    Number.isFinite(a.y)
  );
}

/** How far a point is from a rectangle; 0 inside it. */
export function distance(point: { x: number; y: number }, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

export interface IslandInput {
  mode: IslandMode;
  cursor: { x: number; y: number };
  /** Where the island is now. */
  bounds: Rect;
  /** A source dropdown is open in the island, which keeps it open. */
  dropdownOpen: boolean;
}

/** The mode for the cursor's position, or null to stay: hovering opens it, and leaving closes it, right away. */
export function nextIslandMode({
  mode,
  cursor,
  bounds,
  dropdownOpen,
}: IslandInput): IslandMode | null {
  if (mode === "compact") return distance(cursor, bounds) === 0 ? "open" : null;
  return !dropdownOpen && distance(cursor, bounds) > ISLAND.slop ? "compact" : null;
}
