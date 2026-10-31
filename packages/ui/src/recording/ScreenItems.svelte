<script lang="ts">
  // The displays to record, as menu items. Previews run only while the screen is on.
  import type { RecordingSetup } from "#ui/model/setup.ts";
  import { findDisplays } from "#ui/model/sources.ts";
  import MenuItem from "#ui/MenuItem.svelte";
  import { toggleDisplay } from "./controls.ts";
  import { recordingEnvironment } from "./environment.ts";

  let { setup }: { setup: RecordingSetup } = $props();

  const { sources, previews } = recordingEnvironment();
  const DisplayPreview = previews.display;

  let displays = $derived(findDisplays(sources.displays, setup.displayIds));
</script>

{#each sources.displays as option (option.id)}
  <MenuItem
    selected={setup.recordsScreen && displays.some((d) => d.id === option.id)}
    multiple
    detail={`${option.width}×${option.height}`}
    onclick={() => toggleDisplay(setup, option.id)}
  >
    {option.name}
    {#snippet preview()}
      {#if setup.recordsScreen}<DisplayPreview display={option} {setup} />{/if}
    {/snippet}
  </MenuItem>
{:else}
  <div class="px-2.5 py-1.5 text-sm text-glass-500">No displays found</div>
{/each}
