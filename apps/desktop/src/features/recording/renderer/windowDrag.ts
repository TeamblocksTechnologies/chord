import type { Attachment } from "svelte/attachments";
import { on } from "svelte/events";
import type { ResizeEdge } from "../domain/notes.ts";

/**
 * Reports a pointer drag that starts in the element to the main process, which moves or resizes the window, so it
 * knows where it is throughout; screen coordinates stay put while the window moves under the pointer.
 */
function pointerDrag(
  starts: (event: PointerEvent) => boolean,
  edge?: ResizeEdge,
): Attachment<HTMLElement> {
  return (element) => {
    let drag: { x: number; y: number; pointerId: number } | null = null;
    const end = (event: PointerEvent) => {
      if (drag?.pointerId !== event.pointerId) return;
      drag = null;
      void window.chord.desktop.overlay.dragEnd();
    };
    const offs = [
      on(element, "pointerdown", (event) => {
        if (event.button !== 0 || !starts(event)) return;
        drag = { x: event.screenX, y: event.screenY, pointerId: event.pointerId };
        element.setPointerCapture(event.pointerId);
        void window.chord.desktop.overlay.dragStart(edge);
      }),
      on(element, "pointermove", (event) => {
        if (drag?.pointerId === event.pointerId) {
          window.chord.desktop.overlay.dragMove(event.screenX - drag.x, event.screenY - drag.y);
        }
      }),
      on(element, "pointerup", end),
      on(element, "pointercancel", end),
      on(element, "lostpointercapture", end),
    ];
    return () => offs.forEach((off) => off());
  };
}

/** Drags an overlay window from anything in the element that isn't a control. */
export function windowDrag(enabled: () => boolean = () => true): Attachment<HTMLElement> {
  return pointerDrag(
    (event) =>
      enabled() &&
      !(
        event.target instanceof Element &&
        event.target.closest("button, input, select, textarea, a, [role=menu]")
      ),
  );
}

/** Resizes the recording notes window from `edge` when the element is dragged. */
export function windowResize(edge: ResizeEdge): Attachment<HTMLElement> {
  return pointerDrag(() => true, edge);
}
