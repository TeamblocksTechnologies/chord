<script lang="ts">
  import Slider from "#ui/Slider.svelte";

  let {
    id,
    label,
    ariaLabel = label,
    value,
    min = 0,
    max = 100,
    step = 1,
    scale = 1,
    suffix = "",
    format,
    onchange,
    disabled = false,
    class: className = "flex items-center gap-3 text-xs text-glass-400",
    labelClass = "",
    controlsClass = "min-w-0 flex-1",
    readoutClass = "w-9 text-xs text-glass-400",
  }: {
    id?: string;
    label?: string;
    ariaLabel?: string;
    value: number;
    /** Bounds and step use model units. Scale affects the native input and its default readout only. */
    min?: number;
    max?: number;
    step?: number;
    scale?: number;
    suffix?: string;
    format?: (value: number) => string;
    onchange: (value: number) => void;
    disabled?: boolean;
    class?: string;
    labelClass?: string;
    controlsClass?: string;
    readoutClass?: string;
  } = $props();
</script>

{#snippet controls()}
  <span class={["flex items-center gap-2", controlsClass]}>
    <Slider
      {id}
      class="min-w-0 flex-1"
      {disabled}
      min={min * scale}
      max={max * scale}
      step={step * scale}
      aria-label={ariaLabel}
      value={value * scale}
      oninput={(event) => onchange(event.currentTarget.valueAsNumber / scale)}
    />
    <span class={["shrink-0 text-right tabular-nums", readoutClass]}
      >{format ? format(value) : `${Math.round(value * scale)}${suffix}`}</span
    >
  </span>
{/snippet}

{#if label}
  <label class={className}>
    <span class={labelClass}>{label}</span>
    {@render controls()}
  </label>
{:else}
  {@render controls()}
{/if}
