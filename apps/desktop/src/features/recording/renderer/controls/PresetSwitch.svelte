<script lang="ts">
  // The shared quality presets. Custom shows while the sources in view have their own settings.
  import { QUALITY_PRESETS, type QualityPreset } from "../../domain/quality.ts";

  let {
    value,
    custom,
    onchange,
  }: { value: QualityPreset; custom: boolean; onchange: (preset: QualityPreset) => void } =
    $props();

  let options = $derived([
    ...QUALITY_PRESETS,
    ...(custom ? [{ value: "custom" as const, label: "Custom" }] : []),
  ]);
  let current = $derived(custom ? "custom" : value);
</script>

<div
  class="mx-1 grid h-8 auto-cols-fr grid-flow-col gap-0.5 rounded-lg border border-glass-800 p-0.5"
  role="radiogroup"
  aria-label="Quality"
>
  {#each options as option (option.value)}
    <button
      role="radio"
      aria-checked={current === option.value}
      class={[
        "rounded-md px-2 text-xs font-medium transition",
        current === option.value
          ? "bg-glass-800 text-neutral-50"
          : "text-glass-500 hover:text-glass-300",
      ]}
      onclick={() => option.value !== "custom" && onchange(option.value)}>{option.label}</button
    >
  {/each}
</div>
