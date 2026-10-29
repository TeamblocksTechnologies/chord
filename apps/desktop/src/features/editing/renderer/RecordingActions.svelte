<script lang="ts">
  import type { MenuEntry } from "@teamblocks.dev/chord-ui/contextMenu.svelte";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import Menu from "@teamblocks.dev/chord-ui/Menu.svelte";
  import MenuEntries from "@teamblocks.dev/chord-ui/MenuEntries.svelte";

  /** A row's actions behind a button shown on hover: the same entries its right-click opens. */
  let {
    label,
    entries,
    side = "bottom",
    compact = false,
  }: {
    label: string;
    /** Read when the menu opens. */
    entries: () => MenuEntry[];
    side?: "top" | "bottom";
    compact?: boolean;
  } = $props();
</script>

<Menu align="end" {side}>
  {#snippet trigger({ toggle, open })}
    <button
      class={[
        "flex shrink-0 items-center justify-center rounded-md text-glass-400 transition hover:bg-glass-700 hover:text-neutral-100 focus-visible:opacity-100",
        compact ? "size-4" : "size-7",
        !open &&
          "opacity-0 group-hover/recording:opacity-100 group-focus-within/recording:opacity-100",
      ]}
      onclick={toggle}
      aria-label={`${label} actions`}
      aria-haspopup="menu"
      aria-expanded={open}
      title="Recording actions"><Icon name="more" class="size-3.5" /></button
    >
  {/snippet}
  {#snippet children({ close })}<MenuEntries entries={entries()} {close} />{/snippet}
</Menu>
