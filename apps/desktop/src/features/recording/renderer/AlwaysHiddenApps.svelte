<script lang="ts">
  // Settings' list of apps hidden from every recording: every app, open or not, in one list, picked by hand. Dragging
  // across tiles sets each one passed over the way the first one went.
  import { allApps, filterApps, observeAppCatalogue } from "./apps.svelte.ts";
  import { PaintSelection } from "@teamblocks.dev/chord-ui/paintSelection";
  import AppTile from "@teamblocks.dev/chord-ui/recording/AppTile.svelte";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";

  let { hidden, onchange }: { hidden: string[]; onchange: (hidden: string[]) => void } = $props();

  let query = $state("");
  observeAppCatalogue();
  const painting = new PaintSelection(
    (id) => hidden.includes(id),
    (ids, hide) => {
      const next = hide
        ? [...hidden, ...ids.filter((id) => !hidden.includes(id))]
        : hidden.filter((id) => !ids.includes(id));
      if (next.length !== hidden.length) onchange(next);
    },
  );

  let visible = $derived(filterApps(allApps(hidden), query));
</script>

<div class="relative h-7">
  <Icon
    name="search"
    class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-glass-500"
  />
  <input
    class="size-full min-w-0 rounded-lg border border-glass-800 bg-neutral-950/60 pr-2.5 pl-8 text-xs text-neutral-100 placeholder:text-glass-600"
    placeholder="Find an app"
    bind:value={query}
  />
</div>

<div class="-mx-1 mt-2 max-h-96 overflow-y-auto overscroll-contain px-1 pb-1">
  {#if visible.length === 0}
    <div class="py-6 text-center text-xs text-glass-500">No apps match</div>
  {:else}
    <div
      class="grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-1"
      role="group"
      aria-label="Apps"
    >
      {#each visible as app (app.bundleId)}
        {@const isHidden = hidden.includes(app.bundleId)}
        <AppTile
          {app}
          compact
          selected={isHidden}
          badge={isHidden ? "eyeOff" : null}
          role="checkbox"
          aria-checked={isHidden}
          onpointerdown={(event) => painting.down(event, app.bundleId)}
          onpointerenter={(event) => painting.enter(event, app.bundleId)}
          onclick={(event) => painting.click(event, app.bundleId)}
        />
      {/each}
    </div>
  {/if}
</div>
