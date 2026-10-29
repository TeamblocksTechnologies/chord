import type { UpdateState } from "../contracts/updates.ts";

/** The app's update state, kept in step with the main process. */
class Updates {
  state = $state<UpdateState>({ status: "idle" });

  constructor() {
    window.chord.updates.onState((state) => (this.state = state));
    void window.chord.updates.getState().then((state) => (this.state = state));
  }

  /** What clicking the button does now, per the current state. */
  act(): void {
    const { updates } = window.chord;
    switch (this.state.status) {
      case "available":
        void updates.download();
        break;
      case "ready":
        void updates.install();
        break;
      case "idle":
      case "current":
      case "error":
        void updates.check();
        break;
    }
  }
}

export const updates = new Updates();
