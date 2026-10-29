<script lang="ts">
  import type { MenuEntry } from "#ui/contextMenu.svelte.ts";
  import MenuAction from "#ui/MenuAction.svelte";

  /** A menu's commands, notes and separators, closing the menu before a command runs. */
  let {
    entries,
    close,
  }: {
    entries: MenuEntry[];
    close: () => void;
  } = $props();

  // Entries are built with commands left out here and there, so separators only go between groups.
  let shown = $derived(
    entries.filter(
      (entry, index) =>
        entry !== "separator" ||
        (index > 0 &&
          entries[index - 1] !== "separator" &&
          entries.slice(index + 1).some((next) => next !== "separator")),
    ),
  );
  let inset = $derived(
    shown.some((entry) => typeof entry === "object" && "icon" in entry && !!entry.icon),
  );
</script>

{#each shown as entry, index (index)}
  {#if entry === "separator"}
    <div role="separator" class="mx-2 my-[5px] h-px bg-glass-800"></div>
  {:else if "note" in entry}
    <p class="flex h-[22px] items-center px-2 text-[13px] text-glass-500">{entry.note}</p>
  {:else}
    <MenuAction
      icon={entry.icon}
      {inset}
      detail={entry.detail}
      destructive={entry.destructive}
      disabled={entry.disabled}
      title={entry.title}
      onclick={() => {
        close();
        entry.onselect();
      }}>{entry.label}</MenuAction
    >
  {/if}
{/each}
