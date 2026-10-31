<script lang="ts">
  // Home's projects before there are any.
  import Icon from "#ui/Icon.svelte";

  let { compact = false, onNewProject }: { compact?: boolean; onNewProject: () => void } = $props();
</script>

<div
  class={[
    "flex flex-col items-center rounded-2xl border border-dashed border-glass-800 px-6 text-center",
    compact ? "mt-3 py-6" : "mt-5 py-12",
  ]}
>
  <Icon name="film" class="size-6 text-glass-600" />
  <p class="mt-3 text-sm text-glass-400">Your recordings will show up here.</p>
  <p class="mt-1 text-xs text-glass-600">
    Start one above, or
    <button class="text-glass-400 underline-offset-2 hover:underline" onclick={onNewProject}>
      set up a project
    </button>
    with notes and settings for later.
  </p>
</div>
