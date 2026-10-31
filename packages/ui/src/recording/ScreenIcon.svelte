<script lang="ts">
  import { paths } from "#ui/Icon.svelte";
  import {
    screenIconMotion,
    screenShape,
    type ScreenIconName,
    type ScreenIconState,
  } from "./screenIconMotion.ts";

  let { name, on, compact }: { name: ScreenIconName; on: boolean; compact: boolean } = $props();

  function morph(node: SVGSVGElement, initial: ScreenIconState) {
    let previous = initial;
    const motion = screenIconMotion(node);
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.addEventListener("change", motion.stop);
    return {
      update(next: ScreenIconState) {
        if (next.name === previous.name && next.on === previous.on) return;
        if (reducedMotion.matches) motion.stop();
        else motion.transition(previous, next);
        previous = next;
      },
      destroy() {
        motion.stop();
        reducedMotion.removeEventListener("change", motion.stop);
      },
    };
  }
</script>

<svg
  class={["source-icon", compact ? "size-4" : "size-5"]}
  use:morph={{ name, on }}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <!-- The original single path returns at rest, preserving its exact geometry and stroke compositing. -->
  <path d={paths[screenShape({ name, on })]} />
</svg>

<style>
  svg {
    transform-origin: center;
  }
</style>
