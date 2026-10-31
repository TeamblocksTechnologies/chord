<script lang="ts">
  import LogoMark from "#ui/LogoMark.svelte";

  let {
    label = "Record",
    class: className = "",
    disabled = false,
    compact = false,
    onclick,
  }: {
    label?: string;
    class?: string;
    disabled?: boolean;
    compact?: boolean;
    onclick: () => void;
  } = $props();
</script>

<!-- The button is its own size container: the label drops to just the icon when narrow. -->
<button
  class={[
    "@container flex items-center justify-center rounded-lg bg-primary text-sm font-semibold whitespace-nowrap text-white transition hover:bg-primary-hover active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
    compact ? "h-8 min-w-8 px-1.5" : "h-12 min-w-12 px-3",
    className,
  ]}
  aria-label={label}
  title={disabled ? "Choose something to record" : label}
  {disabled}
  {onclick}
>
  <span class={["flex min-w-0 items-center", compact ? "gap-2" : "gap-3"]}>
    <LogoMark recordOnHover class={`shrink-0 ${compact ? "size-4" : "size-6"}`} />
    <span class={["hidden truncate", compact ? "@min-[6rem]:block" : "@min-[8rem]:block"]}
      >{label}</span
    >
  </span>
</button>
