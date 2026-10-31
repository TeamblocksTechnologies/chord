<script lang="ts">
  // Microphones stay dimmed and unmetered while off. Selecting a device switches them on; deselecting keeps their power state.
  import type { RecordingSetup } from "#ui/model/setup.ts";
  import MenuItem from "#ui/MenuItem.svelte";
  import { toggled } from "./controls.ts";
  import { recordingEnvironment } from "./environment.ts";

  let { setup }: { setup: RecordingSetup } = $props();

  const { sources, previews } = recordingEnvironment();
  const LevelMeter = previews.level;
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
