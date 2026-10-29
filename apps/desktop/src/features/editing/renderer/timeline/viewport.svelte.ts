import { tick, untrack } from "svelte";
import type { Player } from "#media-engine/renderer/player.svelte";

export const TIMELINE_END_PAD = 24;
const MAX_SCALE = 300;

interface Options {
  player(): Player;
  width(): number;
  /** Width of sticky track labels, outside the timeline's coordinate space. */
  labelWidth?(): number;
  /** Changes open the recording fitted, with its left edge visible. */
  resetKey?(): string;
  /** A sequence scrolls horizontally with either wheel axis; grouped tracks scroll natively. */
  horizontal?: boolean;
  clampSeek?: boolean;
}

/** Navigation shared by the sequence and recording editors; edits belong to their own tracks. */
export class TimelineViewport {
  viewport = $state<HTMLDivElement>();
  content = $state<HTMLDivElement>();
  scrollLeft = $state(0);
  #zoom = $state(1);
  #scrubbing = false;
  #sizedFor = 0;
  #options: Options;
  readonly fitScale = $derived(
    this.player.duration > 0 && this.width > TIMELINE_END_PAD
      ? (this.width - TIMELINE_END_PAD) / this.player.duration
      : 0,
  );
  readonly maxZoom = $derived(this.fitScale > 0 ? Math.max(1, MAX_SCALE / this.fitScale) : 1);
  readonly scale = $derived(this.fitScale * Math.min(this.#zoom, this.maxZoom));

  constructor(options: Options) {
    this.#options = options;
    $effect(() => {
      const next = this.width;
      untrack(() => {
        const before = this.#sizedFor;
        this.#sizedFor = next;
        if (before <= TIMELINE_END_PAD || next <= TIMELINE_END_PAD || this.player.duration <= 0)
          return;
        const oldFit = (before - TIMELINE_END_PAD) / this.player.duration;
        this.#zoom =
          (oldFit * Math.min(this.#zoom, Math.max(1, MAX_SCALE / oldFit))) / this.fitScale;
      });
    });
    if (options.resetKey)
      $effect(() => {
        options.resetKey!();
        untrack(() => {
          this.#zoom = 1;
          this.#sizedFor = 0;
          if (this.viewport) this.viewport.scrollLeft = 0;
        });
      });
    $effect(() => {
      const time = this.player.time;
      untrack(() => {
        if (this.#scrubbing || this.scale <= 0 || !this.viewport) return;
        const at = this.x(time);
        const left = this.viewport.scrollLeft;
        if (at >= left && at <= left + this.width) return;
        this.viewport.scrollLeft = this.player.playing ? at : at - this.width / 2;
      });
    });
  }

  get player() {
    return this.#options.player();
  }
  get width() {
    return this.#options.width();
  }
  x = (time: number): number => time * this.scale;
  timeAt = (event: MouseEvent): number =>
    (event.clientX - this.content!.getBoundingClientRect().left) / this.scale;
  onScroll = (): void => {
    this.scrollLeft = this.viewport!.scrollLeft;
  };

  async zoomTo(next: number, anchor: number): Promise<void> {
    next = Math.min(Math.max(next, Math.min(1, this.#zoom)), this.maxZoom);
    if (!this.viewport || next === Math.min(this.#zoom, this.maxZoom) || this.scale <= 0) return;
    const time = (this.viewport.scrollLeft + anchor) / this.scale;
    this.#zoom = next;
    await tick();
    if (this.viewport) this.viewport.scrollLeft = this.x(time) - anchor;
  }

  wheel = (node: HTMLElement) => {
    const onWheel = (event: WheelEvent) => {
      const viewport = this.viewport;
      if (!viewport) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const anchor =
          event.clientX -
          node.getBoundingClientRect().left -
          (node === viewport ? (this.#options.labelWidth?.() ?? 0) : 0);
        void this.zoomTo(this.#zoom * Math.exp(-event.deltaY * 0.01), anchor);
      } else if (this.#options.horizontal) {
        event.preventDefault();
        viewport.scrollLeft +=
          Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      } else if (node !== viewport) {
        event.preventDefault();
        viewport.scrollLeft += event.deltaX;
        viewport.scrollTop += event.deltaY;
      }
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  };

  startScrub(event: PointerEvent & { currentTarget: HTMLElement }, ready: boolean): void {
    if (event.button !== 0 || !ready || this.scale <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    this.#scrubbing = this.player.scrubbing = true;
    this.#seek(event);
  }
  moveScrub = (event: PointerEvent): void => {
    if (this.#scrubbing) this.#seek(event);
  };
  endScrub = (): void => {
    this.#scrubbing = this.player.scrubbing = false;
  };

  #seek(event: PointerEvent): void {
    const time = this.timeAt(event);
    void this.player.seek(
      this.#options.clampSeek ? Math.min(Math.max(time, 0), this.player.duration) : time,
    );
  }

  acceptsShortcut(event: KeyboardEvent): boolean {
    if (
      !this.viewport?.checkVisibility() ||
      event.defaultPrevented ||
      document.querySelector("dialog:modal")
    )
      return false;
    const target = event.target;
    return !(
      target instanceof HTMLElement &&
      (target.closest("[data-inspector]") ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable ||
        (target instanceof HTMLInputElement && target.type !== "range"))
    );
  }
}
