import { DEFAULT_SCROLL_SPEED, SCROLL_SPEEDS } from "../domain/notes.ts";

const KEY = "chord.autoScroll.v1";

/** Whether recording notes scroll by themselves while recording, and how fast. Kept between recordings. */
class AutoScroll {
  on = $state(false);
  /** An index into `SCROLL_SPEEDS`. */
  speed = $state(DEFAULT_SCROLL_SPEED);

  constructor() {
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as {
        on?: unknown;
        speed?: unknown;
      } | null;
      if (typeof stored?.on === "boolean") this.on = stored.on;
      if (Number.isInteger(stored?.speed) && SCROLL_SPEEDS[stored!.speed as number])
        this.speed = stored!.speed as number;
    } catch {
      /* Not set yet. */
    }
    $effect.root(() => {
      $effect(() => localStorage.setItem(KEY, JSON.stringify({ on: this.on, speed: this.speed })));
    });
  }

  /** Points per second. */
  get pointsPerSecond(): number {
    return SCROLL_SPEEDS[this.speed];
  }
  get slowest(): boolean {
    return this.speed === 0;
  }
  get fastest(): boolean {
    return this.speed === SCROLL_SPEEDS.length - 1;
  }
  slower(): void {
    if (!this.slowest) this.speed--;
  }
  faster(): void {
    if (!this.fastest) this.speed++;
  }
}

export const autoScroll = new AutoScroll();
