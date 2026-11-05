<script lang="ts">
  import { desktop } from "#platform/renderer/desktop.svelte";
  import HelperPreview from "./HelperPreview.svelte";

  let { windowId }: { windowId: number } = $props();

  // Keyed on the id alone, so relisting the windows doesn't restart the preview. The prop reads through the listed
  // window, which relisting replaces, so the id is held on its own first: it only changes when the window does.
  let id = $derived(windowId);
  let showsCursor = $derived(desktop.preferences.showsCursor);
  let request = $derived({ windowId: id, showsCursor });
</script>

<!-- Windows come in every shape, so each is fitted inside a landscape frame, on black as the helper sends them. -->
<HelperPreview {request} aspect={16 / 9} label="Window preview" fit="contain" black />
