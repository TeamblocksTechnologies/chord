<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { projectStore } from "#project-document/renderer/projects.svelte";
  import { recorder } from "#features/recording/renderer/recorder.svelte";
  import { router } from "#platform/renderer/router.svelte";
  import { settings } from "#features/settings/renderer/settings.svelte";
  import Home from "#features/projects/renderer/Home.svelte";
  import ProjectView from "#features/editing/renderer/ProjectView.svelte";
  import SettingsDialog from "#features/settings/renderer/SettingsDialog.svelte";
  import RecordingView from "#features/recording/renderer/RecordingView.svelte";
  import { connectDesktop, desktop } from "#platform/renderer/desktop.svelte";
  import ContextMenu from "@teamblocks.dev/chord-ui/ContextMenu.svelte";

  connectDesktop(() => projectStore.defaults);

  let route = $derived(router.current);
  let project = $derived(route.name === "project" ? projectStore.get(route.id) : undefined);

  // Takes finished from the island or this window are saved here, then shown. A window opened to show one waits for
  // its projects, or a take recorded for one would start a new project.
  $effect(() => {
    if (desktop.finished === 0 || !projectStore.loaded) return;
    void recorder.claimFinished().then((saved) => {
      const current = router.current;
      if (saved && (current.name !== "project" || current.id !== saved.id))
        router.push({ name: "project", id: saved.id });
    });
  });

  // A project deleted from elsewhere leaves nothing to show. Its project may still be on its way when first opened.
  $effect(() => {
    if (projectStore.loaded && route.name === "project" && !project) router.back();
  });

  // Screens asked for from the menu bar, once the projects they may show are here.
  async function takeRoute() {
    const asked = await window.chord.desktop.takeRoute();
    if (asked?.name === "settings") settings.open(asked.tab);
    else if (asked) router.open(asked);
  }
  onMount(() =>
    window.chord.desktop.onNavigate(() => {
      if (projectStore.loaded) void takeRoute();
    }),
  );
  $effect(() => {
    if (projectStore.loaded) untrack(takeRoute);
  });

  function onKeyDown(event: KeyboardEvent) {
    // An open dialog takes Escape to close itself, leaving the screen under it.
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      recorder.active ||
      document.querySelector("dialog:modal")
    )
      return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.blur();
      return;
    }
    router.back();
  }
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="flex h-screen flex-col text-neutral-100 antialiased">
  {#if recorder.active}
    <RecordingView />
  {:else if route.name === "home"}
    <Home />
  {:else if project}
    {#key project.id}
      <ProjectView {project} initialTime={route.name === "project" ? route.time : undefined} />
    {/key}
  {/if}
</div>

{#if settings.tab}
  <SettingsDialog />
{/if}

<ContextMenu />
