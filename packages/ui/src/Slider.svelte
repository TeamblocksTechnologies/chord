<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";

  type Props = Omit<HTMLInputAttributes, "type" | "value" | "min" | "max"> & {
    value: number;
    min?: number;
    max?: number;
    /** Neutral fill instead of primary blue, for media scrubbers. */
    neutral?: boolean;
  };

  let {
    value,
    min = 0,
    max = 100,
    step,
    neutral = false,
    class: className,
    onpointermove,
    onpointerleave,
    ...rest
  }: Props = $props();
  const span = $derived(max - min);
  const fill = $derived(span > 0 ? Math.min(Math.max((value - min) / span, 0), 1) : 0);
  // Where a click under the pointer would land, snapped to the step like the native jump.
  let hover = $state<number>();

  function track(event: PointerEvent & { currentTarget: HTMLInputElement }) {
    onpointermove?.(event);
    const input = event.currentTarget;
    if (event.buttons || input.disabled || span <= 0) return void (hover = undefined);
    const rect = input.getBoundingClientRect();
    const thumb = parseFloat(getComputedStyle(input).getPropertyValue("--thumb")) || 0;
    const at =
      Math.min(Math.max((event.clientX - rect.left - thumb / 2) / (rect.width - thumb), 0), 1) *
      span;
    const increment = Number(step);
    hover = (increment > 0 ? Math.min(Math.round(at / increment) * increment, span) : at) / span;
  }
</script>

<input
  type="range"
  class={["slider", neutral && "slider-neutral", className]}
  {min}
  {max}
  {step}
  {value}
  style:--fill={fill}
  style:--hover={hover ?? fill}
  onpointermove={track}
  onpointerleave={(event) => {
    hover = undefined;
    onpointerleave?.(event);
  }}
  {...rest}
/>

<style>
  .slider {
    --thumb: 12px;
    --track: 4px;
    --fill-color: var(--color-primary);
    appearance: none;
    height: 20px;
    background: transparent;
    cursor: default;
  }

  .slider-neutral {
    --thumb: 10px;
    --track: 3px;
    --fill-color: var(--color-neutral-200);
  }

  /*
   * Stops sit under the thumb's center, which travels thumb/2 in from each end. Between the value and
   * the hovered point, a half-strength fill marks what a click would add ahead of the thumb or take away
   * behind it.
   */
  .slider::-webkit-slider-runnable-track {
    --near: calc(var(--thumb) / 2 + (100% - var(--thumb)) * min(var(--fill), var(--hover)));
    --far: calc(var(--thumb) / 2 + (100% - var(--thumb)) * max(var(--fill), var(--hover)));
    height: var(--track);
    border-radius: var(--track);
    background: linear-gradient(
      to right,
      var(--fill-color) var(--near),
      color-mix(in oklab, var(--fill-color) 45%, transparent) 0 var(--far),
      var(--color-glass-800) 0
    );
  }

  .slider::-webkit-slider-thumb {
    appearance: none;
    width: var(--thumb);
    height: var(--thumb);
    margin-top: calc((var(--track) - var(--thumb)) / 2);
    border-radius: var(--radius-sm);
    background: var(--color-white);
    box-shadow: 0 1px 3px rgb(0 0 0 / 40%);
    transition: transform 120ms ease;
  }

  .slider-neutral::-webkit-slider-thumb {
    background: var(--color-neutral-200);
  }

  .slider:not(:disabled):hover::-webkit-slider-thumb,
  .slider:not(:disabled):active::-webkit-slider-thumb {
    transform: scale(1.15);
  }

  /* Ring the thumb rather than the whole input. */
  .slider:focus-visible {
    outline: none;
  }

  .slider:focus-visible::-webkit-slider-thumb {
    box-shadow:
      0 1px 3px rgb(0 0 0 / 40%),
      0 0 0 3px color-mix(in oklab, var(--color-primary) 50%, transparent);
  }

  .slider:disabled {
    opacity: 0.4;
  }
</style>
