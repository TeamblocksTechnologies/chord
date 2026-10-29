<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon, { type IconName } from "#ui/Icon.svelte";

  /** A command in a dropdown or context menu, the same everywhere and sized like a native menu row. */
  let {
    icon,
    inset = false,
    detail,
    destructive = false,
    disabled = false,
    title,
    onclick,
    children,
  }: {
    icon?: IconName;
    /** Leaves room for an icon it doesn't have, lining its label up with items that do. */
    inset?: boolean;
    /** Text at the end of the row, e.g. the command's shortcut. */
    detail?: string;
    destructive?: boolean;
    disabled?: boolean;
    title?: string;
    onclick: () => void;
    children: Snippet;
  } = $props();
</script>

<button
  role="menuitem"
  {disabled}
  {title}
  {onclick}
  class={[
    "flex h-[22px] w-full items-center gap-1.5 rounded-[5px] px-2 text-left text-[13px] enabled:hover:bg-glass-800 focus-visible:bg-glass-800 focus-visible:outline-none disabled:opacity-40",
    destructive ? "text-red-400" : "text-neutral-200",
  ]}
  >{#if icon}<Icon name={icon} class="size-3 shrink-0" />{:else if inset}<span
      class="size-3 shrink-0"
    ></span>{/if}<span class="min-w-0 flex-1 truncate" data-menu-label>{@render children()}</span
  >{#if detail}<span class="shrink-0 pl-3 text-[12px] text-glass-500 tabular-nums">{detail}</span
    >{/if}</button
>
