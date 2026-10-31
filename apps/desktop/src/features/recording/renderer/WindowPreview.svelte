<script lang="ts">
  import { windowPreview } from "./preview.ts";
  import VideoPreview from "./VideoPreview.svelte";

  let { windowId }: { windowId: number } = $props();

  // Keyed on the id alone, so relisting the windows doesn't restart the stream.
  let open = $derived(windowPreview(windowId));
</script>

<VideoPreview {open} />
