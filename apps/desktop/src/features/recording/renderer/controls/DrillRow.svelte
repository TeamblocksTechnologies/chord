<script lang="ts">
  // A popup row that opens a nested view.
  import Icon, { type IconName } from "@teamblocks.dev/chord-ui/Icon.svelte";

  let {
    icon,
    label,
    detail,
    onclick,
  }: { icon: IconName; label: string; detail: string; onclick: () => void } = $props();
</script>

<button
  class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-neutral-200 transition hover:bg-glass-800"
  {onclick}
>
  <Icon name={icon} class="size-4 text-glass-400" />
  <span class="flex-1 text-left">{label}</span>
  <span class="text-xs text-glass-500">{detail}</span>
  <Icon name="chevronRight" class="size-3.5 text-glass-500" />
</button>
