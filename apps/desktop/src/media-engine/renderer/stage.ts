/**
 * Draws one frame of a project's edit: its backdrop, then the recording's visual layers from back to front. Pointer
 * effects follow the screen's projection. Camera stays above annotations, which stay above the screen. Preview and
 * export share the stage so coverage and camera treatment produce the same composition in both.
 */
import {
  DEFAULT_CLIP_BACKGROUND,
  DEFAULT_FEED_FRAMING,
  cornerRadii,
  defaultClipLayout,
  frameFeed,
  gridCells,
  layoutCells,
  layoutSources,
  pictureCount,
  type FeedFraming,
  type LayoutRect,
} from "#features/editing/domain/clipLayout";
import type { CaptionStyle } from "#features/transcription/domain/captions";
import type { CaptionLine } from "./captions.ts";
import { noAnnotations, type Annotations } from "#features/editing/domain/annotations";
import type { Recording, RecordingBackdrop } from "#project-document/domain/recording";
import {
  type CameraPlan,
  DEFAULT_CAMERA_OPTIONS,
  type Rect,
  cameraAt,
  fit,
  frameAt,
  liveSpanAt,
  planCamera,
  toRect,
} from "./camera.ts";
import { CameraCompositor, type CameraTreatment } from "./background.ts";
import { ShownDetector } from "./detect.ts";
import { drawClipBackground } from "./clipBackground.ts";
import { drawEffect, type EffectOptions, type Projection } from "./effects.ts";
import {
  compositingLayers,
  cursorStyleOf,
  isAnnotationLayer,
  visualLayersOf,
  type VisualLayer,
} from "#features/editing/domain/visualLayers";
import { followerAt, type Clip, type Part, type Timeline } from "./timeline.ts";

/** How far either side of live motion the image corrects the camera, for frames the bounds lag behind. */
const CORRECTION_MARGIN = 0.1;
/** How far from the recorded bounds the image's edges are searched for, in points. */
const CORRECTION_TOLERANCE = 80;

/** What's behind the picture: black, the gradient followed windows float on, or nothing, for transparent video. */
export type Backdrop = "black" | "gradient" | "none";

/** An image to draw and its size in pixels. */
export interface StageImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  time?: number;
}

/** What's on the stage at one moment. */
export interface StageScene {
  /** The piece playing; null between pieces. */
  part: Part | null;
  /** The piece's leading clip. */
  clip?: Clip;
  /** The time on the piece's recording's own timeline. */
  time?: number;
  /** The screen's frame, when the screen leads. Its timestamp is its time in the clip's file. */
  screen?: VideoFrame | null;
  /** The camera's frame: a bubble over the screen, or the whole stage when the camera leads. */
  camera?: StageImage | null;
  mask?: StageImage | null;
  /** Other recorded feeds and their foreground masks, by manifest track id. */
  feeds?: Record<string, StageImage | null>;
  masks?: Record<string, StageImage | null>;
}

/** Each recording's own backdrop, where it has one. */
export function recordingBackdrops(recordings: Recording[]): Record<string, RecordingBackdrop> {
  return Object.fromEntries(
    recordings.flatMap((recording) =>
      recording.backdrop ? [[recording.id, recording.backdrop]] : [],
    ),
  );
}

/** A feed as a layout showed it: its cell, the frame it's clipped to, where its whole image was drawn, and how. */
export interface FeedPlacement {
  id: string;
  cell: LayoutRect;
  frame: LayoutRect;
  image: LayoutRect;
  framing: FeedFraming;
}

export class Stage {
  backdrop: Backdrop = "black";
  /** Recordings' own backdrops, over `backdrop` while they play. None, for transparent video, still leaves them out. */
  backdrops: Record<string, RecordingBackdrop> = {};
  captions: CaptionLine[] = [];
  captionStyle: CaptionStyle = "lines";
  backgrounds: Record<string, CameraTreatment> = {};
  #compositor = new CameraCompositor();
  /** When each recording's pointer effects are on. Read every frame, so changes show at once. */
  annotations: (recordingId: string) => Annotations | undefined = () => undefined;

  /** Independent visual sources and annotation coverage, shared by preview and export. */
  layers?: (recordingId: string) => VisualLayer[] | undefined;
  /** Shows every recorded video feed side by side, as a recording edited on its own does, rather than its layout. */
  showsEveryFeed = false;
  /** Where the last frame's layout showed each feed, in canvas pixels and draw order. */
  placements: FeedPlacement[] = [];

  #aspect: number;
  /** Each recording's camera path at `#aspect`, planned when it's first drawn. */
  #plans = new WeakMap<Timeline, CameraPlan | undefined>();
  #detector = new ShownDetector();
  #clickColor: string;
  #gradient: [string, string, string];

  /** `aspect` is the shape followed windows are framed at: the stage's width / height. */
  constructor(aspect: number) {
    this.#aspect = aspect;
    const style = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;
    this.#clickColor = color("--color-primary", "#155dfc");
    this.#gradient = [
      color("--color-neutral-800", "#262626"),
      color("--color-neutral-900", "#171717"),
      color("--color-neutral-950", "#0a0a0a"),
    ];
  }

  get aspect(): number {
    return this.#aspect;
  }

  /** Frames followed windows at `aspect` from now on. */
  set aspect(aspect: number) {
    if (!(aspect > 0) || Math.abs(aspect - this.#aspect) < 1e-3) return;
    this.#aspect = aspect;
    this.#plans = new WeakMap();
  }

  /** Draws `scene` over the whole of `context`'s canvas. */
  draw(context: CanvasRenderingContext2D, scene: StageScene): void {
    const { width, height } = context.canvas;
    context.clearRect(0, 0, width, height);
    this.placements = [];
    if (width === 0 || height === 0) return;
    const { part, clip, time } = scene;
    if (this.backdrop !== "none" && part && !this.showsEveryFeed) {
      drawClipBackground(
        context,
        part.layout?.background ?? DEFAULT_CLIP_BACKGROUND,
        part.offset + (time ?? part.start) - part.start,
      );
    } else {
      this.#drawBackdrop(
        context,
        width,
        height,
        this.backdrop !== "none" && part
          ? (this.backdrops[part.recordingId] ?? this.backdrop)
          : this.backdrop,
      );
    }
    if (!part || !clip || time === undefined) return;
    context.imageSmoothingQuality = "high";
    if (this.showsEveryFeed && (part.timeline.video?.length ?? 0) > 1) {
      // The leading feed first, then the other screens and pinned windows, then the cameras.
      const ids = [...part.timeline.video!]
        .sort(
          (a, b) =>
            Number(b.lead) - Number(a.lead) ||
            Number(a.kind === "camera") - Number(b.kind === "camera"),
        )
        .map((source) => source.id);
      this.#drawLayout(context, scene, ids, gridCells(ids.length, width, height));
    } else {
      // Match the inspector's default before the first edit saves it, so saving cannot change the composition.
      const layout = part.layout ?? defaultClipLayout(part.timeline.video ?? [], part.cameraLayout);
      const ids = layoutSources(layout, part.timeline.video ?? []);
      this.placements = this.#drawLayout(
        context,
        scene,
        ids,
        layoutCells(layout, width, height, ids.length),
        layout.feeds,
        pictureCount(layout.preset, ids.length),
      );
    }
    const at = part.offset + time - part.start;
    const line = this.captions.find((line) => at >= line.start && at < line.end);
    if (line) drawCaption(context, line, at, this.captionStyle, this.#clickColor);
  }

  /**
   * Draws the feeds `ids` in `cells`, framed by `feeds`. Each cell owns its crop and annotations; later cells can
   * overlay earlier ones, and the last `pictures` always fill theirs. Returns where each feed was shown.
   */
  #drawLayout(
    context: CanvasRenderingContext2D,
    scene: StageScene,
    ids: string[],
    cells: LayoutRect[],
    feeds: Record<string, FeedFraming> = {},
    pictures = 0,
  ): FeedPlacement[] {
    const { part, clip, time } = scene;
    const placements: FeedPlacement[] = [];
    if (!part || !clip || time === undefined) return placements;
    const { width, height } = context.canvas;
    const sources = part.timeline.video ?? [];
    const treatment = this.backgrounds[part.recordingId];
    const layers =
      this.layers?.(part.recordingId) ??
      visualLayersOf({
        mode: part.timeline.lead === "screen" ? "display" : null,
        hasCamera: !!scene.camera,
        annotations: this.annotations(part.recordingId) ?? noAnnotations(),
      });
    const options = effectOptions(layers);
    ids.forEach((id, index) => {
      const source = sources.find((source) => source.id === id)!;
      const primaryCamera = source.kind === "camera" && source.index === 0;
      let image =
        source.lead && source.kind === "screen" && scene.screen
          ? {
              image: scene.screen,
              width: scene.screen.displayWidth,
              height: scene.screen.displayHeight,
            }
          : primaryCamera
            ? scene.camera
            : scene.feeds?.[id];
      if (!image) return;
      const cell = cells[index];
      const framing: FeedFraming = {
        ...(feeds[id] ?? DEFAULT_FEED_FRAMING),
        ...(index >= ids.length - pictures && { fit: "cover" }),
      };
      const mask = primaryCamera ? scene.mask : scene.masks?.[id];
      if (source.kind === "camera" && mask && treatment?.settings.enabled) {
        image = this.#compositor.draw(image, mask, treatment.settings, cell.width);
      }
      const focused = source.lead && source.kind === "screen" && clip.focused && scene.screen;
      // A pinned window's frame is its whole display, so it's cropped to where the window was.
      const crop =
        source.window && followerAt(source.clips, clip.start + time - clip.offset)?.clip.crop;
      const shown = crop
        ? {
            x: crop.x * image.width,
            y: crop.y * image.height,
            width: crop.width * image.width,
            height: crop.height * image.height,
          }
        : { x: 0, y: 0, width: image.width, height: image.height };
      const { frame, image: destination } = frameFeed(
        cell,
        focused ? width : shown.width,
        focused ? height : shown.height,
        framing,
      );
      placements.push({ id, cell, frame, image: destination, framing });
      context.save();
      try {
        context.beginPath();
        context.roundRect(
          frame.x,
          frame.y,
          frame.width,
          frame.height,
          cornerRadii(framing.radius).map(
            (radius) => (Math.min(frame.width, frame.height) / 2) * radius,
          ),
        );
        context.clip();
        let projection: Projection | undefined;
        if (focused) {
          const placement = this.#focusedScreenPlacement(context, part, clip, time, scene.screen!);
          const scale = destination.width / width;
          context.drawImage(
            image.image,
            destination.x + placement.x * scale,
            destination.y + placement.y * scale,
            placement.width * scale,
            placement.height * scale,
          );
          const points = placement.projection.scale * scale;
          projection = {
            x: placement.projection.x - destination.x / points,
            y: placement.projection.y - destination.y / points,
            scale: points,
          };
        } else {
          context.drawImage(
            image.image,
            shown.x,
            shown.y,
            shown.width,
            shown.height,
            destination.x,
            destination.y,
            destination.width,
            destination.height,
          );
          if (source.lead && source.kind === "screen") {
            const region = clip.region ?? part.timeline.screen!.area;
            const points = destination.width / region.width;
            projection = {
              x: region.x - destination.x / points,
              y: region.y - destination.y / points,
              scale: points,
            };
          }
        }
        if (projection && part.timeline.input) {
          for (const layer of compositingLayers(layers).reverse())
            if (isAnnotationLayer(layer)) {
              drawEffect(
                context,
                part.timeline.input,
                layer.kind,
                layer.spans,
                time,
                projection,
                this.#clickColor,
                options,
              );
            }
        }
      } finally {
        context.restore();
      }
    });
    return placements;
  }

  #drawBackdrop(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    backdrop: Backdrop,
  ): void {
    if (backdrop === "none") return;
    if (backdrop === "black") {
      context.fillStyle = "black";
    } else {
      // As CSS draws `to bottom right`: the top right and bottom left corners are the middle color.
      const reach = (width * height) / Math.hypot(width, height);
      const [dx, dy] = [height / Math.hypot(width, height), width / Math.hypot(width, height)];
      const gradient = context.createLinearGradient(
        width / 2 - dx * reach,
        height / 2 - dy * reach,
        width / 2 + dx * reach,
        height / 2 + dy * reach,
      );
      this.#gradient.forEach((color, index) => gradient.addColorStop(index / 2, color));
      context.fillStyle = gradient;
    }
    context.fillRect(0, 0, width, height);
  }

  /** A followed window's screen image and input projection, before fitting it into its layout cell. */
  #focusedScreenPlacement(
    context: CanvasRenderingContext2D,
    part: Part,
    clip: Clip,
    time: number,
    frame: VideoFrame,
  ): { x: number; y: number; width: number; height: number; projection: Projection } {
    const { width } = context.canvas;
    const { area } = part.timeline.screen!;
    const camera = this.#cameraFor(part.timeline, time, clip, frame);
    const scale = width / camera.width;
    return {
      x: (area.x - camera.x) * scale,
      y: (area.y - camera.y) * scale,
      width: area.width * scale,
      height: area.height * scale,
      projection: { x: camera.x, y: camera.y, scale },
    };
  }

  /** The camera path over a recording's screen, when it has one. */
  #planFor(timeline: Timeline): CameraPlan | undefined {
    if (this.#plans.has(timeline)) return this.#plans.get(timeline);
    const { screen, duration } = timeline;
    const plan =
      screen &&
      planCamera(screen.samples, duration, {
        ...DEFAULT_CAMERA_OPTIONS,
        aspect: this.#aspect,
        area: screen.area,
      });
    this.#plans.set(timeline, plan);
    return plan;
  }

  /**
   * The camera at `time` for drawing `frame`. During live motion the recorded bounds can be a frame off the image,
   * so the camera follows the frame's own time and is corrected by what it actually shows.
   */
  #cameraFor(timeline: Timeline, time: number, clip: Clip, frame: VideoFrame): Rect {
    const plan = this.#planFor(timeline)!;
    const { area } = timeline.screen!;
    if (!liveSpanAt(plan, time, CORRECTION_MARGIN)) return cameraAt(plan.path, time);
    const frameTime = clip.offset + frame.timestamp / 1e6 - (clip.fileStart ?? 0);
    const camera = cameraAt(plan.path, frameTime);
    // The plan frames the bounds slightly ahead during motion; correct from that to what the image shows.
    const hint = frameAt(plan.holds, frameTime + DEFAULT_CAMERA_OPTIONS.liveShift);
    const shown = hint && this.#detector.detect(frame, area, hint, CORRECTION_TOLERANCE);
    if (!hint || !shown) return camera;
    const options = { ...DEFAULT_CAMERA_OPTIONS, aspect: this.#aspect };
    const [planned, measured] = [fit(hint, options), fit(shown, options)];
    // While the window is moving the camera is smoothed, so it isn't exactly on the planned bounds and a nudge
    // would leave it off-center: center on what's shown. In the margin around, nudge to blend with the path.
    const locked = !!liveSpanAt(plan, time);
    return toRect(
      [
        locked ? measured[0] : camera.x + camera.width / 2 + measured[0] - planned[0],
        locked ? measured[1] : camera.y + camera.height / 2 + measured[1] - planned[1],
        camera.width + measured[2] - planned[2],
      ],
      this.#aspect,
    );
  }
}

/** What the effects need from the recording's other layers: the cursor's style, and when the laser stands in for it. */
function effectOptions(layers: readonly VisualLayer[]): EffectOptions {
  const effects = layers.filter(isAnnotationLayer);
  const cursor = effects.find((layer) => layer.kind === "cursor");
  const style = cursor && cursorStyleOf(cursor);
  return {
    cursor: style,
    smooth: style?.smooth,
    laser: effects.filter((layer) => layer.kind === "laser").flatMap((layer) => layer.spans),
  };
}

/** What a caption needs to be drawn: its words and when each starts. */
export interface DrawnCaption {
  words: { text: string; start: number }[];
}

/**
 * Caption typography scales with the output, and uses the same canvas in preview and export. Highlighted captions
 * mark the word being spoken; single words show only that word, larger. `minSize` keeps the text legible where the
 * canvas is small, and `clearance` keeps the caption at least that far above the bottom edge, both in its pixels.
 */
export function drawCaption(
  context: CanvasRenderingContext2D,
  line: DrawnCaption,
  at: number,
  style: CaptionStyle,
  accent: string,
  { minSize = 0, clearance = 0 }: { minSize?: number; clearance?: number } = {},
): void {
  const { width, height } = context.canvas;
  const spoken = line.words.findLastIndex((word) => word.start <= at);
  const words =
    style === "word" ? [line.words[Math.max(spoken, 0)].text] : line.words.map((word) => word.text);
  const current = style === "highlight" ? spoken : -1;
  const maxWidth = width * 0.84;
  let size = Math.max(Math.min(width, height) * (style === "word" ? 0.075 : 0.045), minSize);
  context.save();
  context.font = `600 ${size}px system-ui, sans-serif`;
  // Long identifiers shrink rather than spill out of the frame.
  const widest = Math.max(...words.map((word) => context.measureText(word).width));
  if (widest > maxWidth) size *= maxWidth / widest;
  let rows: number[][] = [];
  const wrap = () => {
    context.font = `600 ${size}px system-ui, sans-serif`;
    const space = context.measureText(" ").width;
    rows = [];
    let row: number[] = [];
    let used = 0;
    words.forEach((word, index) => {
      const w = context.measureText(word).width;
      if (row.length && used + space + w > maxWidth) {
        rows.push(row);
        row = [];
        used = 0;
      }
      used += (row.length ? space : 0) + w;
      row.push(index);
    });
    if (row.length) rows.push(row);
  };
  wrap();
  while (rows.length * size * 1.3 > height * 0.35 && size > 1) {
    size *= 0.85;
    wrap();
  }
  const space = context.measureText(" ").width;
  const lineHeight = size * 1.3;
  const padding = size * 0.45;
  const rowWidth = (row: number[]) =>
    row.reduce((sum, index) => sum + context.measureText(words[index]).width, 0) +
    space * (row.length - 1);
  const boxWidth = Math.max(...rows.map(rowWidth)) + padding * 2;
  const boxHeight = lineHeight * rows.length + padding * 2;
  const top = height - Math.max(height * 0.07, clearance) - boxHeight;
  context.fillStyle = "rgb(0 0 0 / 0.8)";
  context.beginPath();
  context.roundRect((width - boxWidth) / 2, top, boxWidth, boxHeight, size * 0.25);
  context.fill();
  context.textAlign = "left";
  context.textBaseline = "middle";
  rows.forEach((row, rowIndex) => {
    let x = (width - rowWidth(row)) / 2;
    const y = top + padding + lineHeight * (rowIndex + 0.5);
    for (const index of row) {
      const w = context.measureText(words[index]).width;
      if (index === current) {
        context.fillStyle = accent;
        context.beginPath();
        context.roundRect(
          x - size * 0.12,
          y - lineHeight / 2 + size * 0.08,
          w + size * 0.24,
          lineHeight - size * 0.16,
          size * 0.18,
        );
        context.fill();
      }
      context.fillStyle = "white";
      context.fillText(words[index], x, y);
      x += w + space;
    }
  });
  context.restore();
}
