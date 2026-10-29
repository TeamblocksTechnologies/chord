/**
 * Recording notes: an ordered list of pages, each a title and a body. The same pages hold talking points or a full
 * script; the body scrolls, by hand or automatically, when it's longer than the notes window.
 */
export interface NotePage {
  id: string;
  title: string;
  body: string;
}

/** The page being shown from `at` seconds of recorded time, so a recording can be split into sections later. */
export interface PageChange {
  at: number;
  page: number;
}

/** A page change saved with a recording. The title is kept as it was, since pages can be edited or removed later. */
export interface RecordedPageChange {
  at: number;
  pageId: string;
  title: string;
}

/** Auto-scroll speeds, in points per second. */
export const SCROLL_SPEEDS = [12, 18, 26, 36, 48, 64, 84] as const;
export const DEFAULT_SCROLL_SPEED = 2;

export function isNotePages(value: unknown): value is NotePage[] {
  return (
    Array.isArray(value) &&
    value.every(
      (page) =>
        !!page &&
        typeof page === "object" &&
        typeof page.id === "string" &&
        typeof page.title === "string" &&
        typeof page.body === "string",
    )
  );
}

/** Notes saved before pages were a single block of text, which becomes the first page. */
export function upgradeNotes(stored: unknown): NotePage[] {
  if (isNotePages(stored)) return stored;
  if (typeof stored === "string" && stored.trim())
    return [{ id: crypto.randomUUID(), title: "", body: stored }];
  return [];
}

/** Whether any page has something written on it. */
export function hasNotes(pages: NotePage[]): boolean {
  return pages.some((page) => page.title.trim() || page.body.trim());
}

/**
 * Adds a change to page `page` at `at` seconds. A change at the same moment as the last one replaces it, so flicking
 * through pages before recording starts (or while paused) leaves only where it landed; returning to the page already
 * shown removes the change.
 */
export function addPageChange(changes: PageChange[], at: number, page: number): PageChange[] {
  const last = changes.at(-1);
  const kept = last && last.at >= at ? changes.slice(0, -1) : changes;
  return kept.at(-1)?.page === page ? kept : [...kept, { at, page }];
}

/**
 * The notes window's default size and the smallest it can be resized to: down to its bar, the title, and a single line
 * of the body (4 frame + 40 bar + 28 title + 6 + 29.25 line + 8 padding, from `NotesPanel` and `RecordingNotes`).
 */
export const NOTES_WINDOW = { width: 640, height: 232, minWidth: 320, minHeight: 116 } as const;

/** An edge or corner of the notes window being dragged to resize it. */
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const RESIZE_EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/**
 * `origin` with `edge` moved by the pointer's movement since the resize started, keeping the opposite edges where they
 * were and the window no smaller than its minimum.
 */
export function resizedBounds(
  origin: { x: number; y: number; width: number; height: number },
  edge: ResizeEdge,
  dx: number,
  dy: number,
): { x: number; y: number; width: number; height: number } {
  let { x, y, width, height } = origin;
  if (edge.includes("e")) width = Math.max(NOTES_WINDOW.minWidth, origin.width + dx);
  if (edge.includes("s")) height = Math.max(NOTES_WINDOW.minHeight, origin.height + dy);
  if (edge.includes("w")) {
    width = Math.max(NOTES_WINDOW.minWidth, origin.width - dx);
    x = origin.x + origin.width - width;
  }
  if (edge.includes("n")) {
    height = Math.max(NOTES_WINDOW.minHeight, origin.height - dy);
    y = origin.y + origin.height - height;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}
