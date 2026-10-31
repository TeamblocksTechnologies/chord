<script lang="ts">
  import Icon from "#ui/Icon.svelte";
  import { PaintSelection } from "#ui/paintSelection.ts";
  import AppTile from "./AppTile.svelte";
  import { filterApps } from "./controls.ts";
  import { recordingEnvironment, type AppEntry } from "./environment.ts";

  let {
    hidden,
    onchange,
    exclude = [],
  }: {
    /** Bundle ids kept out of the recording. */
    hidden: string[];
    onchange: (hidden: string[]) => void;
    /** Bundle ids left out of the list, e.g. apps hidden from every recording in Settings. */
    exclude?: string[];
  } = $props();

  const catalogue = recordingEnvironment().apps;
  let query = $state("");
  catalogue.observe();
  const painting = new PaintSelection((id) => !hidden.includes(id), setRecorded);

  let apps = $derived.by(() => {
    const { open, closed } = catalogue.list(hidden);
    const shown = (app: AppEntry) => !exclude.includes(app.bundleId);
    return { open: open.filter(shown), closed: closed.filter(shown) };
  });

  let needle = $derived(query.trim().toLowerCase());
  let open = $derived(filterApps(apps.open, query));
  let closed = $derived(filterApps(apps.closed, query));
  let visible = $derived([...open, ...closed]);

  function setRecorded(ids: string[], recorded: boolean) {
    const next = recorded
      ? hidden.filter((id) => !ids.includes(id))
      : [...hidden, ...ids.filter((id) => !hidden.includes(id))];
    if (next.length !== hidden.length || next.some((id, i) => id !== hidden[i])) onchange(next);
  }

  /** Records only `bundleId`, blocking every other app. */
  function solo(bundleId: string) {
    const others = [...apps.open, ...apps.closed]
      .map((a) => a.bundleId)
      .filter((id) => id !== bundleId);
    onchange(others);
  }

  function onPointerDown(event: PointerEvent, app: AppEntry) {
    if (event.button !== 0) return;
    event.preventDefault();
    if (event.altKey) return solo(app.bundleId);
    painting.down(event, app.bundleId);
  }

  // Pointer clicks are handled on pointerdown; this covers the keyboard.
  function onClick(event: MouseEvent, app: AppEntry) {
    if (event.detail !== 0) return;
    if (event.altKey) return solo(app.bundleId);
    painting.click(event, app.bundleId);
  }
</script>

{#snippet section(title: string, list: AppEntry[])}
  {@const ids = list.map((a) => a.bundleId)}
  {@const recordedCount = ids.filter((id) => !hidden.includes(id)).length}
  {@const allRecorded = recordedCount === ids.length}
  <div class="flex items-center justify-between gap-2 px-1.5 pt-3 pb-1.5">
    <span class="flex items-baseline gap-1.5 text-xs font-medium text-glass-500">
      {title}
      <span class="text-[11px] text-glass-600 tabular-nums">{recordedCount}/{ids.length}</span>
    </span>
    <!-- One action that flips the whole section: block when everything is recorded, otherwise allow. -->
    <button
      class="-mr-1 rounded px-1 text-[11px] font-medium text-glass-500 transition hover:text-neutral-100 focus-visible:bg-glass-800 focus-visible:text-neutral-100"
      onclick={() => setRecorded(ids, !allRecorded)}
    >
      {allRecorded ? "Block" : "Allow"}
      {needle ? "shown" : "all"}
    </button>
  </div>
  <div class="grid grid-cols-4 gap-1" role="group" aria-label={title}>
    {#each list as app (app.bundleId)}
      {@const recorded = !hidden.includes(app.bundleId)}
      <AppTile
        {app}
        selected={recorded}
        faded={!recorded}
        badge={recorded ? "check" : "eyeOff"}
        role="checkbox"
        aria-checked={recorded}
        onpointerdown={(event) => onPointerDown(event, app)}
        onpointerenter={(event) => painting.enter(event, app.bundleId)}
        onclick={(event) => onClick(event, app)}
      />
    {/each}
  </div>
{/snippet}

<!-- Stuck to the top of the panel, which scrolls. Sticky offsets count from inside the panel's padding, so -top-1 and the negative margins reach its edge. -->
<div class="sticky -top-1 z-10 -mx-1 -mt-1 flex items-center gap-1.5 bg-popover p-2 pb-1">
  <div class="relative h-8 min-w-0 flex-1">
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
</div>

<div class="px-1 pb-1">
  {#if visible.length === 0}
    <div class="py-6 text-center text-xs text-glass-500">No apps match</div>
  {/if}
  {#if open.length > 0}{@render section("Open", open)}{/if}
  {#if closed.length > 0}{@render section("Not open", closed)}{/if}
</div>
