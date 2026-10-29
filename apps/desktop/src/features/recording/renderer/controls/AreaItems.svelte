<script lang="ts">
  // `area` mode's displays, as menu items, each with how many areas it has and a preview with its areas outlined.
  // Clicking an item checks or unchecks the display; clicking a checked one's preview opens the picker over every display.
  import type { DisplaySource } from "@teamblocks.dev/chord-recorder-protocol";
  import { sources } from "../sources.svelte.ts";
  import type { RecordingSetup } from "#project-document/domain/recording";
  import MenuItem from "@teamblocks.dev/chord-ui/MenuItem.svelte";
  import DisplayPreview from "../DisplayPreview.svelte";
  import { chooseAreas, toggleAreaDisplay } from "./shared.ts";

  let { setup }: { setup: RecordingSetup } = $props();

  const areasOn = (displayId: number) => setup.areas.filter((a) => a.displayId === displayId);
</script>

{#each sources.displays as option (option.id)}
  {@const areas = areasOn(option.id)}
  <MenuItem
    selected={setup.recordsScreen &&
      areas.length > 0 &&
      !setup.inactiveAreaDisplayIds.includes(option.id)}
    multiple
    onclick={() => toggleAreaDisplay(setup, option.id)}
  >
    {option.name}
    {#snippet preview()}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        data-action
        class="group relative overflow-hidden rounded-md transition-[filter] hover:brightness-125"
        onclick={(e) => {
          e.stopPropagation();
          chooseAreas(setup);
        }}
      >
        <DisplayPreview display={option} {setup}>
          {#snippet overlay()}{@render outlines(option, areas)}{/snippet}
        </DisplayPreview>
        <span
          class="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
        >
          <span
            class="rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white backdrop-blur"
            >Edit areas</span
          >
        </span>
      </div>
    {/snippet}
  </MenuItem>
{:else}
  <div class="px-2.5 py-1.5 text-sm text-glass-500">No displays found</div>
{/each}

<!-- As in the picker: dimmed outside the areas, each outlined and numbered. Areas are in points, so the viewBox is the
     display's size in points. -->
{#snippet outlines(display: DisplaySource, areas: RecordingSetup["areas"])}
  {@const width = display.width / display.scale}
  {@const height = display.height / display.scale}
  {@const id = `areas-${display.id}`}
  <svg class="pointer-events-none absolute inset-0 size-full" viewBox="0 0 {width} {height}">
    <defs>
      <mask {id}>
        <rect {width} {height} fill="white" />
        {#each areas as area}<rect
            x={area.x}
            y={area.y}
            width={area.width}
            height={area.height}
            fill="black"
          />{/each}
      </mask>
    </defs>
    <rect {width} {height} fill="rgb(0 0 0 / 0.5)" mask="url(#{id})" />
    {#each areas as area}
      <rect
        x={area.x}
        y={area.y}
        width={area.width}
        height={area.height}
        fill="none"
        stroke="white"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
      />
    {/each}
  </svg>
  {#each areas as area, i}
    <span
      class="absolute rounded bg-black/60 px-1 text-[10px] leading-4 font-medium text-white tabular-nums"
      style:left="calc({(area.x / width) * 100}% + 3px)"
      style:top="calc({(area.y / height) * 100}% + 3px)">{i + 1}</span
    >
  {/each}
{/snippet}
