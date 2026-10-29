<script lang="ts">
  // Independent controls for the desktop background and the Mac’s Dock, menu bar, and system overlays.
  import type { RecordingSetup } from "#project-document/domain/recording";
  import Toggle from "@teamblocks.dev/chord-ui/Toggle.svelte";
  import QualityRow from "./QualityRow.svelte";

  let { setup }: { setup: RecordingSetup } = $props();
</script>

<QualityRow label="Transparent background">
  <Toggle
    label="Transparent background"
    bind:checked={
      () => setup.background === "transparent",
      (on) => (setup.background = on ? "transparent" : "desktop")
    }
  />
</QualityRow>

<QualityRow label="Hide Mac UI">
  <Toggle
    label="Hide Mac UI"
    bind:checked={() => !setup.showsSystemUI, (on) => (setup.showsSystemUI = !on)}
  />
</QualityRow>
