<script lang="ts">
  // An icon button in the title bar, named by its tooltip.
  import Icon, { type IconName } from "#ui/Icon.svelte";
  import Tooltip from "#ui/Tooltip.svelte";

  let {
    label,
    icon,
    onclick,
    disabled = false,
    highlight = false,
    pulse = false,
  }: {
    label: string;
    icon: IconName;
    onclick: () => void;
    disabled?: boolean;
    /** Draws it in the primary color, for something that wants attention. */
    highlight?: boolean;
    /** Pulses the icon while something is in progress. */
    pulse?: boolean;
  } = $props();
</script>

<Tooltip text={label}>
  <button
    class={[
      "app-no-drag flex size-7 shrink-0 items-center justify-center rounded-md transition hover:bg-glass-800 disabled:pointer-events-none",
      highlight ? "text-primary hover:text-primary" : "text-glass-400 hover:text-neutral-100",
    ]}
    {onclick}
    {disabled}
    aria-label={label}
  >
    <Icon name={icon} class={pulse ? "size-4 animate-pulse" : "size-4"} />
  </button>
</Tooltip>
