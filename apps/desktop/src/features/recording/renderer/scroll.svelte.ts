/**
 * Whether the current screen's content is scrolled away from the top. The top bar stays transparent until then.
 * Only one screen is mounted at a time, so a single shared flag is enough.
 */
class ScrollState {
  scrolled = $state(false);
  #owner: HTMLElement | null = null;

  /** Return the current screen to its initial scroll position and header appearance. */
  reset(): void {
    this.#owner?.scrollTo({ top: 0, behavior: "instant" });
    this.scrolled = false;
  }

  /** Attach to a screen's scroll container to drive `scrolled`. */
  track = (node: HTMLElement) => {
    this.#owner = node;
    const update = () => (this.scrolled = node.scrollTop > 0);
    update();
    node.addEventListener("scroll", update, { passive: true });
    return () => {
      node.removeEventListener("scroll", update);
      // The next screen may already have attached; don't clobber its state.
      if (this.#owner === node) {
        this.#owner = null;
        this.scrolled = false;
      }
    };
  };
}

export const scrollState = new ScrollState();
