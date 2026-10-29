<script lang="ts" generics="T extends string | number">
  let {
    value = $bindable(),
    options,
    label,
    fill = false,
  }: {
    value: T;
    options: { value: T; label: string }[];
    label: string;
    /** Spreads the options evenly across the full width. */
    fill?: boolean;
  } = $props();
</script>

<div
  class={[
    "h-7 items-center rounded-md border border-glass-800 p-0.5",
    fill ? "grid auto-cols-fr grid-flow-col" : "flex",
  ]}
  role="radiogroup"
  aria-label={label}
>
  {#each options as option (option.value)}
    <button
      role="radio"
      aria-checked={value === option.value}
      class={[
        "h-full rounded px-2.5 text-xs font-medium transition",
        value === option.value
          ? "bg-glass-800 text-neutral-100"
          : "text-glass-500 hover:text-glass-300",
      ]}
      onclick={() => (value = option.value)}>{option.label}</button
    >
  {/each}
</div>
