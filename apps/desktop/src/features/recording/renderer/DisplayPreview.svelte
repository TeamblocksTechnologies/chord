<script lang="ts">
  import type { DisplaySource } from "@teamblocks.dev/chord-recorder-protocol";
  import type { Snippet } from "svelte";
  import { desktop } from "#platform/renderer/desktop.svelte";
  import { excludedApps } from "#features/settings/domain/preferences";
  import HelperPreview from "./HelperPreview.svelte";
  import type { RecordingSetup } from "#project-document/domain/recording";

  let {
    display,
    setup,
    overlay,
  }: {
    display: DisplaySource;
    setup: Pick<RecordingSetup, "background" | "hiddenApps" | "showsSystemUI">;
    overlay?: Snippet;
  } = $props();

  let request = $derived({
    displayId: display.id,
    background: setup.background,
    showsSystemUI: setup.showsSystemUI,
    excludedBundleIds: excludedApps(setup.hiddenApps, desktop.preferences.hiddenApps),
    showsCursor: desktop.preferences.showsCursor,
  });
</script>

<HelperPreview
  {request}
  aspect={display.width / display.height}
  label={`${display.name} preview`}
  class="display-preview"
  {overlay}
/>
