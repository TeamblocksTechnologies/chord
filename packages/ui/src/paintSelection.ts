import { onMount } from "svelte";
import { on } from "svelte/events";

/** Paint every item passed over with the first item's new selection state. Call during component setup. */
export class PaintSelection {
  #painting: { pointerId: number; selected: boolean } | null = null;
  #selected: (id: string) => boolean;
  #set: (ids: string[], selected: boolean) => void;

  constructor(selected: (id: string) => boolean, set: (ids: string[], selected: boolean) => void) {
    this.#selected = selected;
    this.#set = set;
    onMount(() => {
      const end = (event: PointerEvent) => {
        if (event.pointerId === this.#painting?.pointerId) this.#painting = null;
      };
      const offs = [
        on(document, "pointerup", end, { capture: true }),
        on(document, "pointercancel", end, { capture: true }),
        on(window, "blur", () => {
          this.#painting = null;
        }),
      ];
      return () => {
        offs.forEach((off) => off());
        this.#painting = null;
      };
    });
  }

  down(event: PointerEvent, id: string): void {
    if (event.button !== 0 || this.#painting) return;
    event.preventDefault();
    const selected = !this.#selected(id);
    this.#painting = { pointerId: event.pointerId, selected };
    this.#set([id], selected);
  }

  enter(event: PointerEvent, id: string): void {
    if (this.#painting?.pointerId === event.pointerId) this.#set([id], this.#painting.selected);
  }

  /** Pointer clicks were handled on down; keyboard activation still toggles. */
  click(event: MouseEvent, id: string): void {
    if (event.detail === 0) this.#set([id], !this.#selected(id));
  }
}
