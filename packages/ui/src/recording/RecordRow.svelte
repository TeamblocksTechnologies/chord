<script lang="ts">
  // Record and New project, as Home lays them out.
  import Icon from "#ui/Icon.svelte";
  import { recordsAnything, type RecordingSetup } from "#ui/model/setup.ts";
  import RecordButton from "./RecordButton.svelte";

  let {
    setup,
    onRecord,
    onNewProject,
    compact = false,
    class: className = "",
  }: {
    setup: RecordingSetup;
    onRecord: () => void;
    onNewProject: () => void;
    compact?: boolean;
    class?: string;
  } = $props();
</script>

<!-- Both actions share the row equally on Home and in the menu bar panel. -->
<div class={["w-full max-w-md", className]}>
  <div class={["grid grid-cols-2", compact ? "gap-2" : "gap-3"]}>
    <RecordButton {compact} disabled={!recordsAnything(setup)} onclick={onRecord} />
    <button
      class={[
        "flex items-center justify-center rounded-lg border border-glass-800 bg-glass-900/50 font-medium whitespace-nowrap text-glass-300 transition hover:border-glass-700 hover:bg-glass-800/70 hover:text-neutral-100 active:scale-[0.98]",
        compact ? "h-8 gap-1.5 px-2 text-xs" : "h-12 gap-2 px-3 text-sm",
      ]}
      onclick={onNewProject}
    >
      <Icon name="plus" class="size-4 shrink-0" /> New project
    </button>
  </div>
</div>
