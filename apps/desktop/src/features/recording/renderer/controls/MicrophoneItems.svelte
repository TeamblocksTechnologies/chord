<script lang="ts">
  // Microphones stay dimmed and unmetered while off. Selecting a device switches them on; deselecting keeps their power state.
  import { sources } from "../sources.svelte.ts";
  import type { RecordingSetup } from "#project-document/domain/recording";
  import LevelMeter from "../LevelMeter.svelte";
  import MenuItem from "@teamblocks.dev/chord-ui/MenuItem.svelte";
  import { toggled } from "./shared.ts";

  let { setup }: { setup: RecordingSetup } = $props();
</script>

<div class={["transition-opacity", !setup.microphoneEnabled && "opacity-50"]}>
  {#each sources.microphones as microphone (microphone.id)}
    <MenuItem
      selected={setup.microphoneIds.includes(microphone.id)}
      multiple
      detail={microphone.isDefault ? "Default" : undefined}
      onclick={() => {
        setup.microphoneIds = toggled(setup.microphoneIds, microphone.id);
        if (setup.microphoneIds.includes(microphone.id)) setup.microphoneEnabled = true;
      }}
    >
      {microphone.name}
      {#snippet preview()}
        {#if setup.microphoneEnabled}<LevelMeter
            source={{ kind: "microphone", deviceId: microphone.id }}
          />{/if}
      {/snippet}
    </MenuItem>
  {:else}
    <div class="px-2.5 py-1.5 text-sm text-glass-500">No microphones connected</div>
  {/each}
</div>
