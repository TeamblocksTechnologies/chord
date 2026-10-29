import { desktop } from "#platform/renderer/desktop.svelte";

export const toolbar = {
  get visible() {
    return desktop.toolbar.visible;
  },
  get registered() {
    return desktop.toolbar.registered;
  },
};
