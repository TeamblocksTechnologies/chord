<script lang="ts">
  // The three capture modes as a compact segmented control.
  import type { RecordingSetup } from "#ui/model/setup.ts";
  import Icon from "#ui/Icon.svelte";
  import { modes, setMode } from "./controls.ts";

  let { setup, class: className = "" }: { setup: RecordingSetup; class?: string } = $props();
</script>

<div
  class={["grid h-9 grid-cols-3 gap-0.5 rounded-lg border border-glass-800 p-0.5", className]}
  role="radiogroup"
  aria-label="Screen mode"
>
  {#each modes as option (option.mode)}
    {@const selected = setup.mode === option.mode}
    <button
      role="radio"
      aria-checked={selected}
      title={option.label}
      class={[
        "flex items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition",
        selected ? "bg-glass-800 text-neutral-50" : "text-glass-500 hover:text-glass-300",
      ]}
      onclick={() => setMode(setup, option.mode)}
    >
      <Icon name={option.icon} class="size-3.5 shrink-0" />
      <span class="truncate">{option.short}</span>
    </button>
  {/each}
</div>
