<script lang="ts">
  import type { Snippet } from "svelte";
  import { settingsRow } from "#ui/settingsStyles.ts";

  let {
    name,
    details,
    chosen,
    disabled,
    error,
    onselect,
    children,
  }: {
    name: string;
    details: string[];
    chosen: boolean;
    disabled: boolean;
    error?: string;
    onselect: () => void;
    children: Snippet;
  } = $props();
</script>

<div class={settingsRow}>
  <button
    role="radio"
    aria-checked={chosen}
    {disabled}
    class="group flex min-w-0 flex-1 basis-56 items-center gap-3 self-stretch text-left disabled:cursor-default"
    onclick={onselect}
  >
    <span
      class={[
        "flex size-4 shrink-0 items-center justify-center rounded-full border transition group-disabled:opacity-50",
        chosen
          ? "border-primary bg-primary"
          : "border-glass-600 group-enabled:group-hover:border-glass-400",
      ]}
    >
      {#if chosen}<span class="size-1.5 rounded-full bg-white"></span>{/if}
    </span>
    <span class="min-w-0 flex-1">
      <span class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span class="shrink-0 text-xs font-medium text-neutral-100">{name}</span>
        <span class="flex min-w-0 gap-3 text-xs text-glass-400">
          {#each details as detail (detail)}<span class="truncate">{detail}</span>{/each}
        </span>
      </span>
      {#if error}
        <span class="mt-0.5 block truncate text-xs text-amber-300" title={error}>{error}</span>
      {/if}
    </span>
  </button>
  {@render children()}
</div>
