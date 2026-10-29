<script lang="ts">
  import type { Snippet } from "svelte";
  import { cubicOut } from "svelte/easing";
  import type { TransitionConfig } from "svelte/transition";
  import { floating } from "#ui/floating.ts";

  let {
    text,
    placement = "bottom",
    children,
  }: {
    text: string;
    placement?: "top" | "bottom" | "left" | "right";
    children: Snippet;
  } = $props();

  // Wait a beat so passing the pointer over a control doesn't flash tooltips.
  const DELAY = 400;

  // Drift in from the anchor's side. `transform` is free here: the floating helper positions with `translate`.
  const SHIFT = 4;
  function pop(_node: Element, { duration }: { duration: number }): TransitionConfig {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return { duration: 0 };
    const [x, y] = { top: [0, SHIFT], bottom: [0, -SHIFT], left: [SHIFT, 0], right: [-SHIFT, 0] }[
      placement
    ];
    return {
      duration,
      easing: cubicOut,
      css: (t, u) =>
        `opacity: ${t}; transform: translate(${x * u}px, ${y * u}px) scale(${0.96 + 0.04 * t})`,
    };
  }

  let anchor = $state<HTMLElement>();
  let shown = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function show() {
    clearTimeout(timer);
    timer = setTimeout(() => (shown = true), DELAY);
  }

  function hide() {
    clearTimeout(timer);
    shown = false;
  }
</script>

<!-- Focus events bubble up as focusin/out, so keyboard focus shows it too. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  class="inline-flex"
  bind:this={anchor}
  onpointerenter={show}
  onpointerleave={hide}
  onfocusin={(event) => event.currentTarget.matches(":has(:focus-visible)") && show()}
  onfocusout={hide}
  onpointerdown={hide}
>
  {@render children()}
</span>

{#if shown}
  <div
    role="tooltip"
    class="pointer-events-none z-50 max-w-60 rounded-md border border-white/10 bg-neutral-900 px-2 py-1 text-xs text-neutral-200 shadow-lg"
    in:pop={{ duration: 140 }}
    out:pop={{ duration: 90 }}
    {@attach floating(() => anchor, { placement, gap: 6 })}
  >
    {text}
  </div>
{/if}
