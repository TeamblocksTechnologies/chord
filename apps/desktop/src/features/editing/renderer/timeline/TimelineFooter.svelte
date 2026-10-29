<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import Menu from "@teamblocks.dev/chord-ui/Menu.svelte";

  let {
    label,
    disabled = false,
    children,
    actions,
  }: {
    label: string;
    disabled?: boolean;
    children: Snippet<[{ close: () => void }]>;
    actions?: Snippet;
  } = $props();
</script>

<div
  data-track-footer
  class="flex shrink-0 items-center gap-1 border-t border-glass-800 bg-glass-900 px-2 py-1.5"
>
  <Menu side="top" {children}>
    {#snippet trigger({ toggle, open })}
      <button
        class="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-glass-400 enabled:hover:bg-glass-800 enabled:hover:text-neutral-100 disabled:opacity-50"
        onclick={toggle}
        {disabled}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="plus" class="size-3.5" />{label}<Icon name="chevronDown" class="size-3" />
      </button>
    {/snippet}
  </Menu>
  {@render actions?.()}
</div>
