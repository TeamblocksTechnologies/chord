<script lang="ts">
  // The toolbar and island windows. Their dropdowns open in the page; the main process lets the whole window take
  // clicks while one is open, and asks for them to close when the app is deactivated.
  import { onMount } from "svelte";
  import { connectDesktop } from "#platform/renderer/desktop.svelte";
  import { closeMenus, menus } from "@teamblocks.dev/chord-ui/menus.svelte";
  import FloatingToolbar from "./FloatingToolbar.svelte";
  import RecordingIsland from "./RecordingIsland.svelte";

  connectDesktop();
  const overlay = window.chord.desktop.overlay;
  onMount(() => overlay.onDismiss(closeMenus));
  $effect(() => overlay.setDropdownOpen(menus.open > 0));

  function onKeyDown(event: KeyboardEvent) {
    // An open menu takes Escape first.
    if (event.key !== "Escape" || event.defaultPrevented || window.chord.surface !== "toolbar")
      return;
    event.preventDefault();
    void window.chord.toolbar.hide();
  }
</script>

<svelte:window onkeydown={onKeyDown} />

{#if window.chord.surface === "toolbar"}
  <FloatingToolbar />
{:else}
  <RecordingIsland />
{/if}
