import type { Route } from "../contracts/desktop.ts";

export type { Route };

/**
 * In-memory navigation without a sidebar: every screen is reached from home and has one way back, so a stack is
 * enough. `back` returns to wherever the user came from (usually home).
 */
class Router {
  #stack = $state<Route[]>([{ name: "home" }]);

  current = $derived(this.#stack[this.#stack.length - 1]);
  canGoBack = $derived(this.#stack.length > 1);

  /**
   * Where `push` sends screens other than home instead, e.g. the menu bar panel, which shows only home and opens the
   * rest in the main window.
   */
  elsewhere: ((route: Route) => void) | null = null;

  push(route: Route): void {
    if (this.elsewhere && route.name !== "home") this.elsewhere(route);
    else this.#stack.push(route);
  }

  /** Shows `route` with only home to go back to, e.g. when it was asked for from the menu bar. */
  open(route: Route): void {
    this.#stack = route.name === "home" ? [route] : [{ name: "home" }, route];
  }

  /** Replaces the current screen, e.g. a finished quick recording opening its new project. */
  replace(route: Route): void {
    this.#stack[this.#stack.length - 1] = route;
  }

  back(): void {
    if (this.#stack.length > 1) this.#stack.pop();
  }

  home(): void {
    this.#stack = [{ name: "home" }];
  }
}

export const router = new Router();
