<script lang="ts">
  import type { Snippet } from "svelte";

  let { label, children }: { label: string; children: Snippet } = $props();
</script>

<div class="flex items-center justify-between gap-4 px-2.5 py-1.5">
  <span class="text-sm text-neutral-200">{label}</span>
  {@render children()}
</div>
