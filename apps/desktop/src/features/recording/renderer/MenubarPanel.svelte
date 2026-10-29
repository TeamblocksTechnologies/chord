<script lang="ts">
  // The panel under the menu bar icon: the home screen, with the cells' menus opening beside it in the room its window
  // keeps on that side. Every other screen opens in the main window.
  import { onMount } from "svelte";
  import { MENUBAR } from "#platform/contracts/overlay";
  import { connectDesktop, desktop } from "#platform/renderer/desktop.svelte";
  import { closeMenus, menus } from "@teamblocks.dev/chord-ui/menus.svelte";
  import { projectStore } from "#project-document/renderer/projects.svelte";
  import { router } from "#platform/renderer/router.svelte";
  import { scrollState } from "./scroll.svelte.ts";
  import Home from "#features/projects/renderer/Home.svelte";

  connectDesktop();
  const overlay = window.chord.desktop.overlay;
  onMount(() => overlay.onDismiss(closeMenus));
  $effect(() => overlay.setDropdownOpen(menus.open > 0));

  // Only reopenings reset the scroll; other desktop state updates preserve it.
  let visible = $derived(desktop.menubar.visible);
  $effect(() => {
    if (visible) scrollState.reset();
  });

  // A project just created here is saved before the main window looks for it.
  router.elsewhere = (route) =>
    void projectStore.saved().then(() => window.chord.desktop.openMain(route));

  function onKeyDown(event: KeyboardEvent) {
    // An open menu takes Escape first.
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    void window.chord.desktop.hideMenubar();
  }
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="relative h-screen w-screen text-neutral-100 antialiased">
  <div
    data-menubar
    data-menu-anchor
    class={[
      "overlay-surface absolute top-0 flex h-full flex-col overflow-hidden ring-1 ring-white/10 ring-inset",
      desktop.menubar.side === "left" ? "right-0" : "left-0",
    ]}
    style:width={`${MENUBAR.width}px`}
  >
    <Home panel />
  </div>
</div>
