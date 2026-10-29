/** Per-occurrence composition. Source ids are manifest track ids, stable across cuts and trims. */
export const LAYOUT_PRESETS = [
  { value: "single", label: "Centered", count: 1 },
  { value: "pip", label: "Picture in picture", count: 2 },
  { value: "split", label: "Split", count: 2 },
  { value: "three-split", label: "Three split", count: 3 },
  { value: "split-stack", label: "Split with another split", count: 3 },
  { value: "split-pip", label: "Split with picture in picture", count: 3 },
  { value: "double-pip", label: "Two pictures in picture", count: 3 },
] as const;
export type LayoutPreset = (typeof LAYOUT_PRESETS)[number]["value"];
export type LayoutCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
/** Horizontal places cells side by side; vertical stacks them. */
export type LayoutDirection = "horizontal" | "vertical";
export interface FeedFraming {
  fit: "contain" | "cover";
  /** The shape a contained feed is cropped to; its own when unset. */
  aspect?: number;
  /** Zoom and focal point within the frame. */
  scale: number;
  x: number;
  y: number;
  /**
   * Corner rounding of the frame, from square at 0 to fully round at 1: half its shorter edge. One value rounds every
   * corner; four round each on its own, clockwise from the top left.
   */
  radius: number | CornerRadii;
}
export type CornerRadii = [
  topLeft: number,
  topRight: number,
  bottomRight: number,
  bottomLeft: number,
];
export type ClipBackground = { type: "solid"; color: string } | { type: "teamblocks" };
export const DEFAULT_CLIP_BACKGROUND = { type: "solid", color: "#000000" } as const;

export function isClipBackground(value: unknown): value is ClipBackground {
  if (!value || typeof value !== "object") return false;
  const background = value as ClipBackground;
  return (
    background.type === "teamblocks" ||
    (background.type === "solid" &&
      typeof background.color === "string" &&
      /^#[0-9a-f]{6}$/i.test(background.color))
  );
}

export interface ClipLayout {
  preset: LayoutPreset;
  sources: string[];
  /** Padding and gaps as fractions of the stage's shorter edge. */
  padding: number;
  gap: number;
  split: number;
  secondarySplit: number;
  direction: LayoutDirection;
  /** Which half of the main split is split again. */
  stack: "start" | "end";
  /** With two pictures, apart puts the second in the next corner along the direction instead of beside the first. */
  pip: { width: number; aspect: number; inset: number; position: LayoutCorner; apart: boolean };
  feeds: Record<string, FeedFraming>;
  /** Omitted uses a solid black background. */
  background?: ClipBackground;
}
export const DEFAULT_FEED_FRAMING: FeedFraming = {
  fit: "contain",
  scale: 1,
  x: 0.5,
  y: 0.5,
  radius: 0,
};
/** `window` marks a pinned window's track. */
export interface LayoutSource {
  id: string;
  kind: "screen" | "camera";
  window?: object;
}

/** Pinned windows are left out unless chosen, so pinning one doesn't change how a recording looks. */
export function defaultClipLayout(
  sources: readonly LayoutSource[],
  camera?: { position: string; width: number },
): ClipLayout {
  const ordered = sources
    .filter((source) => !source.window)
    .sort((a, b) => Number(a.kind === "camera") - Number(b.kind === "camera"));
  const selected = camera?.position === "hidden" ? ordered.slice(0, 1) : ordered.slice(0, 3);
  return {
    preset: selected.length > 2 ? "split-stack" : selected.length > 1 ? "pip" : "single",
    sources: selected.map((source) => source.id),
    padding: 0,
    gap: 0.02,
    split: 0.5,
    secondarySplit: 0.5,
    direction: "horizontal",
    stack: "end",
    pip: {
      width: camera?.width ?? 0.22,
      aspect: 4 / 3,
      inset: 0.04,
      position:
        camera?.position && camera.position !== "hidden"
          ? (camera.position as LayoutCorner)
          : "bottom-right",
      apart: false,
    },
    feeds: {},
  };
}

/** Resolve missing sources without assigning one feed to multiple cells. */
export function layoutSources(layout: ClipLayout, available: readonly LayoutSource[]): string[] {
  const count = Math.min(
    LAYOUT_PRESETS.find((preset) => preset.value === layout.preset)!.count,
    available.length,
  );
  const ids = new Set(available.map((source) => source.id));
  const ordered = [...new Set(layout.sources.filter((id) => ids.has(id)))];
  return [
    ...ordered,
    ...available.map((source) => source.id).filter((id) => !ordered.includes(id)),
  ].slice(0, count);
}

/** Earlier layouts named each direction and side as its own preset. */
const OLD_PRESETS: Record<string, Pick<ClipLayout, "preset" | "direction" | "stack">> = {
  "split-horizontal": { preset: "split", direction: "horizontal", stack: "end" },
  "split-vertical": { preset: "split", direction: "vertical", stack: "end" },
  "three-columns": { preset: "three-split", direction: "horizontal", stack: "end" },
  "three-rows": { preset: "three-split", direction: "vertical", stack: "end" },
  "stack-left": { preset: "split-stack", direction: "horizontal", stack: "start" },
  "stack-right": { preset: "split-stack", direction: "horizontal", stack: "end" },
};
export function upgradeClipLayout(value: unknown): unknown {
  if (!value || typeof value !== "object" || "direction" in value) return value;
  const layout = value as ClipLayout;
  return {
    ...layout,
    ...(OLD_PRESETS[layout.preset] ?? { direction: "horizontal", stack: "end" }),
    ...(layout.pip && typeof layout.pip === "object" && { pip: { ...layout.pip, apart: false } }),
  };
}

const fraction = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
export function isClipLayout(value: unknown): value is ClipLayout {
  if (!value || typeof value !== "object") return false;
  const layout = value as ClipLayout;
  return (
    LAYOUT_PRESETS.some((preset) => preset.value === layout.preset) &&
    Array.isArray(layout.sources) &&
    layout.sources.length <= 3 &&
    layout.sources.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(layout.sources).size === layout.sources.length &&
    fraction(layout.padding, 0, 0.2) &&
    fraction(layout.gap, 0, 0.15) &&
    (layout.background === undefined || isClipBackground(layout.background)) &&
    fraction(layout.split, 0.1, 0.9) &&
    fraction(layout.secondarySplit, 0.1, 0.9) &&
    ["horizontal", "vertical"].includes(layout.direction) &&
    ["start", "end"].includes(layout.stack) &&
    !!layout.pip &&
    typeof layout.pip.apart === "boolean" &&
    fraction(layout.pip.width, 0.1, 0.6) &&
    fraction(layout.pip.aspect, 0.5, 2) &&
    fraction(layout.pip.inset, 0, 0.2) &&
    ["top-left", "top-right", "bottom-left", "bottom-right"].includes(layout.pip.position) &&
    !!layout.feeds &&
    typeof layout.feeds === "object" &&
    !Array.isArray(layout.feeds) &&
    Object.values(layout.feeds).every(
      (feed) =>
        !!feed &&
        ["contain", "cover"].includes(feed.fit) &&
        (feed.aspect === undefined || fraction(feed.aspect, 0.25, 4)) &&
        fraction(feed.scale, 1, 3) &&
        fraction(feed.x, 0, 1) &&
        fraction(feed.y, 0, 1) &&
        (fraction(feed.radius, 0, 1) ||
          (Array.isArray(feed.radius) &&
            feed.radius.length === 4 &&
            feed.radius.every((radius) => fraction(radius, 0, 1)))),
    )
  );
}

/** Each corner's rounding, clockwise from the top left. */
export function cornerRadii(radius: FeedFraming["radius"]): CornerRadii {
  return Array.isArray(radius) ? radius : [radius, radius, radius, radius];
}

/** How many of `count` cells, last in draw order, are pictures over the others. */
export function pictureCount(preset: LayoutPreset, count: number): number {
  if (count < 2) return 0;
  if (preset === "pip") return 1;
  if (preset === "double-pip") return count - 1;
  return preset === "split-pip" && count > 2 ? 1 : 0;
}

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Cells in draw order, in output pixels; gaps and padding stay proportional at any export resolution. */
export function layoutCells(
  layout: ClipLayout,
  width: number,
  height: number,
  count: number,
): LayoutRect[] {
  const unit = Math.min(width, height);
  const pad = unit * layout.padding;
  const box = { x: pad, y: pad, width: width - 2 * pad, height: height - 2 * pad };
  const gap = Math.min(unit * layout.gap, box.width * 0.2, box.height * 0.2);
  const split = (
    rect: LayoutRect,
    horizontal: boolean,
    ratio: number,
  ): [LayoutRect, LayoutRect] => {
    const length = (horizontal ? rect.width : rect.height) - gap;
    return horizontal
      ? [
          { ...rect, width: length * ratio },
          { ...rect, x: rect.x + length * ratio + gap, width: length * (1 - ratio) },
        ]
      : [
          { ...rect, height: length * ratio },
          { ...rect, y: rect.y + length * ratio + gap, height: length * (1 - ratio) },
        ];
  };
  const pips = (count: number): LayoutRect[] => {
    const inset = unit * layout.pip.inset;
    const row = layout.direction === "horizontal";
    // Two pictures share the room along their direction, whether together or apart.
    const along = count > 1 ? 2 : 1;
    const room = (length: number, shared: boolean) =>
      Math.max(1, (length - (shared ? along + 1 : 2) * inset) / (shared ? along : 1));
    const w = Math.min(
      box.width * layout.pip.width,
      room(box.width, row),
      room(box.height, !row) * layout.pip.aspect,
    );
    const h = w / layout.pip.aspect;
    const left = layout.pip.position.endsWith("left"),
      top = layout.pip.position.startsWith("top");
    const at = (left: boolean, top: boolean): LayoutRect => ({
      x: left ? box.x + inset : box.x + box.width - inset - w,
      y: top ? box.y + inset : box.y + box.height - inset - h,
      width: w,
      height: h,
    });
    const first = at(left, top);
    if (count < 2) return [first];
    if (layout.pip.apart) return [first, row ? at(!left, top) : at(left, !top)];
    return [
      first,
      row
        ? { ...first, x: first.x + (left ? 1 : -1) * (w + inset) }
        : { ...first, y: first.y + (top ? 1 : -1) * (h + inset) },
    ];
  };
  if (count < 2 || layout.preset === "single") return count ? [box] : [];
  if (layout.preset === "pip") return [box, ...pips(1)];
  if (layout.preset === "double-pip") return [box, ...pips(count - 1)];
  const horizontal = layout.direction === "horizontal";
  const [first, second] = split(box, horizontal, layout.split);
  if (count < 3 || layout.preset === "split") return [first, second];
  if (layout.preset === "split-pip") return [first, second, ...pips(1)];
  if (layout.preset === "split-stack")
    return layout.stack === "start"
      ? [...split(first, !horizontal, layout.secondarySplit), second]
      : [first, ...split(second, !horizontal, layout.secondarySplit)];
  return [first, ...split(second, horizontal, layout.secondarySplit)];
}

/**
 * `count` cells in rows, as many columns as gives 16:9 feeds the most room, each row centered. Gaps are 2% of the
 * shorter edge.
 */
export function gridCells(count: number, width: number, height: number): LayoutRect[] {
  if (count < 1) return [];
  const gap = Math.min(width, height) * 0.02;
  const size = (columns: number) => {
    const rows = Math.ceil(count / columns);
    return {
      columns,
      rows,
      width: (width - gap * (columns + 1)) / columns,
      height: (height - gap * (rows + 1)) / rows,
    };
  };
  const room = (cell: ReturnType<typeof size>) => Math.min(cell.width, (cell.height * 16) / 9);
  let best = size(1);
  for (let columns = 2; columns <= count; columns++)
    if (room(size(columns)) > room(best)) best = size(columns);
  const top = (height - best.rows * best.height - (best.rows - 1) * gap) / 2;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / best.columns);
    const inRow = Math.min(best.columns, count - row * best.columns);
    const left = (width - inRow * best.width - (inRow - 1) * gap) / 2;
    return {
      x: left + (index % best.columns) * (best.width + gap),
      y: top + row * (best.height + gap),
      width: best.width,
      height: best.height,
    };
  });
}

/**
 * Where a feed shows in its cell, to clip and round, and where its image is drawn. Cover fills the cell, and pictures
 * always do, since their shape is set by the layout; contain
 * shows the feed at its own shape, or crops it to the chosen one. Zoom crops within the frame, and the focal point
 * places both the frame in the cell and the crop.
 */
export function frameFeed(
  cell: LayoutRect,
  width: number,
  height: number,
  framing: FeedFraming,
): { frame: LayoutRect; image: LayoutRect } {
  const aspect =
    framing.fit === "cover" ? cell.width / cell.height : (framing.aspect ?? width / height);
  const frameHeight = Math.min(cell.height, cell.width / aspect),
    frameWidth = frameHeight * aspect;
  const frame = {
    x: cell.x + (cell.width - frameWidth) * framing.x,
    y: cell.y + (cell.height - frameHeight) * framing.y,
    width: frameWidth,
    height: frameHeight,
  };
  const scale = Math.max(frameWidth / width, frameHeight / height) * framing.scale;
  const w = width * scale,
    h = height * scale;
  return {
    frame,
    image: {
      x: frame.x + (frameWidth - w) * framing.x,
      y: frame.y + (frameHeight - h) * framing.y,
      width: w,
      height: h,
    },
  };
}
