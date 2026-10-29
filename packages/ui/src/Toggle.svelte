<script lang="ts">
  let {
    checked = $bindable(),
    label,
    disabled = false,
  }: { checked: boolean; label: string; disabled?: boolean } = $props();
</script>

<button
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  class={[
    "relative h-5 w-9 shrink-0 rounded-md transition disabled:opacity-50",
    checked ? "bg-primary" : "bg-glass-700",
  ]}
  onclick={() => (checked = !checked)}
>
  <span
    class={[
      "absolute top-0.5 left-0.5 size-4 rounded-sm shadow transition",
      checked ? "translate-x-4 bg-white" : "bg-neutral-300",
    ]}
  ></span>
</button>
