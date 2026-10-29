<script lang="ts">
  // The current page of recording notes while recording: its title, and its body scrolling by hand or by itself.
  // ← and → turn pages. Auto-scroll only moves while recording, not paused or counting down. It stops at the end of
  // the page, and holds while the body is scrolled by hand, carrying on from there shortly after.
  import type { Attachment } from "svelte/attachments";
  import { on } from "svelte/events";
  import { autoScroll } from "./autoScroll.svelte.ts";
  import type { RecorderPhase } from "./recorder.svelte.ts";
  import type { NotePage } from "../domain/notes.ts";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";

  let {
    pages,
    page,
    phase,
    onpage,
    bar,
    class: className = "",
  }: {
    pages: NotePage[];
    page: number;
    phase: RecorderPhase;
    onpage: (page: number) => void;
    /** Attached to the bar, e.g. to drag the window by it. */
    bar?: Attachment<HTMLElement>;
    class?: string;
  } = $props();

  /** How long after scrolling by hand auto-scroll waits before carrying on. Momentum scrolling counts as by hand. */
  const RESUME_AFTER = 1200;
  const SCROLL_KEYS = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "];

  // The recording state arrives as a new object several times a second. Derived, these only change when their value
  // does, so the effects below don't re-run (and jump back to the top) on every update.
  let shown = $derived(page);
  let running = $derived(phase === "recording");
  let current = $derived(pages[page]);
  /** The pointer is down in the body, e.g. dragging its scrollbar or a trackpad's scroll thumb. */
  let holding = false;
  let manualUntil = 0;
  const scrolledByHand = () => (manualUntil = performance.now() + RESUME_AFTER);
  /** Wheel and trackpad scrolling, and pointer drags of the scrollbar, are scrolling by hand. */
  const watchHand: Attachment<HTMLElement> = (element) => {
    const offs = [
      on(element, "wheel", scrolledByHand, { passive: true }),
      on(element, "pointerdown", () => (holding = true)),
    ];
    return () => offs.forEach((off) => off());
  };

  /** Lets go of the body; released outside the window, the next move over it notices. */
  function release() {
    if (!holding) return;
    holding = false;
    scrolledByHand();
  }

  let body = $state<HTMLElement>();

  // Each page starts at the top.
  $effect(() => {
    void shown;
    if (body) body.scrollTop = 0;
  });

  $effect(() => {
    const element = body;
    if (!element || !autoScroll.on || !running) return;
    const speed = autoScroll.pointsPerSecond;
    // Kept apart from scrollTop, which rounds; scrolling by hand moves it to where it was scrolled.
    let position = element.scrollTop;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const end = element.scrollHeight - element.clientHeight;
      if (holding || now < manualUntil || Math.abs(element.scrollTop - Math.round(position)) > 1) {
        position = element.scrollTop;
      } else if (position < end) {
        position = Math.min(position + (speed * (now - last)) / 1000, end);
        element.scrollTop = position;
      }
      last = now;
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  });

  function turn(by: number) {
    const next = page + by;
    if (next >= 0 && next < pages.length) onpage(next);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      return;
    if (
      SCROLL_KEYS.includes(event.key) &&
      event.target instanceof Node &&
      body?.contains(event.target)
    )
      scrolledByHand();
    if (event.key === "ArrowLeft") turn(-1);
    else if (event.key === "ArrowRight") turn(1);
    else return;
    event.preventDefault();
  }
</script>

<svelte:window
  onkeydown={onKeyDown}
  onpointerup={release}
  onpointercancel={release}
  onpointermove={(event) => event.buttons === 0 && release()}
/>

{#snippet iconButton(
  icon: "chevronLeft" | "chevronRight" | "minus" | "plus",
  label: string,
  disabled: boolean,
  onclick: () => void,
)}
  <button
    class="flex size-7 items-center justify-center rounded-md text-glass-300 transition enabled:hover:bg-glass-800 enabled:hover:text-neutral-50 disabled:text-glass-700"
    aria-label={label}
    title={label}
    {disabled}
    {onclick}
  >
    <Icon name={icon} class="size-4" />
  </button>
{/snippet}

<div class={["flex min-h-0 flex-col", className]}>
  <div class="flex shrink-0 items-center gap-1 px-2 py-1.5" {@attach bar ?? (() => {})}>
    {@render iconButton("chevronLeft", "Previous page (←)", page === 0, () => turn(-1))}
    <span
      class="min-w-10 text-center text-xs font-medium text-glass-400 tabular-nums"
      aria-label={`Page ${page + 1} of ${pages.length}`}
    >
      {page + 1} / {pages.length}
    </span>
    {@render iconButton("chevronRight", "Next page (→)", page === pages.length - 1, () => turn(1))}

    <div class="ml-auto flex items-center gap-0.5">
      {#if autoScroll.on}
        {@render iconButton("minus", "Slower", autoScroll.slowest, () => autoScroll.slower())}
        <span
          class="w-4 text-center text-xs font-medium text-glass-400 tabular-nums"
          aria-label="Scroll speed">{autoScroll.speed + 1}</span
        >
        {@render iconButton("plus", "Faster", autoScroll.fastest, () => autoScroll.faster())}
      {/if}
      <button
        class={[
          "ml-1 h-7 rounded-md px-2.5 text-xs font-medium transition",
          autoScroll.on
            ? "bg-white/15 text-neutral-50"
            : "text-glass-400 hover:bg-glass-800 hover:text-neutral-50",
        ]}
        aria-pressed={autoScroll.on}
        onclick={() => (autoScroll.on = !autoScroll.on)}
      >
        Auto-scroll
      </button>
    </div>
  </div>

  <div class="shrink-0 px-4 pt-1">
    <h2
      class={[
        "truncate text-base font-semibold",
        current?.title ? "text-neutral-50" : "text-glass-500",
      ]}
    >
      {current?.title || `Page ${page + 1}`}
    </h2>
  </div>
  <!-- Room after the last line so it can scroll up to where the eye is. -->
  <div
    bind:this={body}
    class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1.5 pb-2"
    {@attach watchHand}
  >
    <p class="text-lg leading-relaxed whitespace-pre-wrap text-neutral-200">{current?.body}</p>
    <div class="h-1/2" aria-hidden="true"></div>
  </div>
</div>
