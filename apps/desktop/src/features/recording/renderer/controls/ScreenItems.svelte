<script lang="ts">
  // The displays to record, as menu items. Previews run only while the screen is on.
  import { findDisplays, sources } from "../sources.svelte.ts";
  import type { RecordingSetup } from "#project-document/domain/recording";
  import MenuItem from "@teamblocks.dev/chord-ui/MenuItem.svelte";
  import DisplayPreview from "../DisplayPreview.svelte";
  import { toggleDisplay } from "./shared.ts";

  let { setup }: { setup: RecordingSetup } = $props();

  let displays = $derived(findDisplays(setup.displayIds));
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
