<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    scrolled = false,
    start,
    center,
    end,
  }: {
    /** Darkens the bar to separate it from content scrolled under it. */
    scrolled?: boolean;
    /** Beside the window controls. */
    start?: Snippet;
    /** On the window midline, hidden when the sides leave it no room. */
    center?: Snippet;
    end?: Snippet;
  } = $props();

  const titlebarPadding =
    "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 0.75rem)";

  let barWidth = $state(0);
  let leftWidth = $state(0);
  let rightWidth = $state(0);
  let centerWidth = $state(0);
  // Reserve the wider side on both sides to keep the title on the window midline.
  // Allow a pixel for the rounding in clientWidth at fractional grid boundaries.
  let centerFits = $derived(
    centerWidth > 0 && centerWidth + 2 * Math.max(leftWidth, rightWidth) <= barWidth + 1,
  );
</script>

<!--
  Doubles as the window's title bar. Window Controls Overlay (Windows/Linux) exposes the area left free of the
  native controls via titlebar-area-* env vars; macOS falls back to an inset for the traffic lights.
  Transparent over the window's blur until the content below scrolls, then darkens to separate from it.
-->
<header
  class={[
    "app-drag sticky top-0 z-20 h-(--title-bar-height) shrink-0 border-b transition-colors duration-200",
    scrolled ? "border-white/5 bg-neutral-950/40" : "border-transparent bg-transparent",
  ]}
>
  <div
    class="grid h-full grid-cols-[minmax(min-content,1fr)_minmax(0,max-content)_minmax(min-content,1fr)] items-center"
    bind:clientWidth={barWidth}
  >
    <!-- Padding sits inside each equal-width track, so the center stays on the window midline; a side only outgrows its track when its controls need it. -->
    <div
      class="flex h-full items-center gap-2"
      style:padding-left="max(env(titlebar-area-x, 0px), var(--title-bar-inset-left))"
      bind:clientWidth={leftWidth}
    >
      {@render start?.()}
    </div>
    <!-- Keep the intrinsic width measurable while hidden, so resizing or changing the title can reveal it again. -->
    <div class="pointer-events-none min-w-0 overflow-hidden">
      <div
        class="flex h-7 w-max items-center px-2"
        style:visibility={centerFits ? "visible" : "hidden"}
        bind:clientWidth={centerWidth}
      >
        {@render center?.()}
      </div>
    </div>
    <div
      class="flex h-full items-center justify-end gap-1"
      style:padding-right={titlebarPadding}
      bind:clientWidth={rightWidth}
    >
      {@render end?.()}
    </div>
  </div>
</header>
