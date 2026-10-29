<script lang="ts">
  import type { Snippet } from "svelte";
  import type { MenuEntry } from "#ui/contextMenu.svelte.ts";
  import Icon from "#ui/Icon.svelte";
  import Menu from "#ui/Menu.svelte";
  import MenuEntries from "#ui/MenuEntries.svelte";
  import PanelHeader from "#ui/PanelHeader.svelte";

  /**
   * The same frame for whatever's selected: what kind of thing it is, the file or recording it comes from, and a menu
   * for the actions that don't belong among its controls.
   */
  let {
    title,
    detail,
    reveal,
    actions: commands = [],
    children: body,
  }: {
    title: string;
    detail?: string;
    /** Opens the selected resource in its containing folder. The consumer supplies platform behavior. */
    reveal?: () => void;
    /** Shown before Show in folder. */
    actions?: MenuEntry[];
    children?: Snippet;
  } = $props();
</script>

<div class="flex h-full min-h-0 flex-col" data-inspector>
  <PanelHeader {title} {detail}>
    {#snippet actions()}
      <Menu align="end">
        {#snippet trigger({ toggle, open })}
          <button
            class="flex size-7 shrink-0 items-center justify-center rounded-md text-glass-400 transition enabled:hover:bg-glass-800 enabled:hover:text-neutral-100 disabled:opacity-40"
            disabled={!commands.length && !reveal}
            onclick={toggle}
            aria-label={`${title} actions`}
            aria-haspopup="menu"
            aria-expanded={open}><Icon name="more" class="size-3.5" /></button
          >
        {/snippet}
        {#snippet children({ close })}
          <MenuEntries
            {close}
            entries={[
              ...commands,
              "separator",
              ...(reveal
                ? ([
                    { label: "Show in folder", icon: "folder", onselect: reveal },
                  ] satisfies MenuEntry[])
                : []),
            ]}
          />
        {/snippet}
      </Menu>
    {/snippet}
  </PanelHeader>
  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-inspector-scroll>
    {@render body?.()}
  </div>
</div>
