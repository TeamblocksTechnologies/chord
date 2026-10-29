<script lang="ts">
  // The quick-start toolbar. Its window keeps room for the cells' dropdowns on the side with more space; the bar sits
  // at the other edge, and drags by anything that isn't a control.
  import { TOOLBAR_HEIGHT, TOOLBAR_WIDTH } from "#platform/contracts/desktop";
  import { recordsAnything } from "#project-document/domain/recording";
  import Icon from "@teamblocks.dev/chord-ui/Icon.svelte";
  import RecordButton from "./RecordButton.svelte";
  import RecordingControls from "./controls/RecordingControls.svelte";
  import { desktop } from "#platform/renderer/desktop.svelte";
  import { shortcutLabel } from "#features/settings/renderer/shortcuts.svelte";
  import { windowDrag } from "./windowDrag.ts";

  let above = $derived(desktop.toolbar.side === "above");
</script>

<div class="relative h-screen w-screen text-neutral-100 antialiased">
  {#if desktop.defaults}
    <div
      data-toolbar
      data-menu-anchor
      class={[
        "overlay-surface absolute left-0 flex w-full items-center gap-2 border border-glass-800 px-2",
        above ? "bottom-0" : "top-0",
      ]}
      style:height={`${TOOLBAR_HEIGHT}px`}
      style:max-width={`${TOOLBAR_WIDTH}px`}
      aria-label="Quick recording toolbar"
      {@attach windowDrag()}
    >
      <button
        class="flex size-7 shrink-0 items-center justify-center rounded-full text-glass-500 hover:bg-glass-800 hover:text-neutral-100"
        onclick={() => window.chord.toolbar.hide()}
        aria-label="Dismiss toolbar"
        title={shortcutLabel("toolbar")
          ? `Dismiss (Esc or ${shortcutLabel("toolbar")})`
          : "Dismiss (Esc)"}
      >
        <Icon name="x" class="size-3.5" />
      </button>
      <div class="min-w-0 flex-1">
        <RecordingControls
          setup={desktop.defaults}
          layout="toolbar"
          side={above ? "top" : "bottom"}
        />
      </div>
      <RecordButton
        compact
        class="h-10! w-10 shrink-0"
        disabled={!recordsAnything(desktop.defaults)}
        onclick={() => window.chord.desktop.recording.quickStart()}
      />
    </div>
  {/if}
</div>
