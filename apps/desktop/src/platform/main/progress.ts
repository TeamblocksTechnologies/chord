/** Coalesces frequent progress updates, while publishing state transitions immediately. */
export class ProgressPublisher {
  #last = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #publish: () => void;
  constructor(publish: () => void) {
    this.#publish = publish;
  }
  send(progressOnly = false): void {
    if (!progressOnly) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
      this.#last = Date.now();
      this.#publish();
    } else if (!this.#timer) {
      this.#timer = setTimeout(
        () => {
          this.#timer = undefined;
          this.#last = Date.now();
          this.#publish();
        },
        Math.max(0, this.#last + 100 - Date.now()),
      );
    }
  }
}
