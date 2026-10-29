<script lang="ts">
  import type { Snippet } from "svelte";

  let { title, detail, children }: { title: string; detail?: string; children: Snippet } = $props();
  const id = $props.id();
</script>

<section class="mt-5 first-of-type:mt-4" aria-labelledby={id}>
  <h2 {id} class="mb-2 flex items-baseline gap-1.5 px-1 text-xs font-medium text-glass-400">
    {title}
    {#if detail}<span class="font-normal text-glass-500 tabular-nums">{detail}</span>{/if}
  </h2>
  <div class="w-full rounded-lg border border-glass-800 bg-glass-900/30 px-3 py-0.5">
    {@render children()}
  </div>
</section>
