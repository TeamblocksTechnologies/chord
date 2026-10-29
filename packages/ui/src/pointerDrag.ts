import type { Attachment } from "svelte/attachments";
import { on } from "svelte/events";

interface DragSession {
  move(event: PointerEvent, delta: { x: number; y: number }): void;
  /** Cancellation includes capture loss and unmount. The caller decides whether to keep a draft. */
  end?(cancelled: boolean): void;
}

/** Own capture and listeners for one primary-button drag. Return no session to ignore a press. */
export function pointerDrag(
  start: (event: PointerEvent & { currentTarget: HTMLElement }) => DragSession | void,
): Attachment<HTMLElement> {
  return (element) => {
    let active: { id: number; x: number; y: number; session: DragSession } | undefined;
    const end = (cancelled: boolean) => {
      const ended = active;
      if (!ended) return;
      active = undefined;
      if (element.hasPointerCapture(ended.id)) element.releasePointerCapture(ended.id);
      ended.session.end?.(cancelled);
    };
    const offs = [
      on(element, "pointerdown", (event) => {
        if (active || event.button !== 0) return;
        const session = start(event);
        if (!session) return;
        active = { id: event.pointerId, x: event.clientX, y: event.clientY, session };
        element.setPointerCapture(event.pointerId);
      }),
      on(element, "pointermove", (event) => {
        if (active?.id === event.pointerId)
          active.session.move(event, { x: event.clientX - active.x, y: event.clientY - active.y });
      }),
      on(element, "pointerup", (event) => {
        if (active?.id === event.pointerId) end(false);
      }),
      on(element, "pointercancel", (event) => {
        if (active?.id === event.pointerId) end(true);
      }),
      on(element, "lostpointercapture", (event) => {
        if (active?.id === event.pointerId) end(true);
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      end(true);
    };
  };
}
