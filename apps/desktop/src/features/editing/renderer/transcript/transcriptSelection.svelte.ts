import { onDestroy, untrack } from "svelte";
import { moveCutEdge, type Cut } from "../../domain/cuts.ts";

export const TRANSCRIPT_ITEM = "[data-transcript-word], [data-transcript-silence]";
export const transcriptItemId = (element: HTMLElement): string =>
  element.dataset.transcriptWord ?? element.dataset.transcriptSilence!;
const ITEM = TRANSCRIPT_ITEM;
const itemId = transcriptItemId;

interface Options {
  ready(): boolean;
  cuts(): readonly Cut[];
  duration(): number;
  recordedItems(): readonly { id: string; start: number; end: number }[];
  resetKey(): string;
  onrecut(cuts: Cut[]): void;
  onactivate(id: string): void;
}

/** DOM selection, cut-marker dragging, and edge autoscroll for a transcript. Editing commands stay with the panel. */
export class TranscriptSelection {
  element = $state<HTMLDivElement>();
  ids = $state<string[]>([]);
  cutDraft = $state<Cut[] | null>(null);
  #options: Options;
  #drag: { pointerId: number; anchor: HTMLElement; x: number; y: number; moved: boolean } | null =
    null;
  #cutDrag: {
    pointerId: number;
    index: number;
    edge: "start" | "end";
    x: number;
    y: number;
    moved: boolean;
  } | null = null;
  #scrollFrame = 0;

  constructor(options: Options) {
    this.#options = options;
    $effect(() => {
      options.resetKey();
      untrack(() => this.#reset());
    });
    onDestroy(() => this.#reset());
  }

  #reset(): void {
    const pointer = this.#cutDrag ?? this.#drag;
    this.#cutDrag = this.#drag = null;
    cancelAnimationFrame(this.#scrollFrame);
    if (pointer && this.element?.hasPointerCapture(pointer.pointerId))
      this.element.releasePointerCapture(pointer.pointerId);
    this.cutDraft = null;
    this.clear();
  }

  read = (): string[] => {
    const selected = window.getSelection();
    if (!this.element || !selected || selected.isCollapsed || !selected.rangeCount) return [];
    const range = selected.getRangeAt(0);
    if (!this.element.contains(range.startContainer) || !this.element.contains(range.endContainer))
      return [];
    return [...this.element.querySelectorAll<HTMLElement>(ITEM)]
      .filter((element) => {
        const text = element.firstChild;
        if (!text || !range.intersectsNode(element)) return false;
        const intersection = range.cloneRange();
        if (range.comparePoint(text, 0) >= 0) intersection.setStart(text, 0);
        if (range.comparePoint(text, text.textContent!.length) <= 0)
          intersection.setEnd(text, text.textContent!.length);
        return !!intersection.toString().trim();
      })
      .map(itemId);
  };

  clear = (): void => {
    if (this.read().length) window.getSelection()?.removeAllRanges();
    this.ids = [];
  };

  down = (event: PointerEvent): void => {
    if (
      event.button !== 0 ||
      event.pointerType === "touch" ||
      !this.#options.ready() ||
      !this.element
    )
      return;
    const anchor =
      event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(ITEM) : null;
    if (!anchor) return;
    event.preventDefault();
    this.clear();
    this.element.focus({ preventScroll: true });
    this.#drag = {
      pointerId: event.pointerId,
      anchor,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    this.element.setPointerCapture(event.pointerId);
  };

  startCutDrag = (
    event: PointerEvent & { currentTarget: HTMLElement },
    index: number,
    edge: "start" | "end",
  ): void => {
    if (event.button !== 0 || !this.#options.ready() || !this.element) return;
    event.preventDefault();
    event.stopPropagation();
    this.clear();
    event.currentTarget.focus({ preventScroll: true });
    this.#cutDrag = {
      pointerId: event.pointerId,
      index,
      edge,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    // Capture on the text region: the marker can move to another word during the drag.
    this.element.setPointerCapture(event.pointerId);
  };

  #extendCut = (x: number, y: number): void => {
    if (!this.#cutDrag || !this.element) return;
    let distance = Infinity;
    let time: number | undefined;
    const spans = new Map(this.#options.recordedItems().map((item) => [item.id, item]));
    for (const element of this.element.querySelectorAll<HTMLElement>(ITEM)) {
      const item = spans.get(itemId(element));
      if (!item) continue;
      for (const box of element.getClientRects()) {
        const gap =
          Math.max(box.left - x, x - box.right, 0) ** 2 +
          Math.max(box.top - y, y - box.bottom, 0) ** 2;
        if (gap >= distance) continue;
        distance = gap;
        const progress =
          x <= box.left + 3 ? 0 : x >= box.right - 3 ? 1 : (x - box.left) / box.width;
        time = item.start + progress * (item.end - item.start);
      }
    }
    if (time !== undefined)
      this.cutDraft = moveCutEdge(
        this.#options.cuts(),
        this.#cutDrag.index,
        this.#cutDrag.edge,
        time,
        this.#options.duration(),
      );
  };

  #extendSelection = (x: number, y: number): void => {
    if (!this.#drag || !this.element) return;
    const elements = [...this.element.querySelectorAll<HTMLElement>(ITEM)];
    let nearest = this.#drag.anchor;
    let distance = Infinity;
    for (const element of elements) {
      for (const box of element.getClientRects()) {
        const gap =
          Math.max(box.left - x, x - box.right, 0) ** 2 +
          Math.max(box.top - y, y - box.bottom, 0) ** 2;
        if (gap < distance) {
          distance = gap;
          nearest = element;
        }
      }
    }
    const forward = elements.indexOf(nearest) >= elements.indexOf(this.#drag.anchor);
    const anchor = this.#drag.anchor.firstChild!;
    const end = nearest.firstChild!;
    window
      .getSelection()
      ?.setBaseAndExtent(
        anchor,
        forward ? 0 : anchor.textContent!.length,
        end,
        forward ? end.textContent!.length : 0,
      );
    this.ids = this.read();
  };

  #scrollSelection = (): void => {
    const pointer = this.#cutDrag ?? this.#drag;
    if (!pointer?.moved || !this.element) return;
    const scroller = this.element.closest<HTMLElement>("[data-inspector-scroll]");
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      const delta = pointer.y < box.top + 24 ? -12 : pointer.y > box.bottom - 24 ? 12 : 0;
      if (delta) {
        scroller.scrollTop += delta;
        const y = Math.max(box.top + 2, Math.min(box.bottom - 2, pointer.y));
        if (this.#cutDrag) this.#extendCut(pointer.x, y);
        else this.#extendSelection(pointer.x, y);
      }
    }
    this.#scrollFrame = requestAnimationFrame(this.#scrollSelection);
  };

  move = (event: PointerEvent): void => {
    if (this.#cutDrag?.pointerId === event.pointerId) {
      if (
        !this.#cutDrag.moved &&
        Math.hypot(event.clientX - this.#cutDrag.x, event.clientY - this.#cutDrag.y) < 3
      )
        return;
      if (!this.#cutDrag.moved) {
        this.#cutDrag.moved = true;
        this.#scrollFrame = requestAnimationFrame(this.#scrollSelection);
      }
      this.#cutDrag.x = event.clientX;
      this.#cutDrag.y = event.clientY;
      event.preventDefault();
      this.#extendCut(event.clientX, event.clientY);
      return;
    }
    if (!this.#drag || this.#drag.pointerId !== event.pointerId) return;
    if (
      !this.#drag.moved &&
      Math.hypot(event.clientX - this.#drag.x, event.clientY - this.#drag.y) < 3
    )
      return;
    if (!this.#drag.moved) {
      this.#drag.moved = true;
      this.#scrollFrame = requestAnimationFrame(this.#scrollSelection);
    }
    this.#drag.x = event.clientX;
    this.#drag.y = event.clientY;
    event.preventDefault();
    this.#extendSelection(event.clientX, event.clientY);
  };

  end = (event: PointerEvent): void => {
    if (this.#cutDrag?.pointerId === event.pointerId) {
      const draft = this.cutDraft;
      this.#cutDrag = null;
      cancelAnimationFrame(this.#scrollFrame);
      if (this.element?.hasPointerCapture(event.pointerId))
        this.element.releasePointerCapture(event.pointerId);
      if (draft && event.type === "pointerup") this.#options.onrecut(draft);
      this.cutDraft = null;
      return;
    }
    const ended = this.#drag;
    if (!ended || ended.pointerId !== event.pointerId) return;
    this.#drag = null;
    cancelAnimationFrame(this.#scrollFrame);
    if (this.element?.hasPointerCapture(event.pointerId))
      this.element.releasePointerCapture(event.pointerId);
    if (!ended.moved && event.type === "pointerup") {
      this.#options.onactivate(itemId(ended.anchor));
      // Selected too, ready to cut, edit or restore.
      const text = ended.anchor.firstChild!;
      window.getSelection()?.setBaseAndExtent(text, 0, text, text.textContent!.length);
      this.ids = this.read();
    }
  };
}
