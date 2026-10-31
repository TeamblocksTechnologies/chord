<script lang="ts">
  // Heads a nested popup view. Escape steps back rather than closing the popup.
  import Icon from "#ui/Icon.svelte";

  let { label, onback }: { label: string; onback: () => void } = $props();

  // Window capture runs before the popover's own Escape handler, so this can step back instead of closing it.
  function onEscape(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onback();
  }
</script>

<svelte:window onkeydowncapture={onEscape} />

<button
  class="mb-1 flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-sm text-glass-300 transition hover:bg-glass-800 hover:text-neutral-100"
  onclick={onback}
>
  <Icon name="arrowLeft" class="size-4" />
  {label}
</button>
