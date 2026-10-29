<script lang="ts">
  import type { AudioSource } from "@teamblocks.dev/chord-recorder-protocol";
  import { audioPreview, audioSourceKey } from "./audioPreview.svelte.ts";
  import LevelBar from "@teamblocks.dev/chord-ui/LevelBar.svelte";

  let { source }: { source: AudioSource } = $props();

  let key = $derived(audioSourceKey(source));
  let level = $derived(audioPreview.levels[key] ?? 0);
  let failure = $derived(audioPreview.failures[key]);

  $effect(() => audioPreview.watch(source));
</script>

{#if failure}
  <div class="text-xs text-glass-500">{failure}</div>
{:else}
  <LevelBar {level} />
{/if}
