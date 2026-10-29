<script lang="ts">
  import Icon, { type IconName } from "#ui/Icon.svelte";

  /** An icon button for a panel header or the project bar. */
  let {
    icon,
    label,
    pressed,
    expanded,
    controls,
    onclick,
  }: {
    icon: IconName;
    label: string;
    pressed?: boolean;
    expanded?: boolean;
    controls?: string;
    onclick: () => void;
  } = $props();
</script>

<button
  class={[
    "flex size-7 shrink-0 items-center justify-center rounded-md transition hover:bg-glass-800 hover:text-neutral-100",
    pressed ? "bg-glass-800 text-neutral-100" : "text-glass-400",
  ]}
  {onclick}
  aria-label={label}
  title={label}
  aria-pressed={pressed}
  aria-expanded={expanded}
  aria-controls={controls}
>
  <Icon name={icon} class="size-3.5" />
</button>
